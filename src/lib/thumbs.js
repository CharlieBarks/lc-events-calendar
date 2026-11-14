// Small copies of event pictures, made while the site builds.
//
// Organizers upload full-size flyers (often several MB). A 64px thumbnail in the calendar was
// downloading the whole thing. During a build, each picture is fetched once and saved in three
// widths as WebP; the pages then point at the size that fits where the picture is shown.
// The full-size original is still what opens when someone taps a flyer on its event page.
//
// Nothing here can stop a build or lose a picture: if one can't be fetched or read, that event
// simply keeps using its original picture address.
//
// Skipped in offline builds (EVENTS_OFFLINE=1), in `astro dev`, and with EVENTS_THUMBS=0.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// s: rows and small cards. m: cards. l: the flyer on an event page.
export const THUMB_WIDTHS = { s: 320, m: 800, l: 1200 };
const dir = path.join(os.tmpdir(), 'lc-events-thumbs');
const files = new Map(); // "ab12cd34ef56-320" -> file on disk

export const thumbsEnabled = () => import.meta.env.PROD && process.env.EVENTS_OFFLINE !== '1' && process.env.EVENTS_THUMBS !== '0';

async function makeOne(sharp, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  const out = {};
  for (const [size, width] of Object.entries(THUMB_WIDTHS)) {
    // rotate(): respect the phone's orientation tag. Never enlarge a small picture.
    const buf = await sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    const name = `${id}-${width}`;
    const file = path.join(dir, `${name}.webp`);
    fs.writeFileSync(file, buf);
    files.set(name, file);
    out[size] = `/thumbs/${name}.webp`;
  }
  return out;
}

// Adds event.thumbs = { s, m, l } to every event whose picture could be processed.
export async function addThumbs(events) {
  if (!thumbsEnabled()) return;
  const { default: sharp } = await import('sharp');
  fs.mkdirSync(dir, { recursive: true });
  const urls = [...new Set(events.map((e) => e.image).filter((u) => /^https?:/.test(u)))];
  const done = new Map();
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try { done.set(url, await makeOne(sharp, url)); }
      catch (err) { failed++; if (failed <= 5) console.warn(`Thumbnail skipped (${err.message}): ${url}`); }
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const e of events) if (done.has(e.image)) e.thumbs = done.get(e.image);
  console.log(`Thumbnails: ${done.size} pictures in ${Math.round((Date.now() - started) / 1000)}s${failed ? `, ${failed} skipped (those keep their original picture)` : ''}`);
}

// For src/pages/thumbs/[name].webp.js
export const thumbNames = () => [...files.keys()];
export const thumbFile = (name) => fs.readFileSync(files.get(name));
