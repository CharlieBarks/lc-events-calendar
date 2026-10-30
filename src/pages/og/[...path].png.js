// Share images (what shows when an event link is texted or posted to Facebook).
// Events without a photo still get a clean branded card. Built once at build time.
import { getEvents } from '../../lib/events.js';
import { CATEGORIES } from '../../lib/site.js';
import { shortDate, timeRange } from '../../lib/time.js';
import { renderShareImage } from '../../lib/og.js';

export async function getStaticPaths() {
  const { events } = await getEvents();
  const paths = [{ params: { path: 'default' }, props: { label: 'Las Cruces, NM', title: "What's happening in Las Cruces", subtitle: 'Live music, markets, art walks and more. Updated every morning.', color: '#B23A2B' } }];
  // Only events without their own photo or flyer need a generated card.
  for (const e of events.filter((x) => !x.image)) {
    const c = CATEGORIES[e.category];
    paths.push({ params: { path: `event/${e.slug}` }, props: { label: e.topic?.label || c.name, title: e.title, subtitle: `${shortDate(e.start)} · ${timeRange(e.start, e.end)} · ${e.venue || 'Las Cruces'}`, color: c.color, icon: e.topic?.icon || c.icon } });
  }
  for (const [k, c] of Object.entries(CATEGORIES)) {
    if (!events.some((e) => e.category === k)) continue;
    paths.push({ params: { path: `category/${k}` }, props: { label: 'Las Cruces, NM', title: c.seo, subtitle: c.blurb, color: c.color, icon: c.icon } });
  }
  return paths;
}

export async function GET({ props }) {
  const png = await renderShareImage(props);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
