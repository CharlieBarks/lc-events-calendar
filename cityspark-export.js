// cityspark-export.js — deployed as the "cityspark-export" Cloudflare Worker.
//
// Copies the Live Love Las Cruces CitySpark calendar (listings + images) into our own Cloudflare KV
// storage (namespace lc-events-media, bound as MEDIA), so the new calendar starts full and keeps the
// photos after CitySpark is cancelled. Writes are kept low to stay inside KV's free daily limit.
//
// Runs on a schedule. Cloudflare limits how much one run can fetch, so each run does a small batch:
//   tags -> events (page through CitySpark) -> images (copy into KV) -> publish -> done
// Once a full copy is published it asks Cloudflare to rebuild the site, then waits RESYNC_HOURS
// and starts again. If CitySpark stops answering, the last good copy stays put.
//
//   GET /events.json  latest copy, in the calendar's format
//   GET /img/<file>   an image copied from CitySpark
//   GET /status       progress
//   GET /run          do one batch now (same as a scheduled run; does nothing once a copy is fresh)

const SLUG = 'LiveLoveLasCruces';
const PPID = 9688;
const LAT = 32.3199396;
const LNG = -106.7636538;
const RADIUS_MILES = 30;
const DAYS_AHEAD = 120;
const PAGES_PER_RUN = 15;
const IMAGES_PER_RUN = 30;
const RESYNC_HOURS = 20;

const API = `https://portal.cityspark.com/api/events/GetEvents/${SLUG}`;
const SCRIPT = `https://portal.cityspark.com/PortalScripts/${SLUG}`;
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://events.livelovelascruces.com',
  Referer: 'https://events.livelovelascruces.com/',
};
const CORS = { 'access-control-allow-origin': '*' };

const getJSON = async (env, key, fallback) => (await env.MEDIA.get(key, 'json')) ?? fallback;
const putJSON = (env, key, value) => env.MEDIA.put(key, JSON.stringify(value));

// Today in Las Cruces as "YYYY-MM-DDT00:00".
const todayLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T00:00';

// Pull one JSON array out of the big portal script by matching brackets.
function extractArray(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  let i = at + marker.length - 1, depth = 0, inStr = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return JSON.parse(text.slice(i, j + 1));
  }
  return null;
}

// Keep only what the calendar needs (keeps files small).
const slim = (e) => ({
  Id: e.Id, PId: e.PId, Name: e.Name, Summary: e.Summary, Description: String(e.Description || '').slice(0, 3000),
  Venue: e.Venue, Address: e.Address, CityState: e.CityState, Zip: e.Zip,
  DateStart: e.DateStart, DateEnd: e.DateEnd, AllDay: e.AllDay, HasTime: e.HasTime,
  Tags: e.Tags, Labels: e.Labels, Free: e.Free, Price: e.Price, PriceHigh: e.PriceHigh, PriceText: e.PriceText,
  LargeImg: e.LargeImg, MediumImg: e.MediumImg, PrimaryUrl: e.PrimaryUrl, TicketUrl: e.TicketUrl,
  Links: (e.Links || []).slice(0, 3).map((l) => ({ name: l.name, url: l.url })),
  Picked: e.Picked, latitude: e.latitude, longitude: e.longitude,
});

const decode = (s = '') => String(s)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&iexcl;/g, '¡').replace(/&iquest;/g, '¿').replace(/&ntilde;/g, 'ñ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();

const imageFile = (e) => {
  const url = e.LargeImg || e.MediumImg;
  return url ? url.split('/').pop().split('?')[0] : null;
};

function money(e) {
  if (e.Free) return 'Free';
  if (e.PriceText) return e.PriceText;
  if (e.Price) return e.PriceHigh && e.PriceHigh !== e.Price ? `$${e.Price}–$${e.PriceHigh}` : `$${e.Price}`;
  return '';
}

function toCalendar(e, tags, origin) {
  // DateStart is the local Las Cruces wall clock, labelled "Z" by CitySpark.
  const allDay = e.AllDay || e.HasTime === false;
  const start = allDay ? e.DateStart.slice(0, 10) : e.DateStart.slice(0, 19);
  const names = new Set();
  for (const id of e.Tags || []) {
    let t = tags[id], guard = 0;
    while (t && guard++ < 6) { names.add(t.name); t = t.parent != null ? tags[t.parent] : null; }
  }
  const file = imageFile(e);
  return {
    id: e.Id,
    title: decode(e.Name),
    start,
    end: !allDay && e.DateEnd ? e.DateEnd.slice(0, 19) : null,
    venue: decode(e.Venue || ''),
    address: [e.Address, e.CityState, e.Zip].filter(Boolean).join(', '),
    city: e.CityState || '',
    description: decode(e.Description || e.Summary || ''),
    summary: decode(e.Summary || ''),
    url: e.PrimaryUrl || e.TicketUrl || e.Links?.[0]?.url || '',
    ticketUrl: e.TicketUrl || '',
    image: file ? `${origin}/img/${file}` : '',
    price: money(e),
    tags: [...names],
    featured: !!e.Picked,
    lat: e.latitude, lng: e.longitude,
    source: 'cityspark',
  };
}

async function step(env, origin) {
  const state = await getJSON(env, 'cityspark/state.json', { phase: 'idle' });
  const now = Date.now();

  if (state.phase === 'idle' || state.phase === 'done') {
    if (state.finishedAt && now - state.finishedAt < RESYNC_HOURS * 3600e3) return state;
    Object.assign(state, { phase: 'tags', startedAt: now, skip: 0, pages: 0, imgIndex: 0, copied: 0, error: null });
    state.have ??= []; // image files already stored (so daily refreshes only copy new ones)
    await putJSON(env, 'cityspark/raw.json', []);
  }

  try {
    if (state.phase === 'tags') {
      const text = await (await fetch(SCRIPT)).text();
      const list = extractArray(text, '"Tags":[');
      if (!list?.length) throw new Error('Could not read the CitySpark category list');
      const tags = {};
      for (const t of list) tags[t.id] = { name: t.name, parent: t.parent };
      await putJSON(env, 'cityspark/tags.json', tags);
      state.phase = 'events';
    } else if (state.phase === 'events') {
      const raw = await getJSON(env, 'cityspark/raw.json', []);
      const horizon = new Date(now + DAYS_AHEAD * 864e5).toISOString().slice(0, 10);
      const start = todayLocal();
      for (let p = 0; p < PAGES_PER_RUN; p++) {
        const res = await fetch(API, {
          method: 'POST', headers: HEADERS,
          body: JSON.stringify({ ppid: PPID, start, skip: state.skip, lat: LAT, lng: LNG, distance: RADIUS_MILES }),
        });
        if (!res.ok) throw new Error(`CitySpark answered ${res.status}`);
        const data = await res.json();
        if (!data.Success) throw new Error(data.ErrorMessage || 'CitySpark error');
        const page = data.Value || [];
        state.pages++;
        state.skip += page.length;
        raw.push(...page.map(slim));
        const earliest = page.reduce((m, e) => (e.DateStart < m ? e.DateStart : m), '9999');
        if (page.length === 0 || earliest.slice(0, 10) > horizon || state.pages > 200) {
          // Drop duplicates and anything past the horizon, then move on to images.
          const seen = new Set();
          const clean = raw.filter((e) => e.DateStart.slice(0, 10) <= horizon && !seen.has(e.Id) && seen.add(e.Id));
          await putJSON(env, 'cityspark/raw.json', clean);
          await putJSON(env, 'cityspark/images.json', clean.map((e) => e.LargeImg || e.MediumImg || ''));
          state.total = clean.length;
          state.phase = 'images';
          break;
        }
      }
      if (state.phase === 'events') await putJSON(env, 'cityspark/raw.json', raw);
    } else if (state.phase === 'images') {
      const urls = await getJSON(env, 'cityspark/images.json', []);
      const have = new Set(state.have);
      let fetched = 0;
      while (state.imgIndex < urls.length && fetched < IMAGES_PER_RUN) {
        const url = urls[state.imgIndex++];
        const file = url && url.split('/').pop().split('?')[0];
        if (!file || have.has(file)) continue;
        fetched++;
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 24e6) continue; // KV limit is 25 MB
        await env.MEDIA.put(`cityspark/img/${file}`, buf, { metadata: { type: res.headers.get('content-type') || 'image/jpeg' } });
        have.add(file);
        state.copied++;
      }
      state.have = [...have];
      if (state.imgIndex >= urls.length) state.phase = 'publish';
    } else if (state.phase === 'publish') {
      const raw = await getJSON(env, 'cityspark/raw.json', []);
      const tags = await getJSON(env, 'cityspark/tags.json', {});
      const events = raw.map((e) => toCalendar(e, tags, origin));
      await putJSON(env, 'cityspark/events.json', { exportedAt: new Date().toISOString(), count: events.length, events });
      Object.assign(state, { phase: 'done', finishedAt: now, published: events.length });
      // Rebuild the calendar so the fresh listings go live.
      if (env.DEPLOY_HOOKS) {
        for (const hook of env.DEPLOY_HOOKS.split(',').map((s) => s.trim()).filter(Boolean)) {
          await fetch(hook, { method: 'POST' }).catch(() => {});
        }
      }
    }
  } catch (err) {
    // Keep going next run; the last published copy stays live.
    state.error = `${new Date().toISOString()} ${state.phase}: ${err.message}`;
    console.log(state.error);
  }

  state.updatedAt = now;
  await putJSON(env, 'cityspark/state.json', state);
  return state;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(step(env, env.PUBLIC_ORIGIN));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/events.json') {
      const body = await env.MEDIA.get('cityspark/events.json', 'text');
      if (!body) return new Response(JSON.stringify({ error: 'No export yet', events: [] }), { status: 404, headers: { ...CORS, 'content-type': 'application/json' } });
      return new Response(body, { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    }

    if (url.pathname.startsWith('/img/')) {
      // Edge cache first, so busy pages don't use up KV reads.
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;
      const file = url.pathname.slice(5).replace(/[^A-Za-z0-9._-]/g, '');
      const { value, metadata } = await env.MEDIA.getWithMetadata(`cityspark/img/${file}`, 'arrayBuffer');
      if (!value) return new Response('Not found', { status: 404 });
      const res = new Response(value, {
        headers: { ...CORS, 'content-type': metadata?.type || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
      });
      ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }

    if (url.pathname === '/run') {
      const { have, ...s } = await step(env, env.PUBLIC_ORIGIN);
      return new Response(JSON.stringify({ ...s, imagesStored: have?.length || 0 }, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/status') {
      const { have, ...s } = await getJSON(env, 'cityspark/state.json', { phase: 'idle' });
      s.imagesStored = have?.length || 0;
      return new Response(JSON.stringify(s, null, 2), { headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }

    return new Response('Live Love Las Cruces CitySpark export. See /status, /events.json', { headers: { 'X-Robots-Tag': 'noindex' } });
  },
};
