// Whole calendar as a feed people can subscribe to in Google/Apple/Outlook: /calendar.ics
import { getEvents } from '../lib/events.js';
import { buildIcs } from '../lib/ics.js';
import { dateKey, addDays, todayWall } from '../lib/time.js';

export async function GET() {
  const { events } = await getEvents();
  // The next 60 days. Calendar apps re-read this feed every day or so, and the site rebuilds nightly,
  // so later events arrive in time. Sending every listing made this file several times bigger.
  const until = dateKey(addDays(todayWall(), 60));
  const soon = events.filter((e) => e.date <= until);
  return new Response(buildIcs(soon, 'Las Cruces Events'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
