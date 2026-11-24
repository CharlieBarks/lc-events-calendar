// feeds.js — part of the "lc-events-intake" Worker (imported by intake.js).
//
// Reads the public calendars of local organizations once a night and keeps their upcoming events
// for the site build. No review step: these are the organizations' own listings, and every event
// links back to its page on their site.
//
// To add a source: add an entry to FEEDS with a reader ("tribe", "libcal", "ical" or "wildapricot")
// and add its name to SOURCES in src/lib/site.js (the "Listed by" line on event pages).
//
// Each source is saved on its own (KV: feeds/<id>.json). If one can't be read tonight, last night's
// copy of that source stays in place, so a calendar that is down for a day doesn't empty ours.
// The site build gets everything in one go, inside /approved.json ("feeds").
//
// Events come out in the same shape as the other sources (see normalize in src/lib/events.js):
//   { feed, title, start, end, venue, address, tags, price, description, url, image, slug?, repeat? }
// Times are Las Cruces wall-clock times, as the organizations publish them.

import { tidyRepeat } from './src/lib/repeat.js';

const TZ = 'America/Denver';
const UA = 'Mozilla/5.0 (compatible; LiveLoveLasCruces-Events/1.0; +https://livelovelascruces.com)';
const DAYS_AHEAD = 120;

export const FEEDS = [
  { id: 'library', reader: 'libcal', url: 'https://lascruceslibrary.libcal.com', venue: 'Thomas Branigan Memorial Library', tags: ['Library'] },
  { id: 'cruces-creatives', reader: 'wildapricot', url: 'https://crucescreatives.wildapricot.org/Events/RSS', venue: 'Cruces Creatives', tags: ['Classes', 'Crafts'] },
  { id: 'convention-center', reader: 'tribe', url: 'https://meetinlascruces.com', venue: 'Las Cruces Convention Center', tags: [] },
  { id: 'farm-ranch', reader: 'tribe', url: 'https://nmfarmandranchmuseum.org', venue: 'New Mexico Farm & Ranch Heritage Museum', tags: ['Museum'],
    // Their titles start with the date ("Nov. 21 – HomeGrown"): the calendar already shows the date.
    title: (t) => t.replace(/^[A-Z][a-z]{2,8}\.? \d{1,2}(?:\s*(?:-|–|&|and)\s*\d{1,2})?\s*[–-]\s*/, '') },
  { id: 'organ-mountains', reader: 'tribe', url: 'https://organmountainsdesertpeaks.org', venue: '', tags: ['Hiking', 'Outdoor Recreation'] },
  { id: 'museums', reader: 'assabet', url: 'https://lascruces.assabetinteractive.com/calendar/upcoming-events.exml', venue: '', tags: ['Museum'],
    skip: /registration (period|opens|deadline)|^museums? closed/i },
  // Visit Las Cruces is a finder only (Charlie, Nov 15): we take an event only when it links to the
  // organizer, and we link there, never to their calendar. Their copy loses to any other source.
  { id: 'visit-las-cruces', reader: 'simpleview', url: 'https://www.visitlascruces.com', venue: '', tags: [], finder: true },
  // Town of Mesilla (The Events Calendar). Empty when checked on Nov 15, but it's their official calendar.
  { id: 'mesilla', reader: 'tribe', url: 'https://www.mesillanm.gov', venue: 'Mesilla Plaza', tags: [] },
  { id: 'audubon', reader: 'ical', url: 'https://mvasaudubon.org/feed/my-calendar-ics', venue: '', tags: ['Outdoor Recreation', 'Bird Walk'] },
  // Events from Charlie's own newsletter issues that no other source had. Not read here: a scheduled
  // Claude task writes feeds/newsletter.json after each issue (see SITE.md, "Newsletter check").
  // Each event links to the organizer's page, like every other feed.
  { id: 'newsletter', reader: 'manual', tags: [] },
  // The weekly markets (Farmers & Crafts Market of Las Cruces, Mesilla Mercado), entered by hand as repeat
  // rules in feeds/markets.json. Not read here: a weekly Claude task (Mondays) checks the markets'
  // own pages, the city and Mesilla calendars, and the newsletter for closed or moved dates, and adds
  // them to the rule's skip list or as one-off dates. See SITE.md, "Weekly markets".
  { id: 'markets', reader: 'manual', tags: [] },
];

// ---------- Small helpers ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', eacute: 'é', ntilde: 'ñ', iacute: 'í', aacute: 'á', oacute: 'ó', uacute: 'ú' };
export const decode = (s = '') => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

// HTML -> plain text with paragraph breaks kept.
export const plain = (html = '', max = 1500) => {
  const text = decode(String(html).replace(/\r/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
};
const oneLine = (s = '', max = 160) => decode(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, max);
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60).replace(/-$/, '');
const http = (u) => (/^https?:\/\//i.test(u || '') ? String(u) : '');

const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// An instant (UTC) -> Las Cruces wall-clock "YYYY-MM-DDTHH:MM:00".
const toLocal = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
};
// "2026-12-04 18:30:00" -> "2026-12-04T18:30:00"; all-day -> "2026-12-04".
const stamp = (s, allDay) => {
  const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (!m) return (String(s || '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0];
  return allDay ? m[1] : `${m[1]}T${m[2]}:00`;
};

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// ---------- Readers ----------

// The Events Calendar (WordPress): /wp-json/tribe/events/v1/events
export function readTribe(data, feed) {
  return (data.events || []).map((e) => {
    const v = e.venue && !Array.isArray(e.venue) ? e.venue : {};
    const place = [v.address, v.city, v.stateprovince || v.state || v.province, v.zip].map((x) => oneLine(x)).filter(Boolean);
    const sameDay = String(e.start_date).slice(0, 10) === String(e.end_date).slice(0, 10);
    return {
      title: oneLine(e.title),
      start: stamp(e.start_date, e.all_day),
      // An all-day event on one day has no end worth showing.
      end: e.all_day && sameDay ? '' : stamp(e.end_date, e.all_day),
      venue: oneLine(v.venue) || feed.venue,
      address: place.length ? `${place[0]}${place.length > 1 ? `, ${place.slice(1, 3).join(', ')}${place[3] ? ` ${place[3]}` : ''}` : ''}` : '',
      tags: [...(e.categories || []), ...(e.tags || [])].map((c) => oneLine(c.name)).filter(Boolean),
      price: oneLine(e.cost, 80),
      description: plain(e.description || e.excerpt),
      url: http(e.url),
      image: http(e.image?.sizes?.large?.url || e.image?.url),
    };
  });
}

// LibCal (library calendars): /ajax/calendar/list, a page at a time.
export function readLibcal(data, feed) {
  return (data.results || []).map((e) => {
    const allDay = !!e.all_day;
    const sameDay = String(e.startdt).slice(0, 10) === String(e.enddt).slice(0, 10);
    // "location" is a room at Branigan, or another branch ("Munson Branch Library", "Sage Branch
    // Library", "Munson Room 3"). "campus" is empty in this library's calendar.
    let branch = oneLine(e.campus?.name ?? e.campus) || feed.venue;
    let room = oneLine(e.location?.name ?? e.location);
    const other = room.match(/^(munson|sage)\b/i);
    if (other) {
      branch = `${other[1][0].toUpperCase()}${other[1].slice(1).toLowerCase()} Branch Library`;
      room = /branch library$/i.test(room) ? '' : room.replace(/^(munson|sage)\s*/i, '');
    } else if (/^(thomas )?branigan( memorial)? library$/i.test(room)) room = '';
    const names = (list) => (Array.isArray(list) ? list.map((x) => oneLine(x?.name ?? x)).filter(Boolean) : []);
    return {
      title: oneLine(e.title),
      start: stamp(e.startdt, allDay),
      end: allDay && sameDay ? '' : stamp(e.enddt, allDay),
      venue: room && room.toLowerCase() !== branch.toLowerCase() ? `${branch} > ${room}` : branch,
      address: '',
      tags: [...names(e.categories_arr), ...names(e.categories), ...names(e.audiences)],
      price: oneLine(e.registration_cost, 80),
      description: plain(e.description || e.shortdesc),
      url: http(e.url),
      image: http(e.featured_image),
    };
  });
}

// iCalendar (.ics). Times are read as written (wall-clock), whatever time zone label the file carries:
// small calendar plugins often label local times as UTC.
export function readIcal(text, feed) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  const unesc = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  const when = (v) => {
    const m = String(v).match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    return m ? (m[4] ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00` : `${m[1]}-${m[2]}-${m[3]}`) : '';
  };
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    cur[name] = line.slice(i + 1);
  }
  const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  return out.map((e) => {
    const start = when(e.DTSTART);
    const title = oneLine(unesc(e.SUMMARY || ''));
    // "Mesilla Valley Bosque State Park 5000 Calle Del Norte, Las Cruces, NM 88005": the name, then the street.
    // Some plugins repeat the city after two spaces ("…NM 88005  Las Cruces NM 88005"): keep the first part.
    const loc = unesc(e.LOCATION || '').trim().split(/\s{2,}/)[0].replace(/\s+/g, ' ');
    const cut = loc.search(/\s\d{2,5}\s+[A-Za-z]/);
    const item = {
      title,
      start,
      end: when(e.DTEND),
      venue: (cut > 0 ? loc.slice(0, cut) : loc).trim() || feed.venue,
      address: cut > 0 ? loc.slice(cut).trim() : '',
      tags: String(e.CATEGORIES || '').split(',').map((c) => oneLine(unesc(c))).filter(Boolean),
      price: '',
      description: plain(unesc(e['X-ALT-DESC'] || e.DESCRIPTION || '')),
      url: http(e.URL),
      image: '',
    };
    // Repeats we can express: weekly on set days, or monthly on "the 2nd Saturday" / the same date.
    const rule = Object.fromEntries(String(e.RRULE || '').split(';').filter(Boolean).map((p) => p.split('=')));
    if (rule.FREQ && start) {
      const until = when(rule.UNTIL).slice(0, 10);
      const every = Number(rule.INTERVAL) || 1;
      const date = start.slice(0, 10);
      let repeat = null;
      if (rule.FREQ === 'WEEKLY') {
        const days = String(rule.BYDAY || '').split(',').map((d) => DAY[d]).filter((d) => d !== undefined);
        repeat = { freq: 'weekly', every, days: days.length ? days : [new Date(`${date}T12:00:00Z`).getUTCDay()], start: date, until };
      } else if (rule.FREQ === 'MONTHLY' && !String(rule.BYDAY || '').includes(',')) {
        repeat = { freq: 'monthly', every, by: rule.BYDAY ? 'weekday' : 'date', start: date, until };
      }
      const tidy = repeat && tidyRepeat(repeat);
      if (tidy) { item.repeat = tidy; item.slug = slugify(`${title} ${feed.id}`); }
    }
    return item;
  });
}

// Wild Apricot's events RSS. An item has a title, a link, the start time (as pubDate) and a
// description that may open with a picture. No end time.
export function readWildApricot(xml, feed) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  const tag = (x, t) => decode((x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
  return items.map((x) => {
    const at = new Date(tag(x, 'pubDate'));
    const body = tag(x, 'description');
    return {
      // "Homeschool Woodworking (2026-11-17)": the date is ours to show.
      title: oneLine(tag(x, 'title').replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '')),
      start: Number.isNaN(at.getTime()) ? '' : toLocal(at),
      end: '',
      venue: feed.venue,
      address: '',
      tags: [],
      price: '',
      description: plain(body),
      url: http(tag(x, 'link')),
      image: http((body.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1]),
    };
  });
}

// Assabet Interactive (Las Cruces Museums): an XML list of upcoming events, one <item> each, with
// <date1>2026/11/17</date1>, <time>5:00 PM</time>, <library>Museum of Art, 455 N Main St, …</library>.
export function readAssabet(xml, feed) {
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/g) || [];
  const tag = (x, t) => decode((x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
  const clock = (t) => {
    const m = String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return '';
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  };
  return items.map((x) => {
    const day = tag(x, 'date1').replace(/\//g, '-');
    const endDay = tag(x, 'enddate1').replace(/\//g, '-') || day;
    const start = clock(tag(x, 'time'));
    const end = clock(tag(x, 'endtime'));
    // "12:00 AM to 11:59 PM" is how it writes an all-day item.
    const allDay = start === '00:00' && (end === '23:59' || !end);
    const [place, ...addr] = tag(x, 'library').split(',').map((p) => p.trim());
    const room = tag(x, 'location');
    return {
      title: oneLine(tag(x, 'title')),
      start: allDay ? day : `${day}T${start}:00`,
      end: allDay ? (endDay !== day ? endDay : '') : end ? `${endDay}T${end}:00` : '',
      venue: room && room.toLowerCase() !== place.toLowerCase() ? `${place} > ${room}` : place || feed.venue,
      address: addr.join(', '),
      tags: tag(x, 'eventtypes').split(',').map((t) => t.trim()).filter((t) => t && t !== 'All'),
      price: '',
      description: plain(tag(x, 'description')),
      url: http(tag(x, 'link')),
      image: http(tag(x, 'imagepath')),
    };
  });
}

// Simpleview (Visit Las Cruces): the same search their calendar page uses. It needs a short-lived
// token from the site, then returns one entry per date in the range asked for.
export function readSimpleview(data, feed) {
  const hm = (t) => (String(t || '').match(/^(\d{2}):(\d{2})/) || []).slice(1).join(':');
  return (data.docs?.docs || []).map((e) => {
    // "date" is the end of that day in Las Cruces, written in UTC (06:59:59Z the next morning).
    const day = e.date ? dayKey(new Date(e.date)) : '';
    const start = hm(e.startTime);
    const end = hm(e.endTime);
    const link = http(e.linkUrl);
    return {
      title: oneLine(e.title),
      start: start ? `${day}T${start}:00` : day,
      end: start && end && end !== start ? `${day}T${end}:00` : '',
      venue: oneLine(e.location) || oneLine(e.hostname) || feed.venue,
      address: [oneLine(e.address1), oneLine(e.city), [oneLine(e.state), oneLine(e.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      tags: (e.categories || []).map((c) => oneLine(c.catName)).filter((c) => c && c !== 'Events'),
      price: oneLine(e.admission, 80),
      description: plain(e.description, 800),
      // Only the organizer's own link; never a link back to Visit Las Cruces.
      url: /visitlascruces\.com/i.test(link) ? '' : link,
      image: http(e.media_raw?.[0]?.mediaurl),
    };
  });
}

async function readSimpleviewFeed(feed) {
  const token = (await get(`${feed.url}/plugins/core/get_simple_token/`)).trim();
  const today = dayKey(new Date());
  const range = { start: { $date: `${today}T07:00:00.000Z` }, end: { $date: `${addDays(today, 60)}T07:00:00.000Z` } };
  const out = [];
  for (let skip = 0; skip < 1500; skip += 200) {
    const q = { filter: { active: true, date_range: range }, options: { limit: 200, skip, count: true, castDocs: false, sort: { date: 1 } } };
    const data = await get(`${feed.url}/includes/rest_v2/plugins_events_events_by_date/find/?json=${encodeURIComponent(JSON.stringify(q))}&token=${encodeURIComponent(token)}`, 'json');
    const batch = readSimpleview(data, feed);
    out.push(...batch);
    if (batch.length < 200 || out.length >= (data.docs?.count || 0)) break;
  }
  return out;
}

// ---------- Reading one source ----------

async function readFeed(feed) {
  if (feed.reader === 'tribe') {
    const out = [];
    for (let page = 1; page <= 4; page++) {
      const data = await get(`${feed.url}/wp-json/tribe/events/v1/events?per_page=50&page=${page}`, 'json');
      out.push(...readTribe(data, feed));
      if (page >= (data.total_pages || 1)) break;
    }
    return out;
  }
  if (feed.reader === 'libcal') {
    const out = [];
    for (let page = 1; page <= 8; page++) {
      const data = await get(`${feed.url}/ajax/calendar/list?c=-1&date=0000-00-00&perpage=48&page=${page}&audience=&cats=&camps=&inc=0`, 'json');
      const batch = readLibcal(data, feed);
      out.push(...batch);
      if (batch.length < 48 || out.length >= (data.total_results || 0)) break;
    }
    return out;
  }
  if (feed.reader === 'ical') return readIcal(await get(feed.url), feed);
  if (feed.reader === 'simpleview') return readSimpleviewFeed(feed);
  if (feed.reader === 'assabet') return readAssabet(await get(feed.url), feed);
  if (feed.reader === 'wildapricot') return readWildApricot(await get(feed.url), feed);
  throw new Error(`Unknown reader ${feed.reader}`);
}

// Keeps what is usable and upcoming, adds the source's own tags, and drops exact repeats.
export function tidyFeed(items, feed, today = dayKey(new Date())) {
  const last = addDays(today, DAYS_AHEAD);
  const seen = new Set();
  const out = [];
  for (const e of items) {
    const title = feed.title ? feed.title(e.title) : e.title;
    if (feed.skip?.test(title)) continue; // not an event people go to ("Registration Period")
    if (!title || !/^\d{4}-\d{2}-\d{2}/.test(e.start) || !e.url) continue;
    const startDay = e.start.slice(0, 10);
    const endDay = e.repeat ? (e.repeat.until || last) : (e.end || e.start).slice(0, 10);
    if (endDay < today || startDay > last) continue;
    const key = `${title.toLowerCase()}|${e.start}|${e.venue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e, title, feed: feed.id, tags: [...new Set([...(e.tags || []), ...feed.tags])], ...(feed.finder ? { finder: true } : {}) });
  }
  return out;
}

// ---------- The nightly run ----------

export async function refreshFeeds(env) {
  const report = {};
  await Promise.all(FEEDS.filter((feed) => feed.reader !== 'manual').map(async (feed) => {
    try {
      const events = tidyFeed(await readFeed(feed), feed);
      await env.MEDIA.put(`feeds/${feed.id}.json`, JSON.stringify({ at: new Date().toISOString(), events }));
      report[feed.id] = { ok: true, count: events.length };
    } catch (err) {
      // Last night's copy of this source stays where it is.
      report[feed.id] = { ok: false, error: String(err.message || err).slice(0, 200) };
      console.log(`Feed ${feed.id} not read: ${err.message}`);
    }
  }));
  await env.MEDIA.put('feeds/report.json', JSON.stringify({ at: new Date().toISOString(), feeds: report }));
  return report;
}

// Everything saved, for the site build. Events that have ended since they were saved are left out.
export async function getFeedEvents(env) {
  const today = dayKey(new Date());
  const saved = await Promise.all(FEEDS.map((feed) => env.MEDIA.get(`feeds/${feed.id}.json`, 'json')));
  return saved.flatMap((s) => s?.events || []).filter((e) => e.repeat || (e.end || e.start).slice(0, 10) >= today);
}
