export const SITE = {
  name: 'Las Cruces Events',
  url: 'https://events.livelovelascruces.com',
  tagline: 'Live music, markets, art walks and everything else happening in Las Cruces, NM',
  publisher: 'Live Love Las Cruces',
  publisherUrl: 'https://livelovelascruces.com',
  newsletterUrl: 'https://livelovelascruces.com/subscribe',
  subscribers: '10,000+',
};

// CitySpark makes its own placeholder pictures for listings that don't have one (Adult Pickleball,
// Zumba Gold, board meetings…). They're CitySpark's, so set this to false the day the CitySpark
// subscription ends: those pictures are swapped for our own topic artwork (src/lib/topics.js).
// Organizers' own flyers and photos are kept either way.
export const CITYSPARK_SUBSCRIBED = true;

// Spotlight: the paid boost offered on /submit/.
//   payUrl: Charlie's Stripe Payment Link. The submission's reference is added to it
//   (?client_reference_id=…) so the payment can be matched in Stripe. Empty = "I'll email you a payment link".
export const SPOTLIGHT = {
  price: 50,
  payUrl: '',
};

// Event submissions Worker (source: intake.js): reads flyers, holds the review queue, serves approved events.
export const INTAKE_URL = 'https://lc-events-intake.cf2-99b.workers.dev';

// Private design preview: built with EVENTS_PREVIEW=1. Adds noindex and a banner.
export const PREVIEW = process.env.EVENTS_PREVIEW === '1';

// Icons are 24x24 line drawings, drawn in white on the category color.
export const CATEGORIES = {
  'live-music': {
    name: 'Live Music', plural: 'Live music', color: '#B23A2B',
    seo: 'Live music in Las Cruces',
    blurb: 'Patio sets, winery nights, honky-tonk Saturdays and the touring acts that make the drive down I-25.',
    icon: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  },
  'arts-culture': {
    name: 'Arts & Culture', plural: 'Arts & culture', color: '#5B4A8B',
    seo: 'Art openings, theater and culture in Las Cruces',
    blurb: 'Gallery openings, the First Friday Ramble, theater on Main Street and museum nights.',
    icon: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.4-1-2.5 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  },
  'food-drink': {
    name: 'Food & Drink', plural: 'Food & drink', color: '#A0581F',
    seo: 'Food and drink events in Las Cruces',
    blurb: 'Brewery trivia, wine tastings, chile roasts and pop-up dinners worth leaving the house for.',
    icon: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M17 21V3c-2 1.5-3 4-3 7h3"/>',
  },
  markets: {
    name: 'Markets', plural: 'Markets', color: '#2F5D50',
    seo: 'Farmers markets and craft fairs in Las Cruces',
    blurb: 'The Saturday market on Main, craft fairs, pop-ups and the stuff you can only buy here.',
    icon: '<path d="M4 9h16l-1.5 11h-13L4 9Z"/><path d="M8.5 9 12 4l3.5 5"/>',
  },
  family: {
    name: 'Family & Kids', plural: 'Family-friendly', color: '#1F5A7A',
    seo: 'Family-friendly things to do in Las Cruces',
    blurb: 'Story times, museum crafts, park days and anything a five-year-old will actually sit through.',
    icon: '<path d="M12 3c3 0 5 2.4 5 5.5S14.8 15 12 15s-5-3.4-5-6.5S9 3 12 3Z"/><path d="M12 15c0 2 1.5 2.5 0 4s0 2 0 2"/>',
  },
  sports: {
    name: 'Sports', plural: 'Sports', color: '#7A2E1F',
    seo: 'Sports events in Las Cruces',
    blurb: 'Aggie games, races, rodeos and the rec leagues looking for one more player.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  },
  fitness: {
    name: 'Fitness & Rec', plural: 'Fitness & rec', color: '#2F7A6B',
    seo: 'Fitness classes and recreation in Las Cruces',
    blurb: 'Pickleball, Zumba, trail runs and the city rec-center classes that cost about a dollar.',
    icon: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  },
  community: {
    name: 'Community', plural: 'Community', color: '#4A4540',
    seo: 'Community events in Las Cruces',
    blurb: 'Library programs, volunteer days, support groups and neighbors doing good things.',
    icon: '<circle cx="9" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3.5 20c.5-3.5 2.8-5.5 5.5-5.5s5 2 5.5 5.5M14 15c2.8-.6 5.6.8 6.5 5"/>',
  },
  'city-hall': {
    name: 'City Hall & Meetings', plural: 'City meetings', color: '#1F2A44',
    seo: 'City of Las Cruces public meetings',
    blurb: 'Boards, committees and public input sessions. Where the decisions about this town get made.',
    icon: '<path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M2.5 10 12 4l9.5 6Z"/>',
  },
};

// City of Las Cruces categories -> ours.
const CITY_MAP = {
  'fitness classes and sessions': 'fitness',
  boards: 'city-hall',
  'community engagement': 'city-hall',
  'city council': 'city-hall',
  community: 'community',
  'arts and culture': 'arts-culture',
  'special events': 'community',
  'youth and family': 'family',
  sports: 'sports',
};

export function categoryKey(raw = '') {
  const key = String(raw).trim().toLowerCase();
  if (CATEGORIES[key]) return key;
  if (CITY_MAP[key]) return CITY_MAP[key];
  if (/music|concert|band/.test(key)) return 'live-music';
  if (/art|museum|theat|gallery|culture/.test(key)) return 'arts-culture';
  if (/food|drink|beer|wine|brew/.test(key)) return 'food-drink';
  if (/market|fair|craft/.test(key)) return 'markets';
  if (/kid|family|youth|child/.test(key)) return 'family';
  if (/sport|game|race|aggie/.test(key)) return 'sports';
  if (/fitness|class|yoga|rec/.test(key)) return 'fitness';
  if (/board|council|committee|meeting|commission/.test(key)) return 'city-hall';
  return 'community';
}

// CitySpark category names (every level of the tree) -> ours. First match wins, so order matters:
// a concert at a winery is live music, not food & drink.
const TAG_RULES = [
  ['live-music', /^(music|musicevent|concerts?|outdoor concerts|open mic|karaoke|dj)$|music|band|jazz|blues|rock|country|hip hop|mariachi|acoustic|choral|orchestra|symphony/i],
  ['markets', /market|craft fair|bazaar|flea|shopping|holiday sales|swap meet/i],
  ['family', /kid|child|family|teen|youth|toddler|story ?time/i],
  ['sports', /^sports$|football|basketball|baseball|soccer|volleyball|hockey|rodeo|racing|tournament|aggie/i],
  ['fitness', /fitness|yoga|outdoor recreation|hiking|running|run$|cycling|pickleball|dance class/i],
  ['food-drink', /food|drink|wine|beer|brew|spirits|tasting|dining|cooking|trivia|nightlife|happy hour/i],
  ['arts-culture', /arts|theater|theatre|comedy|dance|film|museum|exhibit|gallery|photography|painting|sculpture|poetry|literary|storytelling|book/i],
  ['city-hall', /government|politic|town hall|city council|public meeting/i],
];

export function categoryFromTags(tags = [], title = '') {
  for (const [key, re] of TAG_RULES) if (tags.some((t) => re.test(t))) return key;
  return categoryKey(title);
}

export const SOURCES = {
  cityspark: { name: 'Live Love Las Cruces', url: 'https://livelovelascruces.com' },
  'city-of-las-cruces': { name: 'City of Las Cruces', url: 'https://lascruces.gov/events/' },
  lllc: { name: 'Live Love Las Cruces', url: 'https://livelovelascruces.com' },
};

export function breadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE.url}${it.path}`,
    })),
  };
}
