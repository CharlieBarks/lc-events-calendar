// "Add to calendar" file for one event: /event/<slug>.ics
import { getEvents } from '../../lib/events.js';
import { buildIcs } from '../../lib/ics.js';

export async function getStaticPaths() {
  const { events } = await getEvents();
  return events.map((event) => ({ params: { slug: event.slug }, props: { event } }));
}

export function GET({ props }) {
  return new Response(buildIcs([props.event]), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
