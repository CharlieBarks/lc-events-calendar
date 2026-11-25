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
  payUrl: 'https://buy.stripe.com/4gMbJ1dSdbYk4Rw0Y1dEs00', // "Calendar Spotlight" $50, made Nov 23, 2026; after paying, buyers land on /submit/?spotlight=paid
};

// Repeating events (src/lib/repeat.js) are listed this many days ahead. Each nightly build moves the window on.
export const REPEAT_DAYS = 90;

// How many days of listings are part of the page itself. Later days are fetched when a visitor
// asks for them (src/pages/more/[key].astro), which keeps these pages small and fast.
export const HOME_DAYS = 7;
export const CATEGORY_DAYS = 14;

// "Are you a person?" check on the add-your-event form (Cloudflare Turnstile). This key is public.
// Its secret half lives on the lc-events-intake Worker as TURNSTILE_SECRET. Empty = no check.
export const TURNSTILE_SITEKEY = '0x4AAAAAAGA4KxanswdzNIWA';

// Cloudflare Web Analytics (visits, top pages, where visitors come from; no cookies). Public token.
// Not loaded on the private preview. Empty = off.
export const ANALYTICS_TOKEN = '39a223de0ee940dab9ad80fbe5db241e';

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
  // Added Nov 15, 2026 (Charlie): hikes, bird walks and nature programs get their own button.
  outdoors: {
    name: 'Outdoors', plural: 'Outdoors', color: '#4F6B2A',
    seo: 'Hikes, bird walks and outdoor events in Las Cruces',
    blurb: 'Guided hikes in the Organ Mountains, bird walks along the river, star parties and anything that gets you outside.',
    icon: '<path d="m3 20 6.5-11 4 6.5 2.5-4L21 20Z"/><circle cx="17" cy="6" r="2"/>',
  },
  // Added Nov 15, 2026 (Charlie): workshops and classes, so they're easy to find in one place.
  classes: {
    name: 'Classes & Workshops', plural: 'Classes & workshops', color: '#8B3A62',
    seo: 'Classes and workshops in Las Cruces',
    blurb: 'Makerspace workshops, library classes, painting nights and the hands-on stuff where you leave knowing something new.',
    icon: '<path d="M3 8.5 12 4l9 4.5-9 4.5Z"/><path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5M21 8.5V14"/>',
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
  if (/outdoor|hike|hiking|nature|bird/.test(key)) return 'outdoors';
  if (/workshop|^class(es)?$/.test(key)) return 'classes';
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
  ['outdoors', /outdoor recreation|^outdoors?$|hik(e|ing)|bird ?walk|birding|nature walk|star ?part|stargaz|camping|kayak|garden tour/i],
  ['fitness', /fitness|yoga|running|run$|cycling|pickleball|dance class|tai chi/i],
  ['classes', /^classes$|workshop|computer class|educational|^creativity$|class$|lesson|training/i],
  // Library "Movies" and "Book/Reading Club" are arts; "Games" (chess, D&D, mahjong) are community.
  ['arts-culture', /^movies$|^book\/reading club$/i],
  ['community', /^games$/i],
  ['food-drink', /food|drink|wine|beer|brew|spirits|tasting|dining|cooking|trivia|nightlife|happy hour/i],
  ['arts-culture', /arts|theater|theatre|comedy|dance|film|museum|exhibit|gallery|photography|painting|sculpture|poetry|literary|storytelling|book/i],
  ['city-hall', /government|politic|town hall|city council|public meeting/i],
];

// Library audiences ("Adult", "Teens", "Children") say who it's for, not what it is: they feed the
// Kids & Family button (audienceOf), not the category. A chess club for all ages is not a kids' event.
const AUDIENCE_TAG = /^(adults?|teens?|children|tweens?|all ages|seniors?|library)$/i;
export function categoryFromTags(tags = [], title = '') {
  const what = tags.filter((t) => !AUDIENCE_TAG.test(String(t).trim()));
  for (const [key, re] of TAG_RULES) if (what.some((t) => re.test(t))) return key;
  // Only an audience to go on: a children's-only listing is a family event.
  if (!what.length && tags.some((t) => /^children$/i.test(String(t).trim())) && !tags.some((t) => /^adults?$/i.test(String(t).trim()))) return 'family';
  return categoryKey(title);
}

export const SOURCES = {
  cityspark: { name: 'Live Love Las Cruces', url: 'https://livelovelascruces.com' },
  'city-of-las-cruces': { name: 'City of Las Cruces', url: 'https://lascruces.gov/events/' },
  lllc: { name: 'Live Love Las Cruces', url: 'https://livelovelascruces.com' },
  // Calendars the submissions Worker reads every night (FEEDS in feeds.js: same keys).
  library: { name: 'Las Cruces Public Libraries', url: 'https://lascruceslibrary.libcal.com/calendars' },
  'cruces-creatives': { name: 'Cruces Creatives', url: 'https://crucescreatives.org/Events' },
  'convention-center': { name: 'Las Cruces Convention Center', url: 'https://meetinlascruces.com/events/' },
  'farm-ranch': { name: 'New Mexico Farm & Ranch Heritage Museum', url: 'https://nmfarmandranchmuseum.org/events/' },
  'organ-mountains': { name: 'Friends of the Organ Mountains-Desert Peaks', url: 'https://organmountainsdesertpeaks.org/events/' },
  museums: { name: 'Las Cruces Museums', url: 'https://lascruces.assabetinteractive.com/calendar/' },
  // Found through Visit Las Cruces; the event page links to the organizer, not to them.
  'visit-las-cruces': { name: 'the organizer', url: '' },
  markets: { name: 'the organizer', url: '' },
  audubon: { name: 'Mesilla Valley Audubon Society', url: 'https://mvasaudubon.org/my-calendar/' },
  mesilla: { name: 'Town of Mesilla', url: 'https://www.mesillanm.gov/events/' },
  newsletter: { name: 'Live Love Las Cruces', url: 'https://livelovelascruces.com/local-events' },
  // Galleries' current shows, entered once on the Art Trail (src/lib/sisters.js, Nov 25, 2026)
  arttrail: { name: 'Las Cruces Art Trail', url: 'https://lascrucesarttrail.com/on-view-now/' },
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

// Links out to organizers carry UTM tags, so they see the visits we send them in their own
// analytics as "livelovelascruces" (Charlie's call, Nov 15). The newsletter uses the same source
// with utm_medium=newsletter. Our own sites and links that already carry UTM tags are left alone.
const OWN_HOSTS = /(^|\.)(livelovelascruces\.com|lascrucesarttrail\.com|lascruceslive\.com|workers\.dev)$/i;
export function tagged(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || OWN_HOSTS.test(u.hostname) || [...u.searchParams.keys()].some((k) => k.startsWith('utm_'))) return url;
    u.searchParams.set('utm_source', 'livelovelascruces');
    u.searchParams.set('utm_medium', 'events_calendar');
    return u.toString();
  } catch {
    return url;
  }
}

// Who an event is for, on top of its category (Charlie, Nov 15): the "Free", "Kids & Family",
// "Seniors" and (Nov 24) "Outdoors" buttons on the calendar. An event can be in all of them. Las Cruces is a retirement town, so
// senior programs get their own way in.
const SENIOR = /\bseniors?\b|55\+|50\+|older adults?|retirees?|medicare|\baarp\b|tai chi for health|senior (center|community)|munson senior|trails west senior/i;
// Outdoors button (Charlie, Nov 24): hikes, runs and anything outside. Every Outdoors-category event,
// plus races and run clubs (often filed under Fitness). Whole words only: "Trails West" is a senior
// center, not a trail, so "trail" alone doesn't count.
const OUTDOOR = /\b(hikes?|hiking|hikers?|trail ?(runs?|running|walks?|rides?|work|days?)|fun ?run|color run|turkey trot|\d{1,2}k (run|walk|race)|\d{1,2}k\b|half[- ]marathon|marathon (run|race)|bataan|run(ning)? club|bird ?walks?|birding|nature walks?|star ?part(y|ies)|stargazing|kayak(ing)?|paddle|camp(ing|out)|bike rides?|group rides?|mountain bik(e|ing)|(park|river|trail|litter|arroyo|desert) clean-?up|organ mountains|dripping springs|soledad canyon|la llorona park|rio grande bosque|bosque walk)\b/i;
const KIDS = /\bkids?\b|child|children|family|families|teens?\b|youth|toddler|story ?time|homeschool|\bpre-?k\b|ages \d+ ?(-|–|to) ?1[0-7]\b|stay and play|baby|babies|tween/i;
export function audienceOf(e) {
  const tags = (e.tags || []).join(' | ');
  const text = `${e.title} | ${tags}`;
  const out = [];
  if (/\bfree\b/i.test(e.price || '') || /^\$?0(\.00)?$/.test((e.price || '').trim()) || /\bfree\b/i.test(e.title) || /^free$/im.test(tags.replace(/ \| /g, '\n'))
    || /\b(free (admission|entry|event|and open|to (the public|attend|all))|admission is free|no cost|no charge)\b/i.test(e.description || '')) out.push('free');
  if (e.category === 'family' || KIDS.test(text)) out.push('kids');
  if (e.category === 'outdoors' || OUTDOOR.test(text)) out.push('outdoors');
  if (SENIOR.test(`${text} | ${e.venue || ''} | ${(e.description || '').slice(0, 400)}`)) out.push('seniors');
  return out;
}
export const AUDIENCES = { free: 'Free', kids: 'Kids & Family', seniors: 'Seniors', outdoors: 'Outdoors' };
