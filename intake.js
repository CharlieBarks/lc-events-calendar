// intake.js — deployed as the "lc-events-intake" Cloudflare Worker (Live Love Las Cruces account).
//
// Event submissions for the calendar:
//   POST /extract        flyer image (multipart "image") -> saves it full size and reads the event details off it
//                        (both POSTs carry a Turnstile token, "human": see isHuman below)
//   POST /submit         the finished form (JSON) -> waits in Charlie's review queue
//   GET  /mine?key=       the submitter's own submission, for their private edit link
//   POST /update          changes from that edit link (JSON, with "key")
//   GET  /approved.json  approved submissions in the calendar's format (the site build reads this)
//   GET  /img/<id>.jpg   a submitted flyer, full size
//   GET  /review/        Charlie's review queue (behind Cloudflare Access: Charlie only)
//   /review/api/...      approve / reject / remove / flags (also behind Access)
//   GET  /feeds.json     what last night's reading of other calendars brought in (see feeds.js)
//
// Hidden listings: Charlie can hide any listing that came from a feed (review page, "Hidden
// listings"). The list rides along in /approved.json ("hidden") and the site build leaves those out.
// "Suggest an edit" on an event page opens the form filled in with that listing; the result waits in
// the review queue marked as a suggested change, and approving it hides the original listing.
//   GET  /venues.json    Charlie's venue edits (the site build merges them into the master venue list)
//   GET  /review/venues/ the Venues screen: names, addresses, other spellings (behind Access)
//
// Edit links: every submission gets a secret key ("<id>.<token>"). The form shows the submitter a
// private link carrying it (/submit/?edit=<key>). Whoever has the link can change that one
// submission. A change to something still waiting simply updates it. A change to something already
// on the calendar waits in the review queue as "Changed by the organizer"; the calendar keeps the
// old version until Charlie approves. Charlie can reopen any approved event the same way ("Edit").
//
// Repeating events: the form can send repeat: { freq, every, days, by, until, skip } (see
// src/lib/repeat.js). The first date row gives the start date and the times. An approved repeating
// event is ONE entry in approved.json carrying the rule; the site build turns it into dates.
// annual: true marks a once-a-year event (kept with the entry for the site to use).
//
// Spotlight (paid boost, $50): the form can send boost: "spotlight". It waits in the queue like
// everything else, marked "Spotlight requested"; Charlie checks Stripe, then approves with
// Sponsored ticked. Sponsored events are pinned to the top of their day and rotate through the
// homepage Spotlight section until "spotlightUntil" (default: the event's last date).
//
// Storage: KV namespace lc-events-media (bound as MEDIA), keys under sub/.
// Flyer reading: Workers AI (Llama 4 Scout, bound as AI). If an ANTHROPIC_API_KEY secret is added,
// Claude reads flyers instead (more accurate on busy flyers).
// Email (Cloudflare Email Service, bound as EMAIL; livelovelascruces.com is the sending domain): a thank-you
// with the private edit link when someone submits, a note when their event goes on the calendar, and a
// heads-up to Charlie (NOTIFY_TO) for every new submission and organizer change. See "Email" below.
// Approving rebuilds the calendar through the deploy hooks in the DEPLOY_HOOKS secret (comma-separated URLs).
// The same hooks are called once a day on a schedule (see "scheduled" at the bottom), CitySpark or not.

import { tidyRepeat, describe, expand, addDaysKey } from './src/lib/repeat.js';
import { fold, venueKey, mergeVenues } from './src/lib/venue-merge.js';
import venueData from './src/data/venues.json';
import { refreshFeeds, getFeedEvents } from './feeds.js';

const TZ = 'America/Denver';
const PUBLIC_ORIGIN = 'https://lc-events-intake.cf2-99b.workers.dev';
const ALLOWED_ORIGINS = [
  'https://events.livelovelascruces.com',
  'https://lc-events-calendar.cf2-99b.workers.dev',
  'https://lc-events-preview.cf2-99b.workers.dev',
  'http://localhost:4321',
];
// Same keys as CATEGORIES in src/lib/site.js.
const CATEGORY_NAMES = {
  'live-music': 'Live Music', 'arts-culture': 'Arts & Culture', 'food-drink': 'Food & Drink', markets: 'Markets',
  family: 'Family & Kids', sports: 'Sports', fitness: 'Fitness & Rec', community: 'Community', 'city-hall': 'City Hall & Meetings',
};
const CATEGORIES = Object.keys(CATEGORY_NAMES);
const MAX_IMAGE = 15e6;
const UNSUBMITTED_TTL = 60 * 60 * 24 * 3; // flyers uploaded but never submitted disappear after 3 days

const json = (data, init = {}, origin) =>
  new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json', ...cors(origin), ...(init.headers || {}) } });

function cors(origin) {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' };
}

const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const newId = () => `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
const clean = (v, max = 500) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const cleanText = (v, max = 3000) => (typeof v === 'string' ? v.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isTime = (s) => /^\d{2}:\d{2}$/.test(s || '');
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60).replace(/-$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Email ----------
// Sent from events@livelovelascruces.com; replies go to Charlie (NOTIFY_TO). Sending never holds up or
// breaks a submission: it runs after the answer has gone out, and a failure is only written to the log.
// No EMAIL binding (local testing) = nothing is sent.
const MAIL_FROM = { email: 'events@livelovelascruces.com', name: 'Live Love Las Cruces' };
const LIVE_SITE = 'https://lc-events-calendar.cf2-99b.workers.dev'; // becomes events.livelovelascruces.com when the domain moves
const siteFor = (origin) => (origin && ALLOWED_ORIGINS.includes(origin) && !origin.includes('localhost') ? origin : LIVE_SITE);
const firstName = (name) => clean(name, 100).split(' ')[0] || 'there';

async function sendMail(env, to, subject, paragraphs) {
  if (!env.EMAIL || !to) return;
  // A paragraph is plain text, or { text, href } for a link on its own line.
  const text = paragraphs.map((p) => (typeof p === 'string' ? p : `${p.text}\n${p.href}`)).join('\n\n');
  const html = `<div style="font:16px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2a44;max-width:560px">${paragraphs
    .map((p) => (typeof p === 'string'
      ? `<p style="margin:0 0 16px">${esc(p).replace(/\n/g, '<br>')}</p>`
      : `<p style="margin:0 0 16px">${esc(p.text)}<br><a href="${esc(p.href)}" style="color:#b23a2b">${esc(p.href)}</a></p>`))
    .join('')}</div>`;
  try {
    await env.EMAIL.send({ from: MAIL_FROM, to, subject, text, html, ...(env.NOTIFY_TO ? { replyTo: env.NOTIFY_TO } : {}) });
  } catch (err) {
    console.log('Email not sent', subject, err.code || '', err.message);
  }
}

const SIGN_OFF = 'Charlie Barks\nLive Love Las Cruces';
const whenLine = (rec) => (rec.repeat ? describe(rec.repeat) : rec.shows.map((s) => s.date).join(', '));

// To the submitter, right after they send an event.
function mailThanks(env, rec, site) {
  return sendMail(env, rec.contact?.email, rec.suggests ? `Thank you for the fix to "${rec.title}"` : `Thank you! "${rec.title}" is in`, [
    `Hi ${firstName(rec.contact?.name)},`,
    ...(rec.suggests ? [`Thank you for taking the time to correct "${rec.title}" on the Las Cruces events calendar. Fixes like yours are how this calendar stays right.`] : []),
    ...(rec.suggests ? [] : [`Thank you for adding "${rec.title}" to the Las Cruces events calendar. I mean that. This calendar only works because people like you take a few minutes to share what's happening, and every event you add helps a neighbor find something good to do in town.`]),
    `Here's what happens next: I look over every event myself, usually within a day. You'll hear from me again as soon as it's on the calendar.`,
    { text: 'Need to fix a time or swap the flyer? This is your private edit link. Keep it handy, and only share it with someone you want editing this event:', href: `${site}/submit/?edit=${rec.id}.${rec.token}` },
    `Got more coming up? Add as many as you like: ${site}/submit/`,
    `Thanks again for showing up for Las Cruces.`,
    SIGN_OFF,
  ]);
}

// To the submitter, when Charlie approves it (or approves a change they made).
function mailApproved(env, rec, wasChange) {
  const site = rec.site || LIVE_SITE;
  const page = rec.repeat ? `${site}/` : `${site}/event/${toCalendarEvents(rec)[0].slug}/`;
  return sendMail(env, rec.contact?.email, wasChange ? `Your changes to "${rec.title}" are live` : `"${rec.title}" is on the calendar`, [
    `Hi ${firstName(rec.contact?.name)},`,
    wasChange
      ? `Your changes to "${rec.title}" are approved and on the Las Cruces events calendar.`
      : `Good news: "${rec.title}" is approved and on the Las Cruces events calendar. Thank you for sharing it. Events like yours are what make this town feel like home.`,
    { text: 'It shows up within a few minutes here:', href: page },
    `Share that link anywhere you like. The more people who see it, the better the turnout.`,
    ...(rec.token ? [{ text: 'If anything changes, your private edit link still works:', href: `${site}/submit/?edit=${rec.id}.${rec.token}` }] : []),
    SIGN_OFF,
  ]);
}

// To Charlie: something new is waiting in the review queue.
function mailCharlie(env, rec, what) {
  return sendMail(env, env.NOTIFY_TO, `${what}: ${rec.title}`, [
    `${what} on the events calendar.`,
    `${rec.title}\n${rec.venue}\n${whenLine(rec)}\nFrom ${rec.contact?.name || 'someone'} (${rec.contact?.email || 'no email'})${rec.boost ? '\nSpotlight requested' : ''}`,
    { text: 'Review it here:', href: `${PUBLIC_ORIGIN}/review/` },
  ]);
}

// ---------- "Are you a person?" (Cloudflare Turnstile) ----------
// The form sends a one-time token with every upload and every submission; this asks Cloudflare
// whether it is real. Set up with the TURNSTILE_SECRET secret (no secret = no check).
// TURNSTILE_ENFORCE = "1" turns failures away. Anything else only writes them to the log, which
// is how this was switched on safely: watch the log first, then enforce.
async function isHuman(env, token, ip, what) {
  if (!env.TURNSTILE_SECRET) return true;
  let ok = false;
  let why = 'no token';
  if (token) {
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token), remoteip: ip }),
      });
      const data = await res.json();
      ok = !!data.success;
      why = (data['error-codes'] || []).join(',') || 'rejected';
    } catch (err) {
      // Cloudflare's checker itself is unreachable: don't punish real people for that.
      console.log('Turnstile unreachable, letting it through', err.message);
      return true;
    }
  }
  if (ok) return true;
  console.log(`Turnstile failed on ${what} (${why})${env.TURNSTILE_ENFORCE === '1' ? '' : ', not enforced'}`);
  return env.TURNSTILE_ENFORCE !== '1';
}
const NOT_HUMAN = "Couldn't confirm you're a person. Reload the page and try once more.";

// ---------- Reading a flyer ----------

function flyerPrompt() {
  return `You read event flyers for a local events calendar in Las Cruces and Mesilla, New Mexico. Today is ${todayLocal()}.
Read the flyer and return ONLY a JSON object, no other text:
{
  "title": "event name (for a show, the act's name, e.g. 'Desert Rose Trio')",
  "performers": "acts playing, comma separated, or empty",
  "venue": "venue name",
  "address": "street address if shown, else empty",
  "category": one of ${JSON.stringify(CATEGORIES)},
  "price": "e.g. 'Free', 'No cover', '$10', '$15 advance / $20 door', or empty",
  "url": "ticket or info website if printed, else empty",
  "description": "1-2 plain sentences about the event using only what the flyer says",
  "shows": [ { "date": "YYYY-MM-DD", "start": "HH:MM 24-hour or empty", "end": "HH:MM 24-hour or empty", "title": "only if this date has a different act than the main title, else empty" } ],
  "missing": ["fields you could not find on the flyer, from: date, start, venue, price"]
}
Rules: list every date on the flyer as its own show. If no year is printed, use the next upcoming date. "Every Friday in November" with dates listed means one show per listed date. Leave anything not on the flyer empty; never guess. Times like "7-10pm" mean start 19:00, end 22:00.`;
}

function parseJSON(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readFlyer(env, buf, type) {
  const b64 = toBase64(buf);
  if (env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-haiku-5-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: type, data: b64 } },
          { type: 'text', text: flyerPrompt() },
        ] }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const parsed = parseJSON(data.content?.map((c) => c.text || '').join(''));
      if (parsed) return { ...parsed, reader: 'claude' };
    }
    console.log('Claude flyer read failed, falling back to Workers AI', res.status);
  }
  const out = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
    messages: [{ role: 'user', content: [
      { type: 'text', text: flyerPrompt() },
      { type: 'image_url', image_url: { url: `data:${type};base64,${b64}` } },
    ] }],
    max_tokens: 1500,
    temperature: 0,
  });
  return { ...(parseJSON(out?.response) || {}), reader: 'workers-ai' };
}

// Flyers often say "Monday, Nov 11" with no year, and the model may pick the year that matches the
// weekday. Events are always upcoming, so a date in the past moves to its next upcoming year.
function upcoming(date) {
  if (!isDate(date)) return '';
  const today = todayLocal();
  if (date >= today) return date;
  let y = Number(today.slice(0, 4));
  let d = `${y}${date.slice(4)}`;
  if (d < today) d = `${y + 1}${date.slice(4)}`;
  return d;
}

function tidyExtract(x = {}) {
  const shows = (Array.isArray(x.shows) ? x.shows : [])
    .map((s) => ({ date: upcoming(s?.date), start: isTime(s?.start) ? s.start : '', end: isTime(s?.end) ? s.end : '', title: clean(s?.title, 120) }))
    .filter((s) => s.date || s.start)
    .slice(0, 20);
  return {
    title: clean(x.title, 140),
    performers: clean(x.performers, 300),
    venue: clean(x.venue, 140),
    address: clean(x.address, 200),
    category: CATEGORIES.includes(x.category) ? x.category : '',
    price: clean(x.price, 80),
    url: /^https?:\/\//i.test(x.url || '') ? clean(x.url, 400) : x.url && /\.[a-z]{2,}/i.test(x.url) ? `https://${clean(x.url, 400)}` : '',
    description: cleanText(x.description, 600),
    shows: shows.length ? shows : [{ date: '', start: '', end: '', title: '' }],
  };
}

async function handleExtract(request, env, origin) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key: `extract:${ip}` });
    if (!success) return json({ error: 'Too many uploads in a row. Give it a minute and try again.' }, { status: 429 }, origin);
  }
  const form = await request.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') return json({ error: 'No image received.' }, { status: 400 }, origin);
  if (!(await isHuman(env, form.get('human'), ip, 'upload'))) return json({ error: NOT_HUMAN }, { status: 403 }, origin);
  if (file.size > MAX_IMAGE) return json({ error: 'That image is too big. Try a screenshot of it instead.' }, { status: 413 }, origin);
  const type = /^image\/(jpeg|png|webp|gif)$/.test(file.type) ? file.type : 'image/jpeg';
  const buf = await file.arrayBuffer();
  const id = newId();
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
  const imageId = `${id}.${ext}`;
  await env.MEDIA.put(`sub/upload/${imageId}`, buf, { expirationTtl: UNSUBMITTED_TTL, metadata: { type } });

  let extracted = null;
  let readError = '';
  // ?read=0: just a photo for the listing, nothing to read.
  if (new URL(request.url).searchParams.get('read') === '0') return json({ imageId, imageUrl: `${PUBLIC_ORIGIN}/img/${imageId}`, extracted: null }, {}, origin);
  try {
    extracted = tidyExtract(await readFlyer(env, buf, type));
  } catch (err) {
    readError = err.message;
    console.log('Flyer read failed', err.message);
  }
  return json({ imageId, imageUrl: `${PUBLIC_ORIGIN}/img/${imageId}`, extracted, readError: readError ? 'Could not read the flyer automatically.' : '' }, {}, origin);
}

// ---------- Submissions ----------

function tidySubmission(b) {
  const shows = (Array.isArray(b.shows) ? b.shows : [])
    .map((s) => ({ date: isDate(s?.date) ? s.date : '', start: isTime(s?.start) ? s.start : '', end: isTime(s?.end) ? s.end : '', title: clean(s?.title, 140) }))
    .filter((s) => s.date)
    .slice(0, 20);
  // A repeat rule starts on the first date row.
  const repeat = b.repeat && shows.length ? tidyRepeat({ ...b.repeat, start: shows[0].date }) : null;
  return {
    repeat,
    annual: !!b.annual,
    title: clean(b.title, 140),
    performers: clean(b.performers, 300),
    venue: clean(b.venue, 140),
    address: clean(b.address, 200),
    category: CATEGORIES.includes(b.category) ? b.category : 'community',
    price: clean(b.price, 80),
    url: /^https?:\/\//i.test(b.url || '') ? clean(b.url, 400) : '',
    description: cleanText(b.description, 2000),
    shows: repeat ? shows.slice(0, 1) : shows,
    imageId: /^[a-z0-9]+\.(jpg|png|webp|gif)$/.test(b.imageId || '') ? b.imageId : '',
    contact: { name: clean(b.name, 100), email: clean(b.email, 160), phone: clean(b.phone, 40) },
    act: clean(b.act, 140), // set when a musician comes from their Las Cruces Live page
    boost: b.boost === 'spotlight' ? 'spotlight' : '', // asked for the paid Spotlight package
    source: clean(b.source, 40) || 'form',
    // "Suggest an edit": the calendar listing this replaces (its address on the site), and the
    // picture that listing already had, so an approved suggestion doesn't lose it.
    suggests: /^[a-z0-9-]{3,140}$/.test(b.suggests || '') ? b.suggests : '',
    imageUrl: /^https:\/\//i.test(b.imageUrl || '') ? clean(b.imageUrl, 500) : '',
  };
}

async function handleSubmit(request, env, origin, ctx) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key: `submit:${ip}` });
    if (!success) return json({ error: 'Too many submissions in a row. Give it a minute and try again.' }, { status: 429 }, origin);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, { status: 400 }, origin); }
  if (body.website) return json({ ok: true }, {}, origin); // honeypot: bots fill every field
  if (!(await isHuman(env, body.human, ip, 'submission'))) return json({ error: NOT_HUMAN }, { status: 403 }, origin);
  const sub = tidySubmission(body);
  const problems = [];
  if (!sub.title) problems.push('event name');
  if (!sub.shows.length) problems.push('date');
  if (!sub.venue) problems.push('where it is');
  if (!sub.contact.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sub.contact.email)) problems.push('your name and email');
  if (problems.length) return json({ error: `Please add: ${problems.join(', ')}.` }, { status: 400 }, origin);

  // Keep the flyer for good: move it out of the "uploaded" area (which expires).
  if (sub.imageId) {
    const { value, metadata } = await env.MEDIA.getWithMetadata(`sub/upload/${sub.imageId}`, 'arrayBuffer');
    if (value) await env.MEDIA.put(`sub/img/${sub.imageId}`, value, { metadata });
    else sub.imageId = '';
  }
  const id = newId();
  const token = newToken();
  const record = { id, token, status: 'pending', submittedAt: new Date().toISOString(), ip, site: siteFor(origin), ...sub };
  await env.MEDIA.put(`sub/pending/${id}`, JSON.stringify(record));
  ctx.waitUntil(Promise.all([mailThanks(env, record, record.site), mailCharlie(env, record, record.suggests ? 'Suggested edit' : 'New event')]));
  return json({ ok: true, id, key: `${id}.${token}`, shows: sub.shows.length }, {}, origin);
}

// ---------- The submitter's edit link ----------

const newToken = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Finds the submission a key belongs to: waiting first, then already reviewed.
async function findMine(env, key) {
  const [id, token] = String(key || '').split('.');
  if (!/^[a-z0-9]{6,40}$/.test(id || '') || !/^[a-f0-9]{36}$/.test(token || '')) return null;
  const pending = await env.MEDIA.get(`sub/pending/${id}`, 'json');
  const done = pending ? null : await env.MEDIA.get(`sub/done/${id}`, 'json');
  const rec = pending || done;
  if (!rec || !rec.token || rec.token !== token) return null;
  return { rec, live: !!done || !!pending?.change };
}

async function handleMine(request, env, origin) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key: `mine:${ip}` });
    if (!success) return json({ error: 'Too many tries. Give it a minute.' }, { status: 429 }, origin);
  }
  const found = await findMine(env, new URL(request.url).searchParams.get('key'));
  if (!found) return json({ error: "That edit link doesn't match any event. It may have been removed." }, { status: 404 }, origin);
  const { rec } = found;
  if (rec.status === 'rejected') return json({ error: "This one wasn't added to the calendar, so it can't be changed here. Send it again as a new event." }, { status: 410 }, origin);
  // Only what the form needs. Never the token, IP or review notes.
  return json({
    status: rec.status === 'approved' && !rec.change ? 'live' : rec.change ? 'change-waiting' : 'waiting',
    title: rec.title, venue: rec.venue, address: rec.address, category: rec.category, price: rec.price, url: rec.url,
    description: rec.description, shows: rec.shows, repeat: rec.repeat || null, annual: !!rec.annual,
    imageId: rec.imageId || '', imageUrl: rec.imageId ? `${PUBLIC_ORIGIN}/img/${rec.imageId}` : '',
    name: rec.contact?.name || '', email: rec.contact?.email || '', phone: rec.contact?.phone || '',
  }, { headers: { 'cache-control': 'no-store' } }, origin);
}

async function handleUpdate(request, env, origin, ctx) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key: `submit:${ip}` });
    if (!success) return json({ error: 'Too many changes in a row. Give it a minute and try again.' }, { status: 429 }, origin);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, { status: 400 }, origin); }
  if (!(await isHuman(env, body.human, ip, 'change'))) return json({ error: NOT_HUMAN }, { status: 403 }, origin);
  const found = await findMine(env, body.key);
  if (!found || found.rec.status === 'rejected') return json({ error: "That edit link doesn't match any event." }, { status: 404 }, origin);
  const { rec, live } = found;
  const sub = tidySubmission(body);
  const problems = [];
  if (!sub.title) problems.push('event name');
  if (!sub.shows.length) problems.push('date');
  if (!sub.venue) problems.push('where it is');
  if (problems.length) return json({ error: `Please add: ${problems.join(', ')}.` }, { status: 400 }, origin);
  // A new picture moves out of the "uploaded" area; otherwise keep the one it had.
  if (sub.imageId && sub.imageId !== rec.imageId) {
    const { value, metadata } = await env.MEDIA.getWithMetadata(`sub/upload/${sub.imageId}`, 'arrayBuffer');
    if (value) await env.MEDIA.put(`sub/img/${sub.imageId}`, value, { metadata });
    else sub.imageId = rec.imageId || '';
  }
  // The organizer can't hand themselves a Spotlight or change who submitted it.
  const next = {
    ...rec, ...sub,
    contact: { name: sub.contact.name || rec.contact?.name || '', email: rec.contact?.email || '', phone: sub.contact.phone || rec.contact?.phone || '' },
    boost: rec.boost || '', source: rec.source, act: rec.act,
    id: rec.id, token: rec.token, submittedAt: rec.submittedAt, ip: rec.ip,
    status: 'pending', changedAt: new Date().toISOString(),
    // Already on the calendar: the old version stays live until Charlie approves this one.
    ...(live ? { change: true, changedBy: 'organizer' } : {}),
  };
  await env.MEDIA.put(`sub/pending/${rec.id}`, JSON.stringify(next));
  ctx.waitUntil(mailCharlie(env, next, live ? 'Organizer changed a live event' : 'Organizer updated a waiting event'));
  return json({ ok: true, id: rec.id, live }, {}, origin);
}

// ---------- Approved events -> calendar ----------

function toCalendarEvents(rec) {
  const shows = rec.repeat ? rec.shows.slice(0, 1) : rec.shows;
  return shows.map((s, i) => {
    const title = s.title || rec.title;
    const start = s.start ? `${s.date}T${s.start}:00` : s.date; // no time = all day
    let end = '';
    if (s.end) {
      // A show that ends after midnight ends the next day.
      const nextDay = s.start && s.end < s.start;
      const d = new Date(`${s.date}T12:00:00Z`);
      if (nextDay) d.setUTCDate(d.getUTCDate() + 1);
      end = `${d.toISOString().slice(0, 10)}T${s.end}:00`;
    }
    return {
      // A repeating event's slug has no date: the site adds each date to it.
      slug: rec.repeat ? slugify(title) : `${slugify(title)}-${s.date}${rec.shows.length > 1 && rec.shows.filter((x) => x.date === s.date).length > 1 ? `-${i + 1}` : ''}`,
      title,
      start,
      end,
      venue: rec.venue,
      address: rec.address,
      category: rec.category,
      price: rec.price,
      description: rec.description || (rec.performers ? `With ${rec.performers}.` : ''),
      url: rec.url,
      image: rec.imageId ? `${PUBLIC_ORIGIN}/img/${rec.imageId}` : rec.imageUrl || '',
      featured: !!rec.featured,
      sponsored: !!rec.sponsored,
      spotlightUntil: rec.spotlightUntil || '',
      submissionId: rec.id,
      ...(rec.repeat ? { repeat: rec.repeat } : {}),
      ...(rec.annual ? { annual: true } : {}),
    };
  });
}

async function getApproved(env) {
  return (await env.MEDIA.get('sub/approved.json', 'json')) || [];
}

async function rebuild(env) {
  if (!env.DEPLOY_HOOKS) return;
  await Promise.all(env.DEPLOY_HOOKS.split(',').map((s) => s.trim()).filter(Boolean).map((h) => fetch(h, { method: 'POST' }).catch(() => {})));
}

// ---------- Hidden listings ----------
// { slug, title, all, reason, at }. "all" = every date of that listing (its address without the date).
async function getHidden(env) {
  return (await env.MEDIA.get('hidden.json', 'json'))?.hidden || [];
}
// Accepts a full address ("https://…/event/toddler-story-time-2026-11-17/") or just the slug.
function hiddenSlug(input) {
  const m = String(input || '').trim().toLowerCase().match(/(?:\/event\/)?([a-z0-9-]{3,140})\/?(?:[?#].*)?$/);
  return m ? m[1].replace(/\.ics$/, '') : '';
}
async function setHidden(env, item, on) {
  const slug = hiddenSlug(item.slug);
  if (!slug) return false;
  const list = (await getHidden(env)).filter((h) => h.slug !== slug);
  // No date at the end of the address: it already means every date.
  const all = !!item.all || !/\d{4}-\d{2}-\d{2}(-\d+)?$/.test(slug);
  if (on) list.push({ slug, title: clean(item.title, 140), all, reason: clean(item.reason, 80), at: new Date().toISOString() });
  await env.MEDIA.put('hidden.json', JSON.stringify({ hidden: list.slice(-500) }));
  return true;
}

async function reviewApi(request, env, path, ctx) {
  if (request.method === 'GET' && path === 'list') {
    const list = await env.MEDIA.list({ prefix: 'sub/pending/' });
    const pending = (await Promise.all(list.keys.map((k) => env.MEDIA.get(k.name, 'json')))).filter(Boolean);
    pending.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    // Repeating events: say the rule in words and list the next few dates, for the review page.
    for (const r of pending) {
      if (!r.repeat) continue;
      r.repeatText = describe(r.repeat);
      r.repeatDates = expand(r.repeat, todayLocal(), addDaysKey(todayLocal(), 90)).slice(0, 8);
    }
    const approved = await getApproved(env);
    return json({ pending: pending.map(({ token, ...r }) => r), approved: approved.slice(-60).reverse() });
  }
  if (request.method === 'GET' && path === 'venues') return venuesApi(request, env, path);
  if (request.method === 'GET' && path === 'hidden') return json({ hidden: (await getHidden(env)).reverse() }, { headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  if (['venue', 'venue-undo', 'publish'].includes(path)) return venuesApi(request, env, path, body);
  if (path === 'feeds-refresh') return json({ ok: true, feeds: await refreshFeeds(env) });
  if (path === 'hide' || path === 'unhide') {
    if (!(await setHidden(env, body, path === 'hide'))) return json({ error: "That doesn't look like an event address. Copy it from the event page." }, { status: 400 });
    if (body.publish) await rebuild(env);
    return json({ ok: true });
  }
  if (path === 'approve') {
    const rec = await env.MEDIA.get(`sub/pending/${body.id}`, 'json');
    if (!rec) return json({ error: 'Already handled.' }, { status: 404 });
    // Charlie's edits from the review screen win.
    const { repeat: repeatEdit, ...plainEdits } = body.edits || {};
    const edited = { ...rec, ...tidySubmission({ ...rec, ...rec.contact, ...plainEdits, imageId: rec.imageId }), contact: rec.contact, featured: !!body.edits?.featured, sponsored: !!body.edits?.sponsored, spotlightUntil: isDate(body.edits?.spotlightUntil) ? body.edits.spotlightUntil : '', id: rec.id };
    // The review page can change when a repeating event stops and take single dates out.
    if (edited.repeat && repeatEdit) edited.repeat = tidyRepeat({ ...edited.repeat, until: repeatEdit.until, skip: repeatEdit.skip });
    if (!edited.shows.length) return json({ error: 'Needs at least one date.' }, { status: 400 });
    const approved = (await getApproved(env)).filter((e) => e.submissionId !== rec.id);
    approved.push(...toCalendarEvents(edited));
    await env.MEDIA.put('sub/approved.json', JSON.stringify(approved));
    await env.MEDIA.put(`sub/done/${rec.id}`, JSON.stringify({ ...edited, change: false, status: 'approved', reviewedAt: new Date().toISOString() }));
    await env.MEDIA.delete(`sub/pending/${rec.id}`);
    // A suggested edit replaces a listing from a feed: hide that one so the event doesn't show twice.
    if (rec.suggests) await setHidden(env, { slug: rec.suggests, title: edited.title, reason: 'Replaced by a suggested edit' }, true);
    await rebuild(env);
    // Tell the submitter: the first time it goes live, and when a change they made is approved.
    // Not when Charlie reopened it himself to fix something.
    if (!rec.change || rec.changedBy === 'organizer') ctx.waitUntil(mailApproved(env, edited, !!rec.change));
    return json({ ok: true });
  }
  if (path === 'reopen') {
    // Charlie's "Edit" on an approved event: put it back in the queue as a change. The calendar
    // keeps the current version until it is approved again.
    const rec = await env.MEDIA.get(`sub/done/${body.id}`, 'json');
    if (!rec || rec.status !== 'approved') return json({ error: 'Not found' }, { status: 404 });
    if (!(await env.MEDIA.get(`sub/pending/${rec.id}`, 'json'))) {
      await env.MEDIA.put(`sub/pending/${rec.id}`, JSON.stringify({ ...rec, status: 'pending', change: true, changedBy: 'charlie', changedAt: new Date().toISOString() }));
    }
    return json({ ok: true });
  }
  if (path === 'reject') {
    const rec = await env.MEDIA.get(`sub/pending/${body.id}`, 'json');
    if (rec?.change) {
      // Turning down a change: the version already on the calendar stays as it is.
      await env.MEDIA.delete(`sub/pending/${rec.id}`);
    } else if (rec) {
      await env.MEDIA.put(`sub/done/${rec.id}`, JSON.stringify({ ...rec, status: 'rejected', reviewedAt: new Date().toISOString() }));
      await env.MEDIA.delete(`sub/pending/${rec.id}`);
    }
    return json({ ok: true });
  }
  if (path === 'flags') {
    // Spotlight / Sponsored on an event that's already approved (e.g. the payment came in later).
    // Applies to every date of that submission.
    const approved = await getApproved(env);
    const hit = approved.find((e) => e.slug === body.slug);
    if (!hit) return json({ error: 'Not found' }, { status: 404 });
    for (const e of approved) {
      if (hit.submissionId ? e.submissionId === hit.submissionId : e.slug === hit.slug) {
        e.featured = !!body.featured;
        e.sponsored = !!body.sponsored;
        e.spotlightUntil = isDate(body.spotlightUntil) ? body.spotlightUntil : '';
      }
    }
    await env.MEDIA.put('sub/approved.json', JSON.stringify(approved));
    await rebuild(env);
    return json({ ok: true });
  }
  if (path === 'remove') {
    // Take an approved event (one show, by slug) off the calendar.
    const approved = (await getApproved(env)).filter((e) => e.slug !== body.slug);
    await env.MEDIA.put('sub/approved.json', JSON.stringify(approved));
    await rebuild(env);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, { status: 404 });
}

// ---------- Venues (Charlie only, via Cloudflare Access) ----------
// The master venue list is src/data/venues.json plus the edits saved here (KV: venues/edits.json).
// The site build reads the edits from /venues.json and merges them with the same rules
// (src/lib/venue-merge.js). Saving doesn't rebuild the site: changes go live with the nightly
// rebuild, or right away with "Publish changes now" on the Venues screen.

async function getVenueEdits(env) {
  return (await env.MEDIA.get('venues/edits.json', 'json'))?.venues || [];
}

function tidyVenue(b) {
  const lines = Array.isArray(b.aliases) ? b.aliases : String(b.aliases || '').split('\n');
  const name = clean(b.name, 140);
  const seen = new Set([fold(name)]);
  const aliases = [];
  for (const a of lines.map((x) => clean(x, 140)).filter(Boolean).slice(0, 40)) {
    if (seen.has(fold(a))) continue;
    seen.add(fold(a));
    aliases.push(a);
  }
  return {
    key: /^[a-z0-9-]{1,160}$/.test(b.key || '') ? b.key : venueKey(name),
    name,
    address: clean(b.address, 200),
    website: /^https?:\/\//i.test(b.website || '') ? clean(b.website, 400) : '',
    about: clean(b.about, 600),
    aliases,
    was: clean(b.was, 140),
  };
}

async function venuesApi(request, env, path, body) {
  const edits = await getVenueEdits(env);
  if (path === 'venues') {
    const venues = mergeVenues(venueData.venues, edits).map((v) => ({
      key: v.key, pageKey: venueKey(v.name), name: v.name, address: v.address || '', website: v.website || '', about: v.about || '',
      aliases: v.aliases.filter((a) => typeof a === 'string'),
      rooms: v.aliases.filter((a) => typeof a !== 'string').length,
      edited: !!v.edited, builtin: venueData.venues.some((x) => venueKey(x.name) === v.key),
    }));
    return json({ venues, site: LIVE_SITE }, { headers: { 'cache-control': 'no-store' } });
  }
  if (path === 'venue') {
    const v = tidyVenue(body);
    if (!v.name || !v.key) return json({ error: 'A venue needs a name.' }, { status: 400 });
    const all = mergeVenues(venueData.venues, edits);
    const others = all.filter((x) => x.key !== v.key);
    // "Add a venue" sends no key: a name that's already on the list is a clash, not an edit.
    const clash = others.find((x) => venueKey(x.name) === venueKey(v.name)) || (!body.key && all.find((x) => x.key === v.key));
    if (clash) return json({ error: `There's already a venue called "${clash.name}". To join the two, open that one and add this spelling under "Also known as".` }, { status: 409 });
    const taken = others.find((x) => x.aliases.some((a) => typeof a === 'string' && v.aliases.some((b) => fold(a) === fold(b))) || v.aliases.some((b) => fold(b) === fold(x.name)));
    if (taken) return json({ error: `"${taken.name}" already uses one of those spellings. Remove it there first, or it won't be clear which venue it means.` }, { status: 409 });
    const next = [...edits.filter((e) => e.key !== v.key), { ...v, savedAt: new Date().toISOString() }];
    await env.MEDIA.put('venues/edits.json', JSON.stringify({ venues: next }));
    return json({ ok: true, key: v.key });
  }
  if (path === 'venue-undo') {
    // Takes Charlie's edit away: a venue from venues.json goes back to how it is there; one he added is gone.
    await env.MEDIA.put('venues/edits.json', JSON.stringify({ venues: edits.filter((e) => e.key !== body.key) }));
    return json({ ok: true });
  }
  if (path === 'publish') {
    await rebuild(env);
    return json({ ok: true });
  }
  return null;
}

function venuesPage() {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Venues · Las Cruces Events</title>
<style>
:root{--ink:#1d1a17;--muted:#6b645c;--line:#e4ddd3;--bg:#faf7f2;--accent:#B23A2B;--ok:#2f6b3a}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg)}
header{padding:16px 20px;border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:2}
.top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;max-width:1100px;margin:0 auto}h1{margin:0;font-size:1.3rem;margin-right:auto}
a{color:var(--accent)}main{max-width:1100px;margin:0 auto;padding:20px}
label{display:block;font-size:.8rem;color:var(--muted);margin:10px 0 2px}input,textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}
button{font:inherit;font-weight:600;padding:8px 16px;border-radius:999px;border:1px solid var(--ink);background:#fff;cursor:pointer}.save{background:var(--ok);border-color:var(--ok);color:#fff}.undo{color:var(--accent);border-color:var(--accent)}
.note{font-size:.9rem;color:var(--muted);margin:0 0 14px}.msg{font-size:.9rem;color:var(--muted)}.err{color:var(--accent)}
#q{max-width:320px}
.v{background:#fff;border:1px solid var(--line);border-radius:10px;margin-bottom:6px}
.v summary{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:10px 14px;cursor:pointer;list-style:none}.v summary::-webkit-details-marker{display:none}
.v summary strong{font-size:1rem}.v summary span{font-size:.85rem;color:var(--muted)}
.tag{display:inline-block;font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#f1ece4;color:var(--ink)!important}.tag.new{background:#fff4d6}.tag.ed{background:#e2efe4}
.v form{padding:0 14px 14px;border-top:1px solid var(--line)}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center}h2{margin:26px 0 10px;font-size:1.1rem}
</style></head><body>
<header><div class="top"><h1>Venues</h1><input id="q" type="search" placeholder="Find a venue" aria-label="Find a venue"><button id="add">+ Add a venue</button><button id="publish">Publish changes now</button><a href="/review/">Submissions</a></div></header>
<main>
<p class="note">One name per venue. Put every other spelling under "Also known as" and all of its events show up under the one name. Saved changes go live with tonight's rebuild, or press <strong>Publish changes now</strong> (a few minutes). <span class="msg" id="status"></span></p>
<div id="new"></div>
<div id="list">Loading…</div>
</main>
<script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
let SITE='';
function form(v){
  return '<form data-key="'+esc(v.key||'')+'" data-was="'+esc(v.was||'')+'">'+
  '<div class="row"><div><label>Name (how it shows on the calendar)</label><input name="name" required value="'+esc(v.name)+'"></div><div><label>Address</label><input name="address" value="'+esc(v.address)+'" placeholder="'+esc(v.listedAddress?'From listings: '+v.listedAddress:'Street, city')+'"></div></div>'+
  '<div class="row"><div><label>Website</label><input name="website" type="url" value="'+esc(v.website)+'" placeholder="https://"></div><div><label>Short description (shown on the venue page)</label><input name="about" value="'+esc(v.about)+'"></div></div>'+
  '<label>Also known as (other spellings, one per line)</label><textarea name="aliases" rows="'+Math.max(3,(v.aliases||[]).length+1)+'">'+esc((v.aliases||[]).join('\n'))+'</textarea>'+
  (v.rooms?'<div class="msg">Plus '+v.rooms+' room rule'+(v.rooms===1?'':'s')+' kept from the built-in list.</div>':'')+
  '<div class="btns"><button class="save" type="submit">Save</button>'+
  (v.edited?'<button class="undo" type="button" data-undo>'+(v.builtin?'Undo my changes':'Remove this venue')+'</button>':'')+
  (v.pageKey&&SITE?'<a href="'+SITE+'/venue/'+esc(v.pageKey)+'/" target="_blank" rel="noopener">View page</a>':'')+
  '<span class="msg" data-msg></span></div></form>';
}
function row(v){
  return '<details class="v" data-find="'+esc((v.name+' '+(v.aliases||[]).join(' ')+' '+(v.address||v.listedAddress||'')).toLowerCase())+'"><summary><strong>'+esc(v.name)+'</strong>'+
  '<span>'+esc(v.address||v.listedAddress||'No address yet')+'</span>'+
  (v.count?'<span>'+v.count+' upcoming</span>':'')+
  (v.unlisted?'<span class="tag new">From the feeds</span>':'')+(v.edited?'<span class="tag ed">Edited</span>':'')+
  '</summary>'+form(v)+'</details>';
}
async function load(keepOpen){
  const d=await fetch('/review/api/venues').then(r=>r.json());
  SITE=d.site;
  let site=[];
  try{site=(await fetch(SITE+'/venues.json').then(r=>r.json())).venues||[]}catch(e){document.getElementById('status').textContent="Couldn't read the live calendar's venue list, so only the master list is shown."}
  const byKey=new Map(site.map(s=>[s.key,s]));
  const known=new Set();
  const master=d.venues.map(v=>{known.add(v.pageKey);known.add(v.key);const s=byKey.get(v.pageKey)||byKey.get(v.key)||{};return{...v,count:s.count||0,listedAddress:v.address?'':s.address||''}});
  const loose=site.filter(s=>!known.has(s.key)&&!s.listed).map(s=>({key:s.key,was:s.name,name:s.name,address:'',listedAddress:s.address,website:'',about:'',aliases:[],count:s.count,unlisted:true,pageKey:s.key}));
  const sort=(a,b)=>a.name.localeCompare(b.name);
  document.getElementById('list').innerHTML=
    (loose.length?'<h2>On the calendar, not on your list yet ('+loose.length+')</h2><p class="note">These names came in from the feeds as they are. Open one to fix its name or address, or add its name to another venue\'s "Also known as" to join them.</p>'+loose.sort((a,b)=>b.count-a.count||sort(a,b)).map(row).join(''):'')+
    '<h2>Your venue list ('+master.length+')</h2>'+master.sort(sort).map(row).join('');
  if(keepOpen){const el=document.querySelector('form[data-key="'+CSS.escape(keepOpen)+'"]');if(el){el.parentElement.open=true;el.querySelector('[data-msg]').textContent='Saved.'}}
  filter();
}
function filter(){const q=document.getElementById('q').value.trim().toLowerCase();document.querySelectorAll('#list .v').forEach(el=>{el.hidden=!!q&&!el.dataset.find.includes(q)})}
document.getElementById('q').addEventListener('input',filter);
document.getElementById('add').onclick=()=>{const n=document.getElementById('new');n.innerHTML='<details class="v" open><summary><strong>New venue</strong></summary>'+form({name:'',address:'',website:'',about:'',aliases:[]})+'</details>';n.querySelector('input').focus()};
document.getElementById('publish').onclick=async e=>{const s=document.getElementById('status');e.target.disabled=true;s.textContent='Starting the rebuild…';const r=await fetch('/review/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).catch(()=>({}));s.textContent=r.ok?'Rebuild started. The calendar updates in a few minutes.':"Couldn't start the rebuild. Try again.";e.target.disabled=false};
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target,msg=f.querySelector('[data-msg]');msg.className='msg';msg.textContent='Saving…';
  const body={key:f.dataset.key,was:f.dataset.was,name:f.name.value,address:f.address.value,website:f.website.value,about:f.about.value,aliases:f.aliases.value.split('\n')};
  const r=await fetch('/review/api/venue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).catch(()=>({error:'Could not save. Try again.'}));
  if(r.error){msg.className='msg err';msg.textContent=r.error;return}
  document.getElementById('new').innerHTML='';await load(r.key);
});
document.addEventListener('click',async e=>{
  if(!e.target.matches('[data-undo]'))return;const f=e.target.closest('form');
  await fetch('/review/api/venue-undo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:f.dataset.key})});await load();
});
load();
</script></body></html>`;
}

// ---------- Review page (Charlie only, via Cloudflare Access) ----------

function reviewPage() {
  const cats = CATEGORIES.map((c) => `<option value="${c}">${esc(CATEGORY_NAMES[c])}</option>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Event submissions · Las Cruces Events</title>
<style>
:root{--ink:#1d1a17;--muted:#6b645c;--line:#e4ddd3;--bg:#faf7f2;--accent:#B23A2B;--ok:#2f6b3a}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--bg)}
header{padding:20px;border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:2}h1{margin:0;font-size:1.3rem}
main{max-width:1100px;margin:0 auto;padding:20px}.empty{padding:40px;text-align:center;color:var(--muted)}
.sub{display:grid;grid-template-columns:260px 1fr;gap:20px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
.sub img{width:100%;border-radius:8px;cursor:zoom-in;border:1px solid var(--line)}.noimg{aspect-ratio:4/5;display:grid;place-items:center;background:#f1ece4;border-radius:8px;color:var(--muted)}
label{display:block;font-size:.8rem;color:var(--muted);margin:8px 0 2px}input,select,textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.show{display:grid;grid-template-columns:1.3fr 1fr 1fr 1.6fr auto;gap:8px;align-items:end;margin-bottom:6px}
.show button{padding:8px 10px}.meta{font-size:.85rem;color:var(--muted);margin-top:10px}.btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center}
button{font:inherit;font-weight:600;padding:10px 16px;border-radius:999px;border:1px solid var(--ink);background:#fff;cursor:pointer}.approve{background:var(--ok);border-color:var(--ok);color:#fff}.reject{color:var(--accent);border-color:var(--accent)}
.checks{display:flex;gap:16px;margin-top:10px}.checks label{display:flex;gap:6px;align-items:center;color:var(--ink);font-size:.95rem;margin:0}.checks input{width:auto}
h2{margin:30px 0 10px;font-size:1.1rem}.ap{display:flex;justify-content:space-between;gap:10px;padding:10px 14px;background:#fff;border:1px solid var(--line);border-radius:10px;margin-bottom:6px;font-size:.95rem}
.ap a{color:var(--ink)}.ap button{padding:4px 12px;font-size:.85rem}#lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:none;place-items:center;z-index:9;cursor:zoom-out}#lb img{max-width:96vw;max-height:96vh}
.msg{font-size:.9rem;color:var(--muted)}.boost{background:#fff4d6;border:1px solid #e8c766;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:.95rem}
.hide{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.hide input[name=slug]{flex:1;min-width:260px}.hide label{display:flex;gap:6px;align-items:center;margin:0;color:var(--ink)}.hide input[type=checkbox]{width:auto}
.tag{display:inline-block;font-size:.75rem;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px;background:#f1ece4}.tag.sp{background:#fff4d6}
.checks input[type=date]{width:auto;padding:4px 8px}.apflags{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.apflags label{display:flex;gap:4px;align-items:center;margin:0;color:var(--ink);font-size:.85rem}.apflags input[type=checkbox]{width:auto}.apflags input[type=date]{width:auto;padding:2px 6px;font-size:.85rem}@media(max-width:720px){.sub{grid-template-columns:1fr}.show{grid-template-columns:1fr 1fr}}
</style></head><body>
<header><h1>Event submissions <a href="/review/venues/" style="font-size:.9rem;font-weight:400;margin-left:12px;color:var(--accent)">Venues</a></h1><div class="msg" id="count">Loading…</div></header>
<main><div id="pending"></div><h2>Recently approved</h2><div id="approved"></div>
<h2>Hidden listings</h2><p class="msg">Something from a feed that shouldn't be on the calendar? Paste its address from the event page. It stays hidden on later nights too.</p>
<form id="hide" class="hide"><input name="slug" placeholder="https://…/event/…/" aria-label="Event address"><label><input type="checkbox" name="all"> Every date of it</label><button>Hide</button><span class="msg" data-msg></span></form>
<div id="hidden"></div></main>
<div id="lb"><img alt=""></div>
<script>
const CATS='${cats.replace(/'/g, "\\'")}';
const SITE='${LIVE_SITE}';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const lb=document.getElementById('lb');lb.onclick=()=>lb.style.display='none';
function showRow(s){return '<div class="show"><div><label>Date</label><input type="date" name="date" value="'+esc(s.date)+'"></div><div><label>Starts</label><input type="time" name="start" value="'+esc(s.start)+'"></div><div><label>Ends</label><input type="time" name="end" value="'+esc(s.end)+'"></div><div><label>Different act / title (optional)</label><input name="stitle" value="'+esc(s.title)+'"></div><button type="button" data-del>✕</button></div>'}
function card(r){
  const img=r.imageId?'<img src="/img/'+esc(r.imageId)+'" alt="Flyer" data-zoom>':'<div class="noimg">No flyer</div>';
  return '<form class="sub" data-id="'+esc(r.id)+'">'+img+'<div>'+
  '<label>Event name</label><input name="title" value="'+esc(r.title)+'">'+
  '<div class="row"><div><label>Venue</label><input name="venue" value="'+esc(r.venue)+'"></div><div><label>Address</label><input name="address" value="'+esc(r.address)+'"></div></div>'+
  '<div class="row"><div><label>Category</label><select name="category">'+CATS+'</select></div><div><label>Cost</label><input name="price" value="'+esc(r.price)+'"></div><div><label>Link</label><input name="url" value="'+esc(r.url)+'"></div></div>'+
  '<label>Description</label><textarea name="description" rows="3">'+esc(r.description)+'</textarea>'+
  '<label>Dates ('+r.shows.length+')</label><div data-shows>'+r.shows.map(showRow).join('')+'</div><button type="button" data-add>+ Add a date</button>'+
  (r.change?'<div class="boost"><strong>'+(r.changedBy==='charlie'?'You reopened this to edit it.':'Changed by the organizer.')+'</strong> The calendar keeps the current version until you approve. Reject = keep the current version.</div>':'')+
  (r.repeat?'<div class="boost" data-repeat><strong>Repeats: '+esc(r.repeatText)+'.</strong> The first date above sets the start and the times. Next dates: '+esc((r.repeatDates||[]).join(', ')||'none in the next 90 days')+'<div class="row"><div><label>Stops after (empty = keeps going)</label><input type="date" name="repeatUntil" value="'+esc(r.repeat.until||'')+'"></div><div><label>Dates to leave out (YYYY-MM-DD, commas)</label><input name="repeatSkip" value="'+esc((r.repeat.skip||[]).join(', '))+'"></div></div></div>':'')+
  (r.annual?'<div class="boost"><strong>Annual event.</strong> The organizer says this happens every year.</div>':'')+
  (r.suggests?'<div class="boost"><strong>Suggested edit</strong> to <a href="'+esc(SITE)+'/event/'+esc(r.suggests)+'/" target="_blank" rel="noopener">this listing</a>. Approving it puts this version on the calendar and hides the original. Reject leaves the original as it is.</div>':'')+
  (r.boost==='spotlight'?'<div class="boost"><strong>Spotlight requested ($50).</strong> Check Stripe for a payment with reference <code>'+esc(r.id)+'</code> (or from '+esc(r.contact?.email)+'), then approve with Sponsored ticked.</div>':'')+
  '<div class="checks"><label><input type="checkbox" name="featured"> Spotlight</label><label><input type="checkbox" name="sponsored"'+(r.boost==='spotlight'?' checked':'')+'> Sponsored (paid)</label><label>until <input type="date" name="spotlightUntil" title="Leave empty to run until the event\\'s last date"></label></div>'+
  '<div class="meta">From '+esc(r.contact?.name)+' · <a href="mailto:'+esc(r.contact?.email)+'">'+esc(r.contact?.email)+'</a>'+(r.contact?.phone?' · '+esc(r.contact.phone):'')+(r.act?' · Act: '+esc(r.act):'')+' · '+new Date(r.submittedAt).toLocaleString()+'</div>'+
  '<div class="btns"><button class="approve" type="submit">Approve</button><button class="reject" type="button" data-reject>Reject</button><span class="msg" data-msg></span></div></div></form>';
}
async function loadHidden(){
  const d=await fetch('/review/api/hidden').then(r=>r.json());
  document.getElementById('hidden').innerHTML=d.hidden.map(h=>'<div class="ap"><span>'+esc(h.title||h.slug)+(h.all?'<span class="tag">Every date</span>':'')+(h.reason?' · <span class="msg">'+esc(h.reason)+'</span>':'')+'</span><span class="apflags"><button data-unhide="'+esc(h.slug)+'">Show again</button></span></div>').join('')||'<div class="msg">Nothing hidden.</div>';
}
async function load(){
  loadHidden();
  const d=await fetch('/review/api/list').then(r=>r.json());
  document.getElementById('count').textContent=d.pending.length?d.pending.length+' waiting for you':'All caught up';
  const p=document.getElementById('pending');
  p.innerHTML=d.pending.length?d.pending.map(card).join(''):'<div class="empty">Nothing waiting. New submissions show up here.</div>';
  d.pending.forEach(r=>{const f=p.querySelector('[data-id="'+r.id+'"]');f.category.value=r.category});
  document.getElementById('approved').innerHTML=d.approved.map(e=>'<div class="ap" data-slug="'+esc(e.slug)+'"><span><strong>'+esc(e.start.slice(0,10))+'</strong> · '+esc(e.title)+' · '+esc(e.venue)+(e.repeat?'<span class="tag">Repeats</span>':'')+(e.sponsored?'<span class="tag sp">Sponsored</span>':e.featured?'<span class="tag">Spotlight</span>':'')+'</span><span class="apflags"><label><input type="checkbox" data-f="featured"'+(e.featured?' checked':'')+'> Spotlight</label><label><input type="checkbox" data-f="sponsored"'+(e.sponsored?' checked':'')+'> Sponsored</label><label>until <input type="date" data-f="until" value="'+esc(e.spotlightUntil||'')+'"></label><button data-flags>Save</button>'+(e.submissionId?'<button data-reopen="'+esc(e.submissionId)+'">Edit</button>':'')+'<button data-remove="'+esc(e.slug)+'">Remove</button></span></div>').join('')||'<div class="msg">None yet.</div>';
}
document.addEventListener('click',async e=>{
  const t=e.target;
  if(t.matches('[data-zoom]')){lb.querySelector('img').src=t.src;lb.style.display='grid';return}
  if(t.matches('[data-del]')){t.closest('.show').remove();return}
  if(t.matches('[data-add]')){t.previousElementSibling.insertAdjacentHTML('beforeend',showRow({}));return}
  if(t.matches('[data-reject]')){const f=t.closest('form');if(!confirm('Reject this submission?'))return;await fetch('/review/api/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.dataset.id})});load();return}
  if(t.matches('[data-flags]')){const row=t.closest('.ap');const g=k=>row.querySelector('[data-f="'+k+'"]');t.textContent='Saving…';await fetch('/review/api/flags',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:row.dataset.slug,featured:g('featured').checked,sponsored:g('sponsored').checked,spotlightUntil:g('until').value})});t.textContent='Saved · updating';setTimeout(load,1500);return}
  if(t.matches('[data-reopen]')){t.textContent='Opening…';await fetch('/review/api/reopen',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:t.dataset.reopen})});await load();window.scrollTo({top:0,behavior:'smooth'});return}
  if(t.matches('[data-unhide]')){await fetch('/review/api/unhide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:t.dataset.unhide,publish:true})});loadHidden();return}
  if(t.matches('[data-remove]')){if(!confirm('Take this off the calendar?'))return;await fetch('/review/api/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:t.dataset.remove})});load();return}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;const msg=f.querySelector('[data-msg]');msg.textContent='Saving…';
  if(f.id==='hide'){const r=await fetch('/review/api/hide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:f.slug.value,all:f.all.checked,reason:'Hidden by Charlie',publish:true})}).then(r=>r.json());msg.textContent=r.ok?'Hidden. The calendar updates in a few minutes.':r.error;if(r.ok){f.reset();loadHidden()}return}
  const shows=[...f.querySelectorAll('.show')].map(s=>({date:s.querySelector('[name=date]').value,start:s.querySelector('[name=start]').value,end:s.querySelector('[name=end]').value,title:s.querySelector('[name=stitle]').value}));
  const edits={title:f.title.value,venue:f.venue.value,address:f.address.value,category:f.category.value,price:f.price.value,url:f.url.value,description:f.description.value,shows,featured:f.featured.checked,sponsored:f.sponsored.checked,spotlightUntil:f.spotlightUntil.value};
  if(f.repeatUntil)edits.repeat={until:f.repeatUntil.value,skip:f.repeatSkip.value.split(',').map(x=>x.trim()).filter(Boolean)};
  const r=await fetch('/review/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.dataset.id,edits})}).then(r=>r.json());
  if(r.ok){msg.textContent='Approved. The calendar updates in a couple of minutes.';setTimeout(load,1200)}else msg.textContent=r.error||'Something went wrong.';
});
load();
</script></body></html>`;
}

// ---------- Router ----------

const REBUILD_TIMES = ['10 7 * * *', '40 7 * * *', '10 8 * * *'];

export default {
  // Daily rebuild (schedule in wrangler.intake.jsonc). The calendar is a static site, so it needs one
  // build a day to drop finished events and pick up feed changes. This used to ride on the CitySpark
  // copy finishing; it now runs on its own, so it keeps going after CitySpark is cancelled.
  // The schedule has two jobs. The times listed in REBUILD_TIMES rebuild the calendar. Any other
  // time on the schedule (11:40 PM, half an hour before the first rebuild) reads the other
  // organizations' calendars (feeds.js) so the rebuild has tonight's listings.
  // If you change the rebuild times in wrangler.intake.jsonc, change REBUILD_TIMES to match.
  async scheduled(event, env, ctx) {
    if (REBUILD_TIMES.includes(event.cron)) ctx.waitUntil(rebuild(env));
    else ctx.waitUntil(refreshFeeds(env).catch((err) => console.log('Feeds not read', err.message)));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      if (path === '/extract' && request.method === 'POST') return await handleExtract(request, env, origin);
      if (path === '/submit' && request.method === 'POST') return await handleSubmit(request, env, origin, ctx);
      if (path === '/update' && request.method === 'POST') return await handleUpdate(request, env, origin, ctx);
      if (path === '/mine' && request.method === 'GET') return await handleMine(request, env, origin);

      if (path === '/feeds.json') {
        const [report, events] = await Promise.all([env.MEDIA.get('feeds/report.json', 'json'), getFeedEvents(env)]);
        return json({ report, count: events.length, events }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
      }

      if (path === '/venues.json') {
        return json({ venues: await getVenueEdits(env) }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
      }

      if (path === '/approved.json') {
        // "feeds": events read from other organizations' calendars. They ride along here so the site
        // build makes one request for both (each extra request is one more chance of a failed build).
        const [approved, feeds, hidden] = await Promise.all([getApproved(env), getFeedEvents(env), getHidden(env)]);
        return json({ count: approved.length, events: approved, feeds, hidden }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
      }

      if (path.startsWith('/img/')) {
        const cache = caches.default;
        const hit = await cache.match(request);
        if (hit) return hit;
        const file = path.slice(5).replace(/[^a-z0-9.]/g, '');
        let found = await env.MEDIA.getWithMetadata(`sub/img/${file}`, 'arrayBuffer');
        if (!found.value) found = await env.MEDIA.getWithMetadata(`sub/upload/${file}`, 'arrayBuffer');
        if (!found.value) return new Response('Not found', { status: 404 });
        const res = new Response(found.value, { headers: { 'content-type': found.metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' } });
        await cache.put(request, res.clone());
        return res;
      }

      // Everything under /review is protected by Cloudflare Access (Charlie only). Belt and braces:
      // refuse anything that didn't come through Access.
      if (path === '/review' || path.startsWith('/review/')) {
        const who = (request.headers.get('cf-access-authenticated-user-email') || '').toLowerCase();
        if (!(env.REVIEWERS || 'cjbarks@gmail.com').toLowerCase().split(',').map((s) => s.trim()).includes(who)) {
          return new Response('Not allowed', { status: 403 });
        }
      }
      if (path === '/review' || path === '/review/') return new Response(reviewPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (path === '/review/venues' || path === '/review/venues/') return new Response(venuesPage(), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      if (path.startsWith('/review/api/')) return await reviewApi(request, env, path.slice('/review/api/'.length), ctx);

      if (path === '/') return new Response('Las Cruces Events submissions. Add an event at https://events.livelovelascruces.com/submit/', { headers: { 'content-type': 'text/plain' } });
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.log('Error', path, err.stack || err.message);
      return json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 }, origin);
    }
  },
};
