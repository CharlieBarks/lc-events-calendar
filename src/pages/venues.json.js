// Every venue the calendar knows, for the Venues screen on the review page (it shows venues that
// are only on the calendar, next to the master list, so Charlie can tidy them up).
import { getVenues } from '../lib/events.js';

export async function GET() {
  const venues = (await getVenues()).map((v) => ({ key: v.key, name: v.name, address: v.address, count: v.events.length, listed: v.listed }));
  return new Response(JSON.stringify({ venues }), { headers: { 'content-type': 'application/json' } });
}
