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
import { CATEGORIES, categoryKey, categoryFromTags, audienceOf, PREVIEW, CITYSPARK_SUBSCRIBED, INTAKE_URL, REPEAT_DAYS } from './site.js';
import { expand, describe, addDaysKey } from './repeat.js';
import { topicFor } from './topics.js';
import { resolveVenue, fold, venueKey, venueInfo, venueList } from './venues.js';
import { addThumbs } from './thumbs.js';
import { areaOf, townOf } from './areas.js';
import { addSisterLinks } from './sisters.js';
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
  if (process.env.EVENTS_OFFLINE === '1') return { events: [], feeds: [], hidden: [], nopic: [], featured: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${INTAKE_URL}/approved.json`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // "feeds": events the Worker read from other organizations' calendars (feeds.js). Same request,
      // so they can't be missing while submissions are present.
      console.log(`Loaded ${data.events.length} approved submissions and ${(data.feeds || []).length} events from other calendars`);
      return { events: data.events, feeds: data.feeds || [], hidden: data.hidden || [], nopic: data.nopic || [], featured: data.featured || [] };
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

// A repeating event arrives as one entry with a rule ("every Tuesday"). This turns it into one
// entry per date for the next REPEAT_DAYS days, so the rest of the site treats each date like any
// other listing. `start` and `end` on the entry give the times (and the first date).
function spread(e, today) {
  if (!e.repeat) return [e];
  const time = (iso) => (String(iso || '').match(/T(\d\d:\d\d)/) || [])[1] || '';
  const startTime = time(e.start), endTime = time(e.end);
  const overnight = startTime && endTime && endTime < startTime;
  return expand(e.repeat, today, addDaysKey(today, REPEAT_DAYS)).map((date) => ({
    ...e,
    slug: `${e.slug}-${date}`,
    start: startTime ? `${date}T${startTime}:00` : date,
    end: endTime ? `${overnight ? addDaysKey(date, 1) : date}T${endTime}:00` : '',
    seriesKey: e.slug,
  }));
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

// Some feeds (CitySpark) send text written in Markdown, with backslashes in front of punctuation:
// "Wicker \\(105 R\\)". Shown as plain text those backslashes are just clutter, so take them out.
const unescape = (s = '') => String(s || '').replace(/\\([\\`*_{}\[\]()#+\-.!>~|&$%:;,'"?=/])/g, '$1');
// HTML entities some feeds leave in their text ("&iexcl;Amigues!", "&amp;", "&#8217;").
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', iexcl: '¡', iquest: '¿', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', copy: '©', reg: '®', trade: '™', deg: '°', bull: '•' };
const decode = (s = '') => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ENTITIES[c] ?? m);

// Not events: closures and listings the organizer has called off ("Libraries Closed for Thanksgiving",
// "Canceled - Computer Literacy Class"). Dropped from every source.
const NOT_AN_EVENT = /^\s*(cancel+ed|postponed)\b|^\s*librar(y|ies) closed|\bclosed for (the )?\w+ ?(holiday|day)\b/i;

function normalize(e, source) {
  if (NOT_AN_EVENT.test(e.title || '')) return null;
  const start = wall(e.start);
  if (!start) return null;
  const end = wall(e.end);
  // Feeds we read ourselves (feeds.js) keep venue and address apart already, even when the address is empty.
  const place = e.address || e.feed ? { venue: e.venue || e.city || '', address: e.address || '' } : cleanVenue(e.venue);
  const category = e.tags ? categoryFromTags(e.tags, e.title) : categoryKey(e.category);
  // One spelling per venue (src/data/venues.json), so search and series grouping see one place.
  const v = resolveVenue(place.venue || e.venue || '');
  const out = {
    // A date from a repeat rule already has its slug (see spread).
    slug: source === 'lllc' || e.seriesKey ? e.slug : `${slugify(e.title).slice(0, 60).replace(/-$/, '')}-${dateKey(start)}`,
    title: decode(unescape(e.title)).trim(),
    startRaw: e.start,
    start, end,
    date: dateKey(start),
    venue: v.venue,
    room: v.room,
    venueKey: v.key,
    // No address on the listing: use the one kept for the venue (review page > Venues), if any.
    address: place.address || venueInfo(v.venue).address,
    category,
    description: decode(unescape(e.description)).trim(),
    summary: decode(unescape(e.summary)).trim(),
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
    // Set on dates that come from a repeat rule (see spread above).
    rule: e.repeat || null,
    seriesKey: e.seriesKey || '',
    annual: !!e.annual,
    source,
  };
  // An organizer who sent a flyer and a photo: the photo is the picture on the calendar and in
  // shared links, the flyer shows in full on the event page.
  if (e.photo && /^https:/.test(e.photo)) { out.flyer = out.image; out.image = e.photo; }
  out.topic = topicFor(out);
  if (out.category === 'community' && out.topic?.category) out.category = out.topic.category;
  // No picture of its own: a stock photo of the topic (pickleball, yoga...) when we have one.
  // Shown only from our own copies (thumbs.js); without them the drawn artwork stays.
  // Stock topic photos were turned off on Nov 18 (Charlie): one photo per topic was often wrong for
  // the event (a rock crowd for a jazz concert). Events without a picture show their name card.
  out.audience = audienceOf(out);
  out.town = townOf(out);
  out.area = out.town || areaOf(out);
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
    const [cityRaw, sparkRaw, { events: subsRaw, feeds: feedsRaw, hidden, nopic, featured: featuredList }] = await Promise.all([loadCity(), loadCitySpark(), loadSubmissions()]);
    // Listings Charlie hid on the review page (or that a suggested edit replaced). Only feed listings:
    // his own and organizers' submissions are taken off the calendar with "Remove" instead.
    // A hidden address with a date hides that date; "every date" hides the listing's other dates too.
    const DATED = /-\d{4}-\d{2}-\d{2}(-\d+)?$/;
    const hiddenOne = new Set(hidden.filter((h) => !h.all).map((h) => h.slug.replace(/(-\d{4}-\d{2}-\d{2})-\d+$/, '$1')));
    const hiddenAll = hidden.filter((h) => h.all).map((h) => h.slug.replace(DATED, ''));
    const matcher = (list) => {
      const one = new Set(list.filter((h) => !h.all).map((h) => h.slug.replace(/(-\d{4}-\d{2}-\d{2})-\d+$/, '$1')));
      const all = list.filter((h) => h.all).map((h) => h.slug.replace(DATED, ''));
      return (e) => one.has(e.slug) || all.some((b) => e.slug === b || (e.slug.startsWith(`${b}-`) && DATED.test(e.slug.slice(b.length))));
    };
    const shown = (e) => e && !hiddenOne.has(e.slug) && !hiddenAll.some((b) => e.slug === b || (e.slug.startsWith(`${b}-`) && DATED.test(e.slug.slice(b.length))));
    // Pictures Charlie hid on the review page ("Hidden pictures"): the listing stays, with its name card.
    const noPicture = matcher(nopic);
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
    const today = dateKey(todayWall());
    const subs = subsRaw.flatMap((e) => spread(e, today)).map((e) => normalize(e, 'lllc')).filter(Boolean);
    const subIndex = index(subs);
    // Next: the organizations' own calendars (library, museums...). Their copy links straight to
    // their page, so it beats CitySpark's copy of the same event.
    const direct = feedsRaw.filter((e) => !e.finder).flatMap((e) => spread(e, today)).map((e) => normalize(e, e.feed)).filter((e) => shown(e) && !dupOf(subIndex, e));
    const directIndex = index(direct);
    const spark = sparkRaw.map((e) => normalize(e, 'cityspark')).filter((e) => shown(e) && !dupOf(subIndex, e) && !dupOf(directIndex, e));
    // Between CitySpark and the city feed, keep the CitySpark copy (it has a photo).
    const sparkIndex = index(spark);
    const city = cityRaw.map((e) => normalize(e, 'city-of-las-cruces')).filter((e) => shown(e) && !dupOf(sparkIndex, e) && !dupOf(subIndex, e) && !dupOf(directIndex, e));
    // Last: Visit Las Cruces, used only to find events the others miss (Charlie, Nov 15).
    const cityIndex = index(city);
    const found = feedsRaw.filter((e) => e.finder).map((e) => normalize(e, e.feed))
      .filter((e) => shown(e) && ![subIndex, directIndex, sparkIndex, cityIndex].some((m) => dupOf(m, e)));
    // Sample listings only show on the private preview, never on the live site.
    const ours = [...subs, ...lllcEvents.filter((e) => PREVIEW || !e.sample).flatMap((e) => spread(e, today)).map((e) => normalize(e, 'lllc'))];

    const events = [...direct, ...spark, ...city, ...found, ...ours]
      .filter(Boolean)
      .filter((e) => (e.end ? dateKey(e.end) : e.date) >= today);
    for (const e of events) if (noPicture(e)) { e.image = ''; e.flyer = ''; }
    // Nearby towns: only special events Charlie approved or added (his own listings and the
    // newsletter). A feed's listing from Ruidoso or Deming is left out.
    for (let i = events.length - 1; i >= 0; i--) if (events[i].town && !['lllc', 'newsletter'].includes(events[i].source)) events.splice(i, 1);

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

    // Events with a repeat rule say exactly how they repeat, so use that wording, and count as a
    // series even with only one or two dates inside the window.
    const ruled = new Map();
    for (const e of events) if (e.rule) ruled.set(e.seriesKey, [...(ruled.get(e.seriesKey) || []), e]);
    for (const list of ruled.values()) {
      const first = list[0];
      let s = first.series;
      if (!s) {
        s = { ongoing: false, gap: 7, until: list[list.length - 1], id: first.seriesKey, title: first.title, venue: first.venue, category: first.category, time: timeLabel(first.start), next: first, dates: list };
        series.push(s);
      }
      s.when = describe(first.rule);
      s.ruled = true;
      s.ongoing = false; // a rule is a schedule, not an exhibit that is simply open every day
      list.forEach((e) => { e.series = s; });
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
    // Featured events Charlie picked on the review page ("Featured events"), from any source.
    // Same address matching as hidden listings; each pick can carry its own "until" date.
    const pickFor = (e) => featuredList.find((h) => {
      const b = h.slug.replace(/(-\d{4}-\d{2}-\d{2})-\d+$/, '$1');
      if (!h.all) return e.slug === b || e.slug.replace(/(-\d{4}-\d{2}-\d{2})-\d+$/, '$1') === b;
      const base = b.replace(DATED, '');
      return e.slug === base || (e.slug.startsWith(`${base}-`) && DATED.test(e.slug.slice(base.length)));
    });
    for (const e of kept) {
      const pick = featuredList.length ? pickFor(e) : null;
      if (!pick) continue;
      e.featured = true;
      if (pick.until) e.spotlightUntil = pick.until;
    }
    for (const e of kept) {
      // A Spotlight ends on its "until" date (or with the event itself).
      if (e.spotlightUntil && e.date > e.spotlightUntil) { e.featured = false; e.sponsored = false; }
      e.spotlight = e.featured || e.sponsored;
      // Paid and Featured events always get a full card, even when they repeat.
      e.compact = !e.spotlight && (!!e.series || e.category === 'city-hall');
    }

    // Small copies of the pictures (src/lib/thumbs.js). Adds e.thumbs where it worked.
    // Links to Las Cruces Live and the Art Trail (src/lib/sisters.js): e.acts, e.liveVenueUrl...
    await Promise.all([addThumbs(kept), addSisterLinks(kept)]);

    // The main calendar is the Las Cruces area. Nearby towns' events are listed on /nearby/ and
    // still get their own event pages (allEvents).
    const local = kept.filter((e) => !e.town);
    return {
      events: local,
      allEvents: kept,
      nearby: kept.filter((e) => e.town && !e.ongoing),
      // Day-by-day listings (everything except ongoing exhibits)
      dated: local.filter((e) => !e.ongoing),
      ongoing: ongoing.map((x) => x.next).filter((e) => !e.town),
      series: series.filter((x) => !x.ongoing && !x.next.town),
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

// Wall-clock time plus some hours, rolling past midnight into the next day (a 10 PM start + 2h = midnight).
function addHours(w, n) {
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d, w.H + n, w.M));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), allDay: false };
}

export function googleCalendarLink(e, { offsetIso }) {
  const stamp = (w) => offsetIso(w).replace(/[-:]/g, '').slice(0, 15);
  // All-day events use plain dates (the end date is the day after), so Google shows them as all day.
  const day = (w) => `${w.y}${String(w.m).padStart(2, '0')}${String(w.d).padStart(2, '0')}`;
  const nextDay = (w) => addHours({ ...w, H: 0, M: 0 }, 24);
  // No end time listed: assume two hours.
  const dates = e.start.allDay
    ? `${day(e.start)}/${day(nextDay(e.end?.allDay ? e.end : e.start))}`
    : `${stamp(e.start)}/${stamp(e.end && !e.end.allDay ? e.end : addHours(e.start, 2))}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates,
    ctz: 'America/Denver',
    details: `${e.description.slice(0, 800)}\n\nhttps://events.livelovelascruces.com/event/${e.slug}/`,
    location: e.address || e.venue,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export const categoryOf = (e) => CATEGORIES[e.category];

// Every venue: the master list (src/data/venues.json plus Charlie's edits) and every venue on the
// calendar right now. Each has its address (the one Charlie saved, otherwise the one it is most
// often listed with), its upcoming events and its other spellings. Used by the venue pages and by the venue suggestions on the form.
let venueCache;
export async function getVenues() {
  venueCache ??= (async () => {
    const { events } = await getEvents();
    const map = new Map();
    const entry = (name) => {
      const key = venueKey(name);
      if (!map.has(key)) map.set(key, { key, name, tally: {}, events: [], listed: false, ...venueInfo(name) });
      return map.get(key);
    };
    for (const v of venueList) entry(v.name).listed = true;
    for (const e of events) {
      if (!e.venue || e.venue.length < 3 || !e.venueKey || NO_VENUE.has(fold(e.venue))) continue; // "Las Cruces, NM" isn't a venue
      const v = entry(e.venue);
      v.events.push(e);
      // Feeds sometimes put the venue name in front of the street address: keep the street part.
      const escaped = e.venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const address = (e.address || '').replace(new RegExp(`^${escaped}\\s*[,–-]\\s*`, 'i'), '').trim();
      if (/\d/.test(address) && address.toLowerCase() !== e.venue.toLowerCase()) v.tally[address] = (v.tally[address] || 0) + 1;
    }
    return [...map.values()]
      .map(({ tally, ...v }) => ({ ...v, address: v.address || Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();
  return venueCache;
}
