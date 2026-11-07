// intake.js — deployed as the "lc-events-intake" Cloudflare Worker (Live Love Las Cruces account).
//
// Event submissions for the calendar:
//   POST /extract        flyer image (multipart "image") -> saves it full size and reads the event details off it
//   POST /submit         the finished form (JSON) -> waits in Charlie's review queue
//   GET  /approved.json  approved submissions in the calendar's format (the site build reads this)
//   GET  /img/<id>.jpg   a submitted flyer, full size
//   GET  /review/        Charlie's review queue (behind Cloudflare Access: Charlie only)
//   /review/api/...      approve / reject / remove (also behind Access)
//
// Storage: KV namespace lc-events-media (bound as MEDIA), keys under sub/.
// Flyer reading: Workers AI (Llama 4 Scout, bound as AI). If an ANTHROPIC_API_KEY secret is added,
// Claude reads flyers instead (more accurate on busy flyers).
// Approving rebuilds the calendar through the deploy hooks in the DEPLOY_HOOKS secret (comma-separated URLs).

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
  return {
    title: clean(b.title, 140),
    performers: clean(b.performers, 300),
    venue: clean(b.venue, 140),
    address: clean(b.address, 200),
    category: CATEGORIES.includes(b.category) ? b.category : 'community',
    price: clean(b.price, 80),
    url: /^https?:\/\//i.test(b.url || '') ? clean(b.url, 400) : '',
    description: cleanText(b.description, 2000),
    shows,
    imageId: /^[a-z0-9]+\.(jpg|png|webp|gif)$/.test(b.imageId || '') ? b.imageId : '',
    contact: { name: clean(b.name, 100), email: clean(b.email, 160), phone: clean(b.phone, 40) },
    act: clean(b.act, 140), // set when a musician comes from their Las Cruces Live page
    source: clean(b.source, 40) || 'form',
  };
}

async function handleSubmit(request, env, origin) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key: `submit:${ip}` });
    if (!success) return json({ error: 'Too many submissions in a row. Give it a minute and try again.' }, { status: 429 }, origin);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, { status: 400 }, origin); }
  if (body.website) return json({ ok: true }, {}, origin); // honeypot: bots fill every field
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
  const record = { id, status: 'pending', submittedAt: new Date().toISOString(), ip, ...sub };
  await env.MEDIA.put(`sub/pending/${id}`, JSON.stringify(record));
  return json({ ok: true, id, shows: sub.shows.length }, {}, origin);
}

// ---------- Approved events -> calendar ----------

function toCalendarEvents(rec) {
  return rec.shows.map((s, i) => {
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
      slug: `${slugify(title)}-${s.date}${rec.shows.length > 1 && rec.shows.filter((x) => x.date === s.date).length > 1 ? `-${i + 1}` : ''}`,
      title,
      start,
      end,
      venue: rec.venue,
      address: rec.address,
      category: rec.category,
      price: rec.price,
      description: rec.description || (rec.performers ? `With ${rec.performers}.` : ''),
      url: rec.url,
      image: rec.imageId ? `${PUBLIC_ORIGIN}/img/${rec.imageId}` : '',
      featured: !!rec.featured,
      sponsored: !!rec.sponsored,
      submissionId: rec.id,
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

async function reviewApi(request, env, path) {
  if (request.method === 'GET' && path === 'list') {
    const list = await env.MEDIA.list({ prefix: 'sub/pending/' });
    const pending = (await Promise.all(list.keys.map((k) => env.MEDIA.get(k.name, 'json')))).filter(Boolean);
    pending.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const approved = await getApproved(env);
    return json({ pending, approved: approved.slice(-60).reverse() });
  }
  if (request.method !== 'POST') return json({ error: 'Not found' }, { status: 404 });
  const body = await request.json();
  if (path === 'approve') {
    const rec = await env.MEDIA.get(`sub/pending/${body.id}`, 'json');
    if (!rec) return json({ error: 'Already handled.' }, { status: 404 });
    // Charlie's edits from the review screen win.
    const edited = { ...rec, ...tidySubmission({ ...rec, ...rec.contact, ...body.edits, imageId: rec.imageId }), contact: rec.contact, featured: !!body.edits?.featured, sponsored: !!body.edits?.sponsored, id: rec.id };
    if (!edited.shows.length) return json({ error: 'Needs at least one date.' }, { status: 400 });
    const approved = (await getApproved(env)).filter((e) => e.submissionId !== rec.id);
    approved.push(...toCalendarEvents(edited));
    await env.MEDIA.put('sub/approved.json', JSON.stringify(approved));
    await env.MEDIA.put(`sub/done/${rec.id}`, JSON.stringify({ ...edited, status: 'approved', reviewedAt: new Date().toISOString() }));
    await env.MEDIA.delete(`sub/pending/${rec.id}`);
    await rebuild(env);
    return json({ ok: true });
  }
  if (path === 'reject') {
    const rec = await env.MEDIA.get(`sub/pending/${body.id}`, 'json');
    if (rec) {
      await env.MEDIA.put(`sub/done/${rec.id}`, JSON.stringify({ ...rec, status: 'rejected', reviewedAt: new Date().toISOString() }));
      await env.MEDIA.delete(`sub/pending/${rec.id}`);
    }
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
.msg{font-size:.9rem;color:var(--muted)}@media(max-width:720px){.sub{grid-template-columns:1fr}.show{grid-template-columns:1fr 1fr}}
</style></head><body>
<header><h1>Event submissions</h1><div class="msg" id="count">Loading…</div></header>
<main><div id="pending"></div><h2>Recently approved</h2><div id="approved"></div></main>
<div id="lb"><img alt=""></div>
<script>
const CATS='${cats.replace(/'/g, "\\'")}';
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
  '<div class="checks"><label><input type="checkbox" name="featured"> Charlie\\'s pick</label><label><input type="checkbox" name="sponsored"> Sponsored</label></div>'+
  '<div class="meta">From '+esc(r.contact?.name)+' · <a href="mailto:'+esc(r.contact?.email)+'">'+esc(r.contact?.email)+'</a>'+(r.contact?.phone?' · '+esc(r.contact.phone):'')+(r.act?' · Act: '+esc(r.act):'')+' · '+new Date(r.submittedAt).toLocaleString()+'</div>'+
  '<div class="btns"><button class="approve" type="submit">Approve</button><button class="reject" type="button" data-reject>Reject</button><span class="msg" data-msg></span></div></div></form>';
}
async function load(){
  const d=await fetch('/review/api/list').then(r=>r.json());
  document.getElementById('count').textContent=d.pending.length?d.pending.length+' waiting for you':'All caught up';
  const p=document.getElementById('pending');
  p.innerHTML=d.pending.length?d.pending.map(card).join(''):'<div class="empty">Nothing waiting. New submissions show up here.</div>';
  d.pending.forEach(r=>{const f=p.querySelector('[data-id="'+r.id+'"]');f.category.value=r.category});
  document.getElementById('approved').innerHTML=d.approved.map(e=>'<div class="ap"><span><strong>'+esc(e.start.slice(0,10))+'</strong> · '+esc(e.title)+' · '+esc(e.venue)+'</span><button data-remove="'+esc(e.slug)+'">Remove</button></div>').join('')||'<div class="msg">None yet.</div>';
}
document.addEventListener('click',async e=>{
  const t=e.target;
  if(t.matches('[data-zoom]')){lb.querySelector('img').src=t.src;lb.style.display='grid';return}
  if(t.matches('[data-del]')){t.closest('.show').remove();return}
  if(t.matches('[data-add]')){t.previousElementSibling.insertAdjacentHTML('beforeend',showRow({}));return}
  if(t.matches('[data-reject]')){const f=t.closest('form');if(!confirm('Reject this submission?'))return;await fetch('/review/api/reject',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.dataset.id})});load();return}
  if(t.matches('[data-remove]')){if(!confirm('Take this off the calendar?'))return;await fetch('/review/api/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug:t.dataset.remove})});load();return}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const f=e.target;const msg=f.querySelector('[data-msg]');msg.textContent='Saving…';
  const shows=[...f.querySelectorAll('.show')].map(s=>({date:s.querySelector('[name=date]').value,start:s.querySelector('[name=start]').value,end:s.querySelector('[name=end]').value,title:s.querySelector('[name=stitle]').value}));
  const edits={title:f.title.value,venue:f.venue.value,address:f.address.value,category:f.category.value,price:f.price.value,url:f.url.value,description:f.description.value,shows,featured:f.featured.checked,sponsored:f.sponsored.checked};
  const r=await fetch('/review/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.dataset.id,edits})}).then(r=>r.json());
  if(r.ok){msg.textContent='Approved. The calendar updates in a couple of minutes.';setTimeout(load,1200)}else msg.textContent=r.error||'Something went wrong.';
});
load();
</script></body></html>`;
}

// ---------- Router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      if (path === '/extract' && request.method === 'POST') return await handleExtract(request, env, origin);
      if (path === '/submit' && request.method === 'POST') return await handleSubmit(request, env, origin);

      if (path === '/approved.json') {
        const approved = await getApproved(env);
        return json({ count: approved.length, events: approved }, { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
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
      if (path.startsWith('/review/api/')) return await reviewApi(request, env, path.slice('/review/api/'.length));

      if (path === '/') return new Response('Las Cruces Events submissions. Add an event at https://events.livelovelascruces.com/submit/', { headers: { 'content-type': 'text/plain' } });
      return new Response('Not found', { status: 404 });
    } catch (err) {
      console.log('Error', path, err.stack || err.message);
      return json({ error: 'Something went wrong on our end. Please try again.' }, { status: 500 }, origin);
    }
  },
};
