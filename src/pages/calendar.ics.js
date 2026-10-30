// Whole calendar as a feed people can subscribe to in Google/Apple/Outlook: /calendar.ics
import { getEvents } from '../lib/events.js';
import { buildIcs } from '../lib/ics.js';

export async function GET() {
  const { events } = await getEvents();
  return new Response(buildIcs(events, 'Las Cruces Events'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
