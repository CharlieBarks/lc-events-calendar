import { SITE } from './site.js';
import { icsStamp, addDays, dateKey } from './time.js';

const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Lines longer than 75 bytes must wrap (RFC 5545).
const fold = (line) => line.match(/.{1,73}/gu).join('\r\n ');

export function buildIcs(events, name = 'Las Cruces Events') {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Live Love Las Cruces//Events//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:America/Denver'];
  for (const e of events) {
    const url = `${SITE.url}/event/${e.slug}/`;
    lines.push('BEGIN:VEVENT', `UID:${e.slug}@events.livelovelascruces.com`, `DTSTAMP:${now}`);
    if (e.start.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateKey(e.start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${dateKey(addDays(e.start, 1)).replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART:${icsStamp(e.start)}`);
      if (e.end) lines.push(`DTEND:${icsStamp(e.end)}`);
    }
    lines.push(`SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.address || e.venue)}`, `DESCRIPTION:${esc(`${e.description}\n\n${url}`.trim())}`, `URL:${url}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
