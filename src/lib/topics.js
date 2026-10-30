// Event-specific artwork for listings without their own photo or flyer.
// Each event is matched to a topic by its title (then its tags/description). The topic's icon is drawn
// on the category color with the Organ Mountains skyline, on cards, event pages and share images.
//
// To add a topic: add a line below (key, label, words to look for, icon). Icons are 24x24 line drawings.
// Order matters: the first match wins, so specific/seasonal topics come before general ones.

// When an event has no better category, its topic decides (pickleball -> Fitness & Rec).
const TOPIC_CATEGORY = {
  pickleball: 'fitness', tennis: 'fitness', fitness: 'fitness', yoga: 'fitness', dance: 'fitness', running: 'fitness', cycling: 'fitness', hiking: 'fitness',
  football: 'sports', basketball: 'sports',
  trivia: 'food-drink', wine: 'food-drink', beer: 'food-drink', cocktails: 'food-drink', food: 'food-drink',
  karaoke: 'live-music', music: 'live-music', dj: 'live-music',
  comedy: 'arts-culture', theater: 'arts-culture', exhibit: 'arts-culture', painting: 'arts-culture', film: 'arts-culture', photo: 'arts-culture', crafts: 'arts-culture', books: 'arts-culture',
  kids: 'family', market: 'markets', meeting: 'city-hall',
};

export const TOPICS = [
  ['halloween', 'Halloween', /halloween|trunk.?or.?treat|haunt|spooky|\bboo\b|costume|ghoul|scream|horror|witch/i,
    '<path d="M12 7c-5 0-8 2.5-8 6.5S7 20 12 20s8-2.5 8-6.5S17 7 12 7Z"/><path d="M12 7c-2 0-3 3-3 6.5S10 20 12 20M12 7c2 0 3 3 3 6.5S14 20 12 20M12 7c0-2 1-3.5 2.5-4"/>'],
  ['muertos', 'Día de los Muertos', /d[ií]a de (los )?muertos|day of the dead|ofrenda|calavera|catrina|vigil|memorial/i,
    '<path d="M9 10h6v11H9Z"/><path d="M12 10V8M12 3c1.5 1.5 1.5 3 0 4-1.5-1-1.5-2.5 0-4Z"/><path d="M6 21h12"/>'],
  ['holiday', 'Holiday', /christmas|holiday|santa|tree lighting|winter ?fest|posada|luminaria|noche buena|hanukkah|new year/i,
    '<path d="M12 3l5 6h-3l4 5h-3l4 5H5l4-5H6l4-5H7Z"/><path d="M12 19v2"/>'],
  ['pickleball', 'Pickleball', /pickleball/i,
    '<rect x="3.5" y="2.5" width="9.5" height="11.5" rx="4.6" transform="rotate(-28 8.2 8.2)"/><path d="M11.3 13.4l3.4 6.4"/><path d="M6.5 6.5h.01M9 5.5h.01M7.5 9h.01M10 8h.01"/><circle cx="18.5" cy="6.5" r="2.8"/><path d="M17.6 5.8h.01M19.4 6.2h.01M18.4 7.6h.01"/>'],
  ['tennis', 'Tennis', /tennis/i,
    '<ellipse cx="10" cy="9" rx="6" ry="6.5"/><path d="M14.2 13.7 20 20"/><circle cx="18.5" cy="5.5" r="2"/>'],
  ['football', 'Football', /football/i,
    '<ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-35 12 12)"/><path d="M9 15l6-6M10.5 11.5l2 2M12 10l2 2"/>'],
  ['basketball', 'Basketball', /basketball/i,
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8"/>'],
  ['trivia', 'Trivia', /trivia|quiz/i,
    '<path d="M4 5h16v11H9l-5 4Z"/><path d="M10 9a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2"/><path d="M12 14h.01"/>'],
  ['bingo', 'Bingo', /bingo|loter[ií]a/i,
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/><circle cx="12" cy="12" r="1.6"/>'],
  ['karaoke', 'Karaoke & open mic', /karaoke|open mic/i,
    '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>'],
  ['comedy', 'Comedy', /comedy|stand.?up|comedian|improv/i,
    '<circle cx="12" cy="12" r="9"/><path d="M8 13a4 4 0 0 0 8 0Z"/><path d="M8 9l2 1M16 9l-2 1"/>'],
  ['dj', 'Dance party', /\bdj\b|dance party|rave|disco|club night|edm/i,
    '<circle cx="12" cy="13" r="7"/><path d="M12 3v3M5 13h14M12 6c-3 3-3 11 0 14M12 6c3 3 3 11 0 14M6.5 9.5h11M6.5 16.5h11"/>'],
  ['dance', 'Dance', /zumba|danc|salsa|bachata|two.?step|ballroom|folkl[oó]rico|line danc|ballet|tango/i,
    '<circle cx="13" cy="4.5" r="2"/><path d="M13 7l-2 6 3 3v5M11 13l-4 2M13 9l4 2 2-2M11 16l-3 5"/>'],
  ['yoga', 'Yoga & wellness', /yoga|meditat|tai chi|sound bath|breathwork|mindful/i,
    '<path d="M12 20c-4 0-8-2-9-5 3-.5 6 .5 9 3 3-2.5 6-3.5 9-3-1 3-5 5-9 5Z"/><path d="M12 18c-2-2-3-5-2-9 1 .8 1.6 1.6 2 2.5.4-.9 1-1.7 2-2.5 1 4 0 7-2 9Z"/>'],
  ['fitness', 'Fitness', /fitness|boot ?camp|workout|aerobic|exercise|strength|pilates|spin class|crossfit/i,
    '<path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12"/>'],
  ['running', 'Run & walk', /\b5k\b|\b10k\b|fun run|\brun\b|running|marathon|walkathon|race\b/i,
    '<path d="M3 16c0-3 2-4 4-5l2-5 3 1-1 3 3 2c2 1 5 1 7 2v3H3Z"/><path d="M3 19h18"/>'],
  ['cycling', 'Cycling', /bike|cycling|bicycle/i,
    '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h3"/>'],
  ['hiking', 'Outdoors', /hike|hiking|trail|nature walk|bird|birding|organ mountains|dripping springs|camp/i,
    '<path d="M2 20 9 7l4 7 2.5-3.5L22 20Z"/>'],
  ['tour', 'Tour', /tour|walking tour|ghost walk|history walk/i,
    '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10Z"/><circle cx="12" cy="11" r="2.2"/>'],
  ['space', 'Space & science', /rocket|launch|astronom|star ?gaz|telescope|planetarium|space|\bmoon\b|eclipse|science/i,
    '<path d="M12 2c3 2.5 4.5 6 4.5 10L14 15h-4l-2.5-3C7.5 8 9 4.5 12 2Z"/><circle cx="12" cy="9" r="1.6"/><path d="M10 15l-1 4 3-2 3 2-1-4M7.5 12 5 15l3 .5M16.5 12 19 15l-3 .5"/>'],
  ['balloon', 'Balloons', /balloon/i,
    '<path d="M12 3a7 7 0 0 0-7 7c0 3.5 3 6 5 8h4c2-2 5-4.5 5-8a7 7 0 0 0-7-7Z"/><path d="M10 18v3h4v-3M12 3c-2 2-2.5 5-2.5 7.5S10.5 16 10 18M12 3c2 2 2.5 5 2.5 7.5S13.5 16 14 18"/>'],
  ['cars', 'Car show', /car show|cruise night|lowrider|\bauto\b|motorcycle/i,
    '<path d="M3 15v-3l2-5h14l2 5v3Z"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><path d="M3 12h18"/>'],
  ['pets', 'Pets', /\bdog|\bpet\b|pets|puppy|adoption|animal|\bcat\b/i,
    '<circle cx="7" cy="9" r="1.8"/><circle cx="17" cy="9" r="1.8"/><circle cx="10" cy="5.5" r="1.8"/><circle cx="14" cy="5.5" r="1.8"/><path d="M12 11c-3 0-5.5 4-5.5 6.5 0 2 2 2.5 5.5 2.5s5.5-.5 5.5-2.5C17.5 15 15 11 12 11Z"/>'],
  ['chess', 'Chess', /chess/i,
    '<circle cx="12" cy="6" r="2.5"/><path d="M10 9.5h4l1 7H9ZM7 20h10l-1-3.5H8Z"/>'],
  ['games', 'Game night', /dungeons|d&d|board game|game night|mahjong|bridge|canasta|poker|puzzle|cards|gaming|video game|lego/i,
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/>'],
  ['film', 'Movies', /movie|film|cinema|screening/i,
    '<rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M3 9l1-4h16l1 4M8 5l2 4M13 5l2 4"/>'],
  ['theater', 'Theater', /theat|\bplay\b|musical|opera|nutcracker|recital|performance/i,
    '<path d="M3 4h9v6a4.5 4.5 0 0 1-9 0Z"/><path d="M12 9h9v6a4.5 4.5 0 0 1-9 0"/><path d="M5.5 7.5h1M8.5 7.5h1M6 11c1 .8 2 .8 3 0M14.5 12.5h1M17.5 12.5h1M15 16.5c1-.8 2-.8 3 0"/>'],
  ['exhibit', 'Exhibit', /exhibit|museum|gallery|on view|opening reception|artist talk|art walk|first friday|ramble/i,
    '<rect x="3" y="4" width="18" height="15" rx="1.5"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>'],
  ['painting', 'Art class', /paint|watercolor|drawing|sketch|pottery|ceramic|clay|art class|mosaic|glass/i,
    '<path d="M14 4l6 6-8 8-6-6Z"/><path d="M6 12c-2 1-3 3-3 6 3 0 5-1 6-3"/>'],
  ['crafts', 'Crafts', /craft|knit|crochet|quilt|sew|scrapbook|weav|jewelry|make.?and.?take|\bdiy\b/i,
    '<circle cx="11" cy="12" r="7"/><path d="M5.5 8.5c4 0 8 2 11 6M4.5 13c4-1 8 0 10 3M8 5.5c3 2 5 5 5.5 9.5"/><path d="M17 17c1.5 1 3 1.5 4 1"/>'],
  ['books', 'Books & reading', /book|reading|read\b|author|poetry|library|story ?time|writ|journal/i,
    '<path d="M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1Z"/><path d="M12 6v14"/>'],
  ['music', 'Live music', /concert|band|live music|jazz|blues|rock|country|mariachi|symphony|orchestra|choir|acoustic|singer|songwriter|ukulele|\buke\b|guitar|music/i,
    '<path d="M14 10l6-6M18 3l3 3"/><path d="M11.5 9.5c-2-1-4.5-.5-6 1-2 2-2 5.5 0 7.5s5.5 2 7.5 0c1.5-1.5 2-4 1-6Z"/><circle cx="9.5" cy="14.5" r="1.5"/>'],
  ['wine', 'Wine', /wine|winery|vino|sangria|merlot|vineyard/i,
    '<path d="M7 3h10l-1 6a4 4 0 0 1-8 0Z"/><path d="M12 13v7M8 21h8"/>'],
  ['beer', 'Beer', /beer|brew|taproom|\bale\b|oktoberfest|\bpub\b|cerveza/i,
    '<path d="M5 7h10v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><path d="M15 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2M8 11v6M11 11v6M5 7c0-2 2-3 5-3s5 1 5 3"/>'],
  ['cocktails', 'Cocktails', /cocktail|distill|margarita|tequila|whiskey|mezcal|happy hour|\bbar\b/i,
    '<path d="M4 4h16l-8 9Z"/><path d="M12 13v7M8 21h8M16 7h.01"/>'],
  ['food', 'Food', /dinner|brunch|breakfast|lunch|food truck|tasting|chef|bbq|barbecue|pizza|slice|taco|chile|cook|potluck|feast|supper/i,
    '<circle cx="12" cy="12" r="5.5"/><path d="M3 4v6a2 2 0 0 0 2 2v8M3 4v4M5 4v4M21 20V4c-2 1.5-3 4-3 7h3"/>'],
  ['market', 'Market', /market|mercado|fair\b|bazaar|vendor|swap meet|flea|pop.?up shop/i,
    '<path d="M3 9l2-5h14l2 5Z"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8M10 20v-4h4v4"/>'],
  ['garden', 'Garden', /garden|plant|seed|botanic|flower|compost|tree planting/i,
    '<path d="M12 21v-9"/><path d="M12 12c0-4 3-6 7-6 0 4-3 6-7 6ZM12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5Z"/>'],
  ['kids', 'Kids & family', /kid|children|family|toddler|teen|youth|baby|tween|grandkid|preschool/i,
    '<path d="M12 3c3 0 5 2.4 5 5.5S14.8 15 12 15s-5-3.4-5-6.5S9 3 12 3Z"/><path d="M12 15c0 2 1.5 2.5 0 4s0 2 0 2"/>'],
  ['volunteer', 'Give back', /volunteer|fundrais|benefit|donat|charity|gala|clean.?up|food drive|blood drive/i,
    '<path d="M12 9.5c-1.5-2-4.5-1.5-4.5 1 0 2 4.5 4.5 4.5 4.5s4.5-2.5 4.5-4.5c0-2.5-3-3-4.5-1Z"/><path d="M3 15l4 4h8l5-3-1.5-1.5L14 16"/>'],
  ['meeting', 'Public meeting', /board|council|commission|committee|meeting|hearing|town hall|public input|advisory/i,
    '<path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M2.5 10 12 4l9.5 6Z"/>'],
  ['class', 'Class & workshop', /class|workshop|lesson|lecture|seminar|webinar|training|\btalk\b|course|literacy|tutor/i,
    '<path d="M2 9l10-5 10 5-10 5Z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>'],
  ['photo', 'Photography', /photo/i,
    '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-3h5L16 7"/>'],
].map(([key, label, re, icon]) => ({ key, label, re, icon, category: TOPIC_CATEGORY[key] }));

// Title first, then CitySpark's tags, then the start of the description.
export function topicFor(e) {
  const passes = [e.title || '', (e.tags || []).join(' | '), (e.description || '').slice(0, 300)];
  for (const text of passes) {
    if (!text) continue;
    for (const t of TOPICS) if (t.re.test(text)) return t;
  }
  return null;
}
