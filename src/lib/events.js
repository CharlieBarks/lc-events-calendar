// Loads every event once per build, cleans it up and works out recurring series.
//
// Sources:
//   1. City of Las Cruces feed, through the lc-events-proxy Worker (worker.js).
//      lascruces.gov blocks Cloudflare's build servers directly, so we go through it.
//   2. The CitySpark copy: every listing from the old CitySpark calendar, with photos stored in our own
//      Cloudflare storage (the cityspark-export Worker, source in cityspark-export.js). Refreshed daily.
//   3. Approved submissions from the add-your-event form (the lc-events-intake Worker, source in intake.js).
//      When one matches a CitySpark or city listing (same name, same day), the submission wins: it has the
//      organizer's full-size flyer.
//   4. src/data/events.json: events Live Love Las Cruces adds by hand.
//
// The city feed is optional (skipped with a warning). The CitySpark copy and the submissions must answer,
// or the build stops. If every source together has NO upcoming events, the build also stops.
// Either way Cloudflare keeps the last good version live instead of a thin or empty calendar.
// Working without internet? EVENTS_OFFLINE=1 uses src/data/city-snapshot.json instead.

import fs from 'node:fs';
import path from 'node:path';
import lllcEvents from '../data/events.json';
import { CATEGORIES, categoryKey, categoryFromTags, PREVIEW, CITYSPARK_SUBSCRIBED, INTAKE_URL } from './site.js';
import { topicFor } from './topics.js';
import { resolveVenue, fold } from './venues.js';
import spotlightList from '../data/spotlight.json';
import { wall, dateKey, todayWall, weekday, timeLabel, monthShort } from './time.js';

const EVENTS_URL = 'https://lc-events-proxy.cf2-99b.workers.dev';
const CITYSPARK_URL = 'https://cityspark-export.cf2-99b.workers.dev/events.json';

async function loadCitySpark() {
  // Local testing: EVENTS_CITYSPARK_FILE=path/to/events.json
  if (process.env.EVENTS_CITYSPARK_FILE) return JSON.parse(fs.readFileSync(process.env.EVENTS_CITYSPARK_FILE, 'utf8')).events;
  if (process.env.EVENTS_OFFLINE === '1') return [];
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(CITYSPARK_URL, { signal: AbortSignal.timeout(30000) });
      if (res.status === 404) {
        console.warn('CitySpark copy not finished yet; building without it.');
        return [];
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`Loaded ${data.events.length} CitySpark events (copied ${data.exportedAt})`);
      return data.events;
    } catch (err) {
      lastError = err;
      console.warn(`CitySpark copy attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`CitySpark copy unavailable (${lastError?.message}). Stopping the build so the last good site stays up.`);
}

async function loadSubmissions() {
  if (process.env.EVENTS_OFFLINE === '1') return [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${INTAKE_URL}/approved.json`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log(`Loaded ${data.events.length} approved submissions`);
      return data.events;
    } catch (err) {
      console.warn(`Submissions attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  // Better to stop than to publish a calendar that silently drops approved events.
  throw new Error('Approved submissions unavailable. Stopping the build so the last good site stays up.');
}

async function loadCity() {
  if (process.env.EVENTS_OFFLINE === '1') {
    const file = path.resolve('src/data/city-snapshot.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')).events;
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(EVENTS_URL, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
      const data = await res.json();
      if (!data.events?.length) throw new Error('No events returned');
      console.log(`Fetched ${data.events.length} city events from proxy${data.stale ? ` (saved copy from ${data.fetchedAt || 'earlier'}; the city blocked today's request)` : ''}`);
      return data.events;
    } catch (err) {
      lastError = err;
      console.warn(`City feed attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  console.warn(`City feed unavailable (${lastError?.message}). Building without it.`);
  return [];
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

function cleanVenue(raw = '') {
  const full = raw.replace(/,?\s*United States$/i, '').replace(/\s{2,}/g, ' ').trim();
  if (full.length < 4) return { venue: '', address: '' }; // e.g. "NM"
  // "Munson Senior Center > Meeting Room 3 – 975 S Mesquite Las Cruces NM 88001"
  const name = full.split(/\s[–-]\s|,|>/)[0].trim();
  return { venue: name, address: full };
}

// CitySpark's generated placeholder pictures have uuid-style file names
// (1d2c…-….large.png); organizers' uploads have short ones (6QxtXcZO….large.jpg).
const CITYSPARK_PLACEHOLDER = /\/img\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i;

function normalize(e, source) {
  const start = wall(e.start);
  if (!start) return null;
  const end = wall(e.end);
  const place = e.address ? { venue: e.venue || e.city || '', address: e.address } : cleanVenue(e.venue);
  const category = e.tags ? categoryFromTags(e.tags, e.title) : categoryKey(e.category);
  // One spelling per venue (src/data/venues.json), so search and series grouping see one place.
  const v = resolveVenue(place.venue || e.venue || '');
  const out = {
    slug: source === 'lllc' ? e.slug : `${slugify(e.title).slice(0, 60).replace(/-$/, '')}-${dateKey(start)}`,
    title: e.title.trim(),
    startRaw: e.start,
    start, end,
    date: dateKey(start),
    venue: v.venue,
    room: v.room,
    venueKey: v.key,
    address: place.address,
    category,
    description: (e.description || '').trim(),
    summary: (e.summary || '').trim(),
    url: e.url || '',
    ticketUrl: e.ticketUrl || '',
    image: source === 'cityspark' && !CITYSPARK_SUBSCRIBED && CITYSPARK_PLACEHOLDER.test(e.image || '') ? '' : e.image || '',
    tags: e.tags || [],
    price: e.price || '',
    // Spotlight is only for events Charlie marks (Review page, events.json or src/data/spotlight.json),
    // not CitySpark's old "picks".
    featured: source !== 'cityspark' && !!e.featured,
    sponsored: source !== 'cityspark' && !!e.sponsored,
    spotlightUntil: e.spotlightUntil || '',
    sample: !!e.sample,
    source,
  };
  out.topic = topicFor(out);
  if (out.category === 'community' && out.topic?.category) out.category = out.topic.category;
  return out;
}

// Could these two listings be the same place? Yes when the venue names match, when either listing
// has no real venue to compare, or when they start at the same time and one name contains the other
// ("Branigan Library" / "Thomas Branigan Memorial Library") or the street address matches.
// A wrong "no" shows an event twice, which is easy to spot and is fixed by adding the spelling to
// src/data/venues.json. A wrong "yes" would silently drop a real event, so "no" needs clear evidence.
const NO_VENUE = new Set(['', 'las cruces', 'las cruces nm', 'mesilla', 'mesilla nm', 'nm']);
const street = (e) => (fold(e.address || '').match(/\b\d+ [a-z0-9]+ [a-z0-9]+/) || [''])[0];
function samePlace(a, b) {
  const va = fold(a.venue), vb = fold(b.venue);
  if (NO_VENUE.has(va) || NO_VENUE.has(vb)) return true;
  if (va === vb) return true;
  // A partial name match or a shared street address only counts with the same start time
  // ("The Game" and "The Game II" are different bars).
  const sa = street(a), sb = street(b);
  const close = va.includes(vb) || vb.includes(va) || (!!sa && sa === sb);
  return close && a.start.H === b.start.H && a.start.M === b.start.M;
}

let cache;

export async function getEvents() {
  cache ??= (async () => {
    const [cityRaw, sparkRaw, subsRaw] = await Promise.all([loadCity(), loadCitySpark(), loadSubmissions()]);
    // The same event often arrives from two sources. Two listings are the same event when the name
    // and the day match AND nothing says they are in different places (see samePlace). Two different
    // "Trivia Night" listings at two breweries on one evening are both kept.
    const key = (e) => `${e.title.toLowerCase().replace(/[^a-z0-9]/g, '')}|${e.date}`;
    const index = (list) => {
      const map = new Map();
      for (const e of list) map.set(key(e), [...(map.get(key(e)) || []), e]);
      return map;
    };
    const dupOf = (map, e) => (map.get(key(e)) || []).some((x) => samePlace(x, e));
    // Submissions beat the feeds: same event, but with the organizer's own full-size flyer.
    const subs = subsRaw.map((e) => normalize(e, 'lllc')).filter(Boolean);
    const subIndex = index(subs);
    const spark = sparkRaw.map((e) => normalize(e, 'cityspark')).filter((e) => e && !dupOf(subIndex, e));
    // Between the two feeds, keep the CitySpark copy (it has a photo).
    const sparkIndex = index(spark);
    const city = cityRaw.map((e) => normalize(e, 'city-of-las-cruces')).filter((e) => e && !dupOf(sparkIndex, e) && !dupOf(subIndex, e));
    // Sample listings only show on the private preview, never on the live site.
    const ours = [...subs, ...lllcEvents.filter((e) => PREVIEW || !e.sample).map((e) => normalize(e, 'lllc'))];
    const today = dateKey(todayWall());

    const events = [...spark, ...city, ...ours]
      .filter(Boolean)
      .filter((e) => (e.end ? dateKey(e.end) : e.date) >= today);

    // Last line of defense: never publish an empty calendar. Every source counts (CitySpark copy, city,
    // submissions, events.json), so this keeps working after CitySpark is cancelled and its copy runs dry.
    // Offline builds are exempt: the saved city snapshot is usually all in the past.
    if (events.length === 0 && process.env.EVENTS_OFFLINE !== '1') {
      throw new Error('No upcoming events from any source. Stopping the build so the last good site stays up.');
    }

    events.sort((a, b) => a.date.localeCompare(b.date) || a.start.H * 60 + a.start.M - (b.start.H * 60 + b.start.M));

    // Same slug twice (two sessions on one day): add a counter.
    const seen = new Map();
    for (const e of events) {
      const n = seen.get(e.slug) || 0;
      seen.set(e.slug, n + 1);
      if (n) e.slug = `${e.slug}-${n + 1}`;
    }

    // Recurring series: same title + venue 3+ times. They show as compact rows so a weekly
    // pickleball session doesn't bury the one-night-only stuff.
    const groups = new Map();
    for (const e of events) {
      const k = `${e.title.toLowerCase()}|${e.venue.toLowerCase()}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const series = [];
    for (const list of groups.values()) {
      if (list.length < 3) continue;
      const days = new Set(list.map((e) => weekday(e.start)));
      const first = list[0];
      const dayNum = (e) => Date.UTC(e.start.y, e.start.m - 1, e.start.d) / 864e5;
      const gaps = list.slice(1).map((e, i) => dayNum(e) - dayNum(list[i]));
      const gap = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; // typical spacing
      const day = [...days][0];
      const when = days.size !== 1 ? 'Several times a month'
        : gap === 7 ? `Every ${day}`
        : gap === 14 ? `Every other ${day}`
        : gap >= 28 && gap <= 35 ? `Monthly on ${day}s`
        : `${day}s`;
      const s = {
        // Exhibits and other things open nearly every day: shown once in "On view now", not on every day.
        ongoing: gap <= 1 && list.length >= 10,
        gap,
        until: list[list.length - 1],
        id: slugify(first.title),
        title: first.title,
        venue: first.venue,
        category: first.category,
        when,
        time: timeLabel(first.start),
        next: first,
        dates: list,
      };
      list.forEach((e) => { e.series = s; });
      series.push(s);
    }

    // Ongoing things keep a single listing (their next date) so they get one page, not hundreds.
    const ongoing = series.filter((x) => x.ongoing);
    const dropped = new Set(ongoing.flatMap((x) => x.dates.slice(1)));
    const kept = events.filter((e) => !dropped.has(e));
    // Ongoing things get an address without a date (/event/lean-in/), so a link to an exhibit keeps
    // working for its whole run instead of changing every day with the "next date".
    const taken = new Set(kept.map((e) => e.slug));
    const dateless = (x) => {
      const base = slugify(x.title).slice(0, 60).replace(/-$/, '');
      return [base, `${base}-${x.next.venueKey}`].find((s) => s && !taken.has(s));
    };
    for (const x of ongoing) {
      const stable = dateless(x);
      if (stable) { taken.delete(x.next.slug); x.next.slug = stable; taken.add(stable); }
    }
    // In its last days a long run has too few dates left to count as "ongoing" and goes back to one
    // listing per day. The dateless address then forwards to the next date, so the link still works.
    const aliases = [];
    for (const x of series) {
      if (x.ongoing || x.gap > 1) continue;
      const stable = dateless(x);
      if (stable) { taken.add(stable); aliases.push({ slug: stable, to: x.next.slug }); }
    }
    for (const x of ongoing) {
      x.next.ongoing = true;
      x.when = `${x.category === 'arts-culture' ? 'On view' : 'Daily'} through ${monthShort(x.until.start)} ${x.until.start.d}`;
      x.dates = [x.next];
    }

    // Spotlight list for events that didn't come through the form.
    for (const m of spotlightList.events || []) {
      const t = fold(m.title || ''), v = fold(m.venue || '');
      if (!t) continue;
      for (const e of kept) {
        if (fold(e.title) !== t || (v && !fold(e.venue).includes(v))) continue;
        e.featured = true;
        e.sponsored = e.sponsored || !!m.sponsored;
        e.spotlightUntil = m.until || e.spotlightUntil;
      }
    }
    for (const e of kept) {
      // A Spotlight ends on its "until" date (or with the event itself).
      if (e.spotlightUntil && e.date > e.spotlightUntil) { e.featured = false; e.sponsored = false; }
      e.spotlight = e.featured || e.sponsored;
      // Paid events always get a full card, even when they repeat.
      e.compact = !e.sponsored && (!!e.series || e.category === 'city-hall');
    }

    return {
      events: kept,
      // Day-by-day listings (everything except ongoing exhibits)
      dated: kept.filter((e) => !e.ongoing),
      ongoing: ongoing.map((x) => x.next),
      series: series.filter((x) => !x.ongoing),
      // Dateless addresses that forward to an event page: [{ slug, to }]
      aliases,
    };
  })();
  return cache;
}

export function shortVenue(e) {
  if (!e.venue) return 'Location on the original listing';
  return e.room ? `${e.venue} · ${e.room}` : e.venue;
}

export function mapsLink(e) {
  const q = e.address || `${e.venue}, Las Cruces, NM`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

export function googleCalendarLink(e, { offsetIso }) {
  const stamp = (w) => offsetIso(w).replace(/[-:]/g, '').slice(0, 15);
  const end = e.end || { ...e.start, H: e.start.H + 2 };
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(end)}`,
    ctz: 'America/Denver',
    details: `${e.description.slice(0, 800)}\n\nhttps://events.livelovelascruces.com/event/${e.slug}/`,
    location: e.address || e.venue,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export const categoryOf = (e) => CATEGORIES[e.category];
