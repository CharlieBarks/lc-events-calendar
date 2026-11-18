// Which part of town an event is in, from its address (Charlie, Nov 18). Shown on list rows
// ("Live music · East Mesa") and the starting point for an area filter.
// ZIP codes do most of it. 88001 covers downtown and the middle of town, so a downtown street
// name or venue makes it "Downtown"; the rest of 88001 is "Central". Mesilla is named in its addresses.
// An event with no ZIP in its address simply shows no area.

const BY_ZIP = {
  '88003': 'NMSU',
  '88005': 'West Las Cruces',
  '88007': 'West Mesa',
  '88011': 'East Mesa',
  '88012': 'Northeast',
  '88046': 'Mesilla',
  '88047': 'Mesilla Park',
  '88048': 'Mesquite',
  '88021': 'Anthony',
  '88024': 'Berino',
  '88027': 'Chamberino',
  '88044': 'La Mesa',
  '88008': 'Santa Teresa',
  '88063': 'Sunland Park',
  '88052': 'Organ',
};

// Downtown Las Cruces: Main Street and the few blocks around it (88001), plus its landmark venues.
const DOWNTOWN_STREET = /\b\d{1,4}\s+(n\.?|s\.?|north|south)?\s*(main|water|church|campo|griggs)\s+(st|street)\b|\b\d{1,4}\s+(w\.?|west|e\.?|east)?\s*las cruces ave/i;
const DOWNTOWN_VENUE = /\bplaza de las cruces\b|\bdowntown\b|\brio grande theat(re|er)\b|\bbranigan cultural\b|\blas cruces museum of (art|nature)|\bmuseum of nature (and|&) science\b|\bfarmers (and|&) crafts market\b/i;

export function areaOf(e) {
  const text = `${e.address || ''} ${e.venue || ''}`;
  // Mesilla as the town (", Mesilla"), not the street (Avenida de Mesilla).
  if (/,\s*mesilla\b(?!\s*park)/i.test(e.address || '') && !/\b88047\b/.test(text)) return 'Mesilla';
  if (DOWNTOWN_VENUE.test(text)) return 'Downtown';
  const zip = (text.match(/\b(8[78]\d{3})\b/) || [])[1];
  if (zip === '88001') return DOWNTOWN_STREET.test(e.address || '') ? 'Downtown' : 'Central';
  return BY_ZIP[zip] || '';
}

// Nearby towns outside the Las Cruces area (Charlie, Nov 18). Their special events are kept off the
// main calendar and listed by town on /nearby/, where people pick the towns that matter to them.
// Only events Charlie approves or adds (form, events.json, newsletter) are kept; feed listings from
// these towns are left out so the page stays special events only.
export const TOWNS = ['Alamogordo', 'Cloudcroft', 'Deming', 'Elephant Butte', 'Hatch', 'Ruidoso', 'Silver City', 'Truth or Consequences', 'Tularosa'];
const TOWN_ZIP = {
  '88310': 'Alamogordo', '88311': 'Alamogordo', '88317': 'Cloudcroft', '88030': 'Deming', '88031': 'Deming',
  '87935': 'Elephant Butte', '87937': 'Hatch', '88345': 'Ruidoso', '88346': 'Ruidoso', '88355': 'Ruidoso',
  '88061': 'Silver City', '88062': 'Silver City', '87901': 'Truth or Consequences', '88352': 'Tularosa',
};
const TOWN_NAME = /,\s*(alamogordo|cloudcroft|deming|elephant butte|hatch|ruidoso(?: downs)?|silver city|truth or consequences|t or c|tularosa)\b/i;

export function townOf(e) {
  const text = `${e.address || ''}`;
  const zip = (text.match(/\b(8[78]\d{3})\b/) || [])[1];
  if (TOWN_ZIP[zip]) return TOWN_ZIP[zip];
  const m = text.match(TOWN_NAME);
  if (!m) return '';
  const n = m[1].toLowerCase();
  if (n === 't or c') return 'Truth or Consequences';
  if (n.startsWith('ruidoso')) return 'Ruidoso';
  return TOWNS.find((t) => t.toLowerCase() === n) || '';
}
