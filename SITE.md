# Las Cruces Events

Site-specific rules. The shared rules are in [AGENTS.md](AGENTS.md). Read the `README.md` too: it's the operations manual (feeds, Workers, images, CitySpark).

## What it is

The Live Love Las Cruces events calendar, replacing CitySpark at events.livelovelascruces.com. The place locals and visitors check for what's happening today, this weekend and this week.

- Live site (main branch): **https://events.livelovelascruces.com** since Nov 23, 2026 (Worker `lc-events-calendar`, Cloudflare custom domain). Also still answers at https://lc-events-calendar.cf2-99b.workers.dev (noindex).
- **Undo the domain move:** Workers & Pages > `lc-events-calendar` > Settings > Domains: remove events.livelovelascruces.com, then in DNS for livelovelascruces.com add back `A events 155.138.241.30`, proxied (the old WordPress calendar host).
- Design preview (redesign branch, noindex): https://lc-events-preview.cf2-99b.workers.dev (Worker `lc-events-preview`)
- Other Workers: `cityspark-export` (daily CitySpark copy, then rebuild), `lc-events-proxy` (City of Las Cruces feed)

## Data

| Data | Source | Edit by hand? |
|---|---|---|
| CitySpark listings and photos | `cityspark-export` Worker into KV, daily | No |
| City of Las Cruces events | City feed through `lc-events-proxy` | No |
| Other organizations' calendars (library, museums, Cruces Creatives, Convention Center, Farm & Ranch Museum, Organ Mountains-Desert Peaks, Audubon, Visit Las Cruces as a finder) | Read nightly by the `lc-events-intake` Worker (`feeds.js`) | No |
| `src/data/events.json` | Events we add ourselves | **Yes** (`featured: true` = Featured; `sponsored: true` = paid Spotlight; `sample: true` = preview only) |
| `src/data/spotlight.json` | Spotlight for events that didn't come through the form (CitySpark, city), matched by name | **Yes** |
| `src/data/city-snapshot.json` | Offline copy of the city feed | No |
| `src/data/venues.json` | Built-in venue list: one name per venue, every other spelling as an alias. Charlie's edits from the Venues screen are merged on top at build time | Yes, but the Venues screen is the easy way |

- Offline build: `EVENTS_OFFLINE=1 npm run build`.
- The build stops on purpose if the CitySpark copy or the submissions can't be read, or if no source has any upcoming event. The city feed is optional. Keep those guards.
- Daily rebuild: the `lc-events-intake` Worker's schedule (`wrangler.intake.jsonc`, 12:10 AM Las Cruces time), not CitySpark.
- **Builds sometimes fail with HTTP 403 from our own feeds** (Cloudflare shows the build server a "Just a moment" check). The guards stop that build and the last good site stays up. Nothing is wrong with the code: run the build again. The nightly rebuild repeats at 12:40 and 1:10 AM for this reason.
- Cancelling CitySpark: set `FROZEN` = `1` on the `cityspark-export` Worker **first** (see README), then `CITYSPARK_SUBSCRIBED = false`.
- `cityspark-export` and `lc-events-proxy` are not deployed from this repo automatically. After changing `cityspark-export.js` or `worker.js`, the Worker has to be deployed by hand.
- `CITYSPARK_SUBSCRIBED` in `src/lib/site.js` switches CitySpark placeholder images to our artwork when the subscription ends.

## Feeds from other calendars

Built Nov 15, 2026. Charlie's rule: **no review step for feeds.** They publish automatically, and every event links to its own page on the organization's site.

- `feeds.js` (part of the `lc-events-intake` Worker) reads each calendar at 11:40 PM, half an hour before the first nightly rebuild. Sources are listed in `FEEDS` at the top of that file, with a reader for each kind of calendar: The Events Calendar (WordPress), LibCal, iCal and Wild Apricot.
- Each source is saved on its own. If one can't be read, last night's copy of it stays, so a calendar that's down for a day doesn't empty ours. `/feeds.json` on the Worker shows the last run (what was read, what failed) and everything saved.
- The events reach the site inside `/approved.json` (`feeds`), in the same request as approved submissions.
- **Which copy wins when an event arrives twice:** a submission, then the organization's own calendar, then CitySpark, then the city feed, then Visit Las Cruces.
- A source's name for the "Listed by" line on event pages is in `SOURCES` in `src/lib/site.js` (same key as in `FEEDS`).
- To add a source: add it to `FEEDS` and to `SOURCES`. If its calendar is a new kind, it needs a new reader.
- The schedule has two jobs: the three rebuild times are also listed in `intake.js` (`REBUILD_TIMES`); any other time on the schedule reads the feeds. Keep the two lists in step.
- **Hidden listings (built Nov 15):** the review page has "Hidden listings". Paste an event's address to hide it; tick "Every date of it" to hide all its dates (an address without a date always means every date). Hidden stays hidden on later nights; "Show again" undoes it. Only feed listings (organizations' calendars, CitySpark, city) can be hidden; submissions are taken off with Remove. The list is in KV `hidden.json` and reaches the build inside `/approved.json` (`hidden`).
- **"Something wrong with this listing?" (Nov 24, 2026, replaced the "Suggest an edit" link):** Charlie found the full edit form confusing for visitors. Event pages now have a small fold-out box: pick Already happened / Canceled / Wrong date or time / Wrong place / Something else, an optional comment (needed for Something else), and a **required first name and email**, plus the person check. It posts to the Worker's `/report` (KV `reports/<id>`) and emails Charlie. The review page lists them under **Reports**: **Fix it** (opens the listing fully editable: form events reopen, feed events are copied into the queue as Charlie's own edit), **Hide listing** (hides it and emails the visitor a thank-you), **Fixed: thank them** (`mailReportFixed`), **Dismiss** (no email). Wording in `handleReport` / `REPORT_REASONS` in `intake.js` and the `report` box in `src/pages/event/[slug].astro`.
  - Organizers still get the full form through the small "This is my event, I want to update it" link in the box (the suggested edit below). Charlie kept it on Nov 24 ("keep it for now"). Anyone can open it; nothing goes live until he approves.
- **Charlie's full edit of a feed listing (Nov 24, 2026):** **Edit** in the admin bar (or Fix it on a report) calls `/review/api/adopt`: the Worker reads the listing from its event page's `event-data` block and puts it in the queue as a suggested edit from Charlie (`adminEdit: true`, no emails), opened at the top of the review page. Approve puts his version up and hides the feed's copy, in one step.
- **Suggest an edit (built Nov 15):** the "This is my event" link opens `/submit/?suggest=<slug>` filled in from the page's `event-data` block. The change waits in the review queue marked "Suggested edit" (emails go out as for any submission). Approving it puts that version on the calendar and hides the original listing. It keeps the original's picture unless the person adds their own.
- **Links out carry UTM tags** (`utm_source=livelovelascruces&utm_medium=events_calendar`, `tagged()` in `src/lib/site.js`), so organizers see our visitors in their analytics. Not on our own sites, and not on links that already have UTM tags. The newsletter uses `utm_medium=newsletter` (GrokBot adds those).
- **Las Cruces Museums** (Museum of Art, Nature & Science, Branigan Cultural Center, Railroad Museum) come from their Assabet calendar's XML list. "Registration period" items are skipped.
- **Visit Las Cruces is a finder only** (Charlie, Nov 15): read through the same search their calendar page uses (Simpleview, with a short-lived token). An event is kept only when it links to the organizer's own site, and it links there, never to Visit Las Cruces. It loses to every other source (`finder: true` in `FEEDS`), so it only adds events nobody else has. Its "Listed by" line credits the venue.
- **No visitlascruces.com links from any source (Nov 24, 2026):** a CitySpark copy of the Mesilla Mercado linked to a Visit Las Cruces page that had gone 404. `offVisitLC()` in `src/lib/events.js` now blanks any visitlascruces.com address on every listing (CitySpark, newsletter, submissions, feeds) at build time. If Visit Las Cruces' own copy of the same event links to the organizer, that link is borrowed; otherwise the event shows no "Event details" button.
- Source research: project doc `event-sources-feed-check-2026-11-15.md`.

## Newsletter check

Built Nov 15, 2026. Charlie wants the calendar to be the best local source, so events he finds for the newsletter (often through GrokBot) should end up here too.

- Two scheduled Claude tasks read the published Beehiiv issue (Beehiiv, not the inbox: it's the issue itself and already connected): "Newsletter check for the events calendar (Tue/Fri)" at 6:30 AM Las Cruces time, right after the Local Events issue goes out (it waits up to 90 minutes if the issue isn't out yet), and "(Thu live music)" at 1:30 PM Thursday. Each finds the events that aren't on the calendar yet, writes them to KV `feeds/newsletter.json` (Cloudflare API), then starts a rebuild of the live site so they appear within minutes. It also tells Charlie which organizations keep showing up in the newsletter without feeding the calendar, so they can be added as feeds.
- Events GrokBot already linked to the calendar are already on it, so they're skipped. Added events link to the organizer's own page, never to the calendar or visitlascruces.com.
- `feeds/newsletter.json` is the `newsletter` source in `feeds.js` (`reader: 'manual'`: the nightly feed run doesn't touch it). It is published like any other feed, with no review.
- Same shape as other feed events: `{ feed: 'newsletter', title, start, end, venue, address, tags, price, description, url, image, issue }`. The task drops past events when it writes.
- To stop it: pause the scheduled task in Claude. To remove what it added: empty `feeds/newsletter.json` (`{"events":[]}`).

## Weekly markets

Built Nov 24, 2026. Charlie wants the Farmers & Crafts Market of Las Cruces and the Mesilla Mercado on the calendar every week, and both sometimes move or skip a date for a bigger event.

- **Where they live:** KV `feeds/markets.json`, the `markets` source in `feeds.js` (`reader: 'manual'`, like the newsletter source; the nightly feed run doesn't touch it). Five repeat rules: Saturday market on Main Street and the Wednesday mini market on Plaza de Las Cruces (both 8:30 AM to 1 PM), and the Mercado on Fridays and Sundays with winter hours (Nov to Apr, 11 AM to 4 PM) and summer hours (May to Oct, 9 AM to 2 PM) as separate rules, through winter 2027. Add the next season's rules before then.
- They link to the markets' own pages (farmersandcraftsmarketoflascruces.com, the Town of Mesilla's Mercado page). They beat CitySpark's copies, and CitySpark's and the city's old copies (which linked to visitlascruces.com) are hidden for every date in `hidden.json`.
- **Weekly check:** a scheduled Claude task, "Weekly markets check", on Monday mornings. It looks three weeks ahead at the markets' own sites, the City of Las Cruces calendar (Main Street closures, special market days), the Town of Mesilla calendar and recent newsletter issues. A called-off date goes into that rule's `skip` list; a moved or extra date (an evening or Sunday market) goes in as a one-off entry in the same file. Then it rebuilds the site and sends Charlie a short note of what changed (a phone notification, like the newsletter check). It also keeps the old CitySpark and city copies of the markets hidden.
- **Notices on the usual day (Charlie, Nov 24):** when a market moves or is called off, the usual date is skipped and gets an all-day notice in its place ("Saturday market moved to Sunday, Dec 6 (Electric Light Parade)", or "No Saturday market this week (…)"), plus the market itself on its new date, its description starting with what changed. Notices are ordinary one-off entries in `feeds/markets.json` (tag "Notice"); their titles never start with "Canceled" or "Postponed", which `NOT_AN_EVENT` drops.
- To change hours or days by hand: edit the rule in `feeds/markets.json` (Cloudflare KV, namespace MEDIA), then use **Publish changes now** on the Venues screen or wait for the nightly rebuild.

## Las Cruces Live and Art Trail links

Built Nov 15, 2026 (Charlie: the three sites should work together; people keep asking what genre a band plays).

- Each sister site publishes `/directory.json` (lascruceslive.com: acts with their page and genres, and venues; lascrucesarttrail.com: galleries, museums and published artists). The build reads both (`src/lib/sisters.js`). If one can't be read, the build goes on without those links.
- **Live music:** when a live music listing's title names an act on Las Cruces Live, the listing shows the act's genres after the venue ("Rio Grande Winery · Americana, Country") and the event page gets a "Who" line with each act, its genres and a link to its page. Searching a genre ("americana") finds those shows.
- **Venues:** an event at a venue listed on either site links to it ("Rio Grande Winery on Las Cruces Live"). Venue names are matched through `venues.json`, so any spelling counts.
- **Artists:** an event whose title names a published Art Trail artist links to the artist.
- Band names that are everyday words ("The Band", "Illusion", "Caliente") are skipped so they don't match the wrong events: `COMMON` in `sisters.js`. A band name must match whole words in the title. Acts not on Las Cruces Live show no genre: add them there.
- Local testing: `EVENTS_DIRECTORY_LIVE=file.json` / `EVENTS_DIRECTORY_ART=file.json`.

## Who it's for, and the category list

Built Nov 15, 2026 (Charlie: Las Cruces is a retirement town; seniors and families ask the most).

- **Free, Kids & Family, Seniors** buttons sit above the categories on the calendar and work together with the date, category and search. `?for=seniors` (or `kids`, `free`) is a shareable link. The homepage "Browse by vibe" starts with For seniors, Kids & family and Free things to do (the Family category tile is left out there because Kids & family already covers it).
- **Outdoors button (Nov 24, 2026):** Charlie's subscribers love the local hikes, runs and outdoor activities, so Outdoors joined the who-it's-for row (`?for=outdoors`). It takes every Outdoors-category event plus races, run clubs, bird walks, star parties, kayaking, group rides and park or arroyo clean-ups from any category (runs are often filed under Fitness): `OUTDOOR` in `src/lib/site.js`. "Trail" alone and "marathon" alone don't count ("Trails West" senior center, movie marathons). On the homepage "Browse by vibe" it's the "Get outside" tile, and the Outdoors category tile is left out there like Family.
- Each event's audience comes from `audienceOf()` in `src/lib/site.js`: words in the title, tags, venue and price ("senior", "55+", "Munson Senior Center", "story time", "ages 6–12", "Free"...). An event can be in all three. To catch more, add words to the `SENIOR` and `KIDS` patterns there.
- **Categories added Nov 15:** Outdoors (hikes, bird walks, star parties) and Classes & Workshops. Category list order is the order in `CATEGORIES`.
- **Library audiences** ("Adult", "Teens", "Children") never decide the category, only the Kids & Family button. Library "Movies" and "Book/Reading Club" are Arts & culture, "Games" Community, "Storytime" Family. Rules in `TAG_RULES` / `categoryFromTags` in `src/lib/site.js`.
- **Not events:** closures ("Libraries Closed for Thanksgiving") and canceled or postponed listings are dropped from every source (`NOT_AN_EVENT` in `src/lib/events.js`).
- **Topic words match whole words** (`src/lib/topics.js`): "Grave" isn't a rave, "Discussion" isn't disco, "Makerspace" isn't space, "Trails West" isn't hiking, "Santa Fe" isn't Christmas. Check a new word for this before adding it.

## Search

- One search box at the top of the calendar's filters (homepage and category pages). It narrows the same day-by-day list and works together with the date and category filters.
- Index: `/search.json`, built with the site (title, venue, venue aliases and keywords, category, tags, short description). The browser only downloads it, plus the MiniSearch library, when someone starts typing.
- Typing suggests **venues** (picking one filters to that venue: `?venue=rio-grande-winery`) and **events** (opens the event page).
- Searches are shareable links: `/?q=trivia&when=week`.
- **Filters bring the list back to its top** (Nov 23, 2026): the filter bar sticks to the top of the screen while scrolling, so any date, category, Free / Kids & Family / Seniors button, the category dropdown or a venue pick scrolls back to the first day of the results (`toTop()` in `Agenda.astro`). The stuck filters sit just under the slim header when it shows (3.5rem, the slim bar's height in `Header.astro`; change both together).
- **Picking a category clears the search and venue** and shows the whole category (Charlie's call, Nov 10). Date buttons still combine with a search.
- **Slim filter bar (Nov 24, 2026):** Charlie found the stuck bar too tall. Categories are now an "All categories" dropdown on every screen (it turns dark when a category is picked), sharing a row with the search box and the "N events" line. The date buttons and the Free / Kids & Family / Seniors / Outdoors buttons share the next row on wide screens, with a thin line between them. On phones (560px and narrower) search and the dropdown sit side by side and each button row slides sideways. About 126px tall on desktop (was about 290px) and 205px on phones (was 262px).
- **While searching** (a search or a venue filter is on), regulars and city meetings open up into full cards like one-off events. The normal view keeps them as slim rows, each with a small picture (flyer, photo or topic art). Approved by Charlie, Nov 10.

## Analytics, spam check, old addresses

- **Analytics:** Cloudflare Web Analytics, the same as livelovelascruces.com and the Art Trail (`ANALYTICS_TOKEN` in `src/lib/site.js`, loaded in `Layout.astro`). Visits, top pages and where visitors come from; no cookies, so no cookie banner. Not loaded on the preview. Read it in Cloudflare under Analytics & Logs > Web Analytics > events.livelovelascruces.com. It has no custom events (it can't count Spotlight clicks).
- **"Are you a person?" check:** Turned on (enforced) Nov 18, 2026 after Charlie's test submission passed. Cloudflare Turnstile on `/submit/` (widget "Las Cruces Events submissions"; public key `TURNSTILE_SITEKEY` in `src/lib/site.js`, secret `TURNSTILE_SECRET` on the `lc-events-intake` Worker). Invisible unless Cloudflare wants a box ticked. Every flyer upload and every submission carries a one-time token that the Worker verifies. `TURNSTILE_ENFORCE` in `wrangler.intake.jsonc`: `"1"` turns failures away, `"0"` only logs them. A new address for the site must be added to the widget's domain list in Cloudflare (Turnstile), or the check fails there.
- **Sitemap:** `https://events.livelovelascruces.com/sitemap-index.xml` (made by `@astrojs/sitemap`), listed in `public/robots.txt`. The old WordPress address `/sitemap_index.xml` and `/sitemap.xml` redirect to it (Nov 23, 2026).
- **Search engines and link previews (Nov 23, 2026):** Cloudflare's zone-wide "Block AI training crawlers" setting was also blocking Googlebot, Bingbot and Facebook's link-preview bot (403s; Search Console couldn't read the sitemap). Fix, with Charlie's OK: a custom WAF rule, first in the list, "Let verified search engines and link previews through": `cf.verified_bot_category in {"Search Engine Crawler" "Page Preview"}` skips the managed and bot-fight phases. AI training bots stay blocked; the country block still applies after it. If Google or Facebook previews break again, check Security > Events for "Block AI training crawlers".
- **Old CitySpark event links (Nov 24, 2026):** `/#/details/<name>/<id>/<date>`, used all over past newsletters. The part after `#` never reaches the server, so `_redirects` and Cloudflare rules can't see it. A small script in `Layout.astro` finds the event by name in `/search.json` and forwards to its page: the same date if still coming up, else the next date. CitySpark's number in the link isn't in our data, so the name is the key. Names are compared without hyphens, so apostrophes spelled differently still match (CitySpark `songwriters-circle`, ours `songwriter-s-circle`; found by GrokBot's test of 79 old links). No match, an error, or no answer in 5 seconds: the calendar with a friendly "that event already happened" note (`?old=1`, `old-link-note` in `index.astro`), searched for the name only when an upcoming event's title has all its words.
- **Old addresses:** `public/_redirects`. `/add-event/` goes to `/submit/`. `/blog/` goes to livelovelascruces.com for now (temporary redirect until Charlie decides where the old blog lives).

## Page weight

- The homepage holds the first 7 days of listings and category pages the first 14 (`HOME_DAYS`, `CATEGORY_DAYS` in `src/lib/site.js`). Later days live in page fragments at `/more/home/` and `/more/<category>/` and are fetched the first time a visitor needs them: Show the rest, a category, a search or venue, or a date past those days. Search, filters and shared links behave exactly as before.
- When changing `Agenda.astro`, test both halves: the plain first view, and each filter after the rest has loaded.
- The first four pictures in the list load right away; the rest load as they're scrolled to. Every picture has a width and height.
- `/calendar.ics` carries the next 60 days.
- **Topic photos (Nov 15, 2026):** an event with no picture of its own shows a stock photo of its topic (pickleball, yoga, farmers market…) instead of the drawn artwork, like CitySpark did. One photo per topic in `src/data/topic-photos.json`, all from Pexels (free to use, no credit needed). The build makes our own small copies like any event picture; if a photo can't be fetched, that event keeps the drawn artwork. To change a photo, replace its Pexels number in that file. Topics are matched in `src/lib/topics.js`.
- **Thumbnails:** each build makes small copies of every event picture in three widths (`src/lib/thumbs.js`, served from `/thumbs/`). Lists use the small ones, event pages a 1200px one; tapping a flyer still opens the full-size original. A picture that can't be fetched or read keeps its original address, so nothing can break a build. A picture that no longer exists (404) is dropped and the event shows our artwork instead of a broken image. Skipped in offline builds and `astro dev`; `EVENTS_THUMBS=0` turns it off. Uses `sharp` (added to `package.json` with Charlie's OK, Nov 14).

## Event pages

- **You might also like:** up to 4 events in the next 3 weeks that share the venue or category, one-offs with a picture first, each event once. Links to "More at <venue>" (the calendar filtered to that venue) and the category page.
- **Duplicates:** two listings are one event only when the name and day match and nothing says they're in different places. Same name at two different venues stays as two events. If one event shows twice because its venue is spelled two ways, add the spelling to `src/data/venues.json`.
- **Exhibits and long daily runs** ("On now") have an address without a date (`/event/lean-in/`) for the whole run. In the last days, when the run goes back to one listing per day, that address forwards to the next date.
- Later: **While you're nearby** (local businesses near the venue) once the Business Directory exists.
- Venue names come from `src/data/venues.json` via `src/lib/venues.js`. A room ("Munson Senior Center > Studio 2", "Boardroom at …") is kept next to the venue name, not as a separate venue.

## Venue pages

Built Nov 14, 2026.

- `/venue/<key>/` for every venue on the master list (`src/data/venues.json`) and every venue with something on the calendar: name, address, Directions, "Add an event here" (opens the form with the venue and address filled in) and everything coming up there. `/venues/` lists them all, busiest first. Linked from the footer, from "Where" and "More at" on event pages.
- The list comes from `getVenues()` in `src/lib/events.js`, which also feeds the venue suggestions on the form.
- **Addresses:** the one Charlie saved on the Venues screen; otherwise the one the venue is most often listed with right now. An event that arrives with no address gets its venue's saved address.
- "Las Cruces, NM" and other non-venues don't get a page.
- **Venues screen (built Nov 14, 2026):** https://lc-events-intake.cf2-99b.workers.dev/review/venues/ (Charlie only, linked from the review page). Add a venue, rename one, set its address, website and a short description, and list its other spellings under "Also known as". Venues that are on the calendar but not on the list yet show at the top ("From the feeds"), busiest first.
  - To join two spellings of one place: open the one to keep and add the other spelling under "Also known as".
  - Saving does not rebuild the site. Changes go live with the nightly rebuild, or with **Publish changes now** on that screen.
  - A renamed venue keeps its old name as a spelling, and its old page address forwards to the new one.
  - How it's stored: the edits live with the submissions Worker (KV `venues/edits.json`, public copy at `/venues.json`). The build merges them over `src/data/venues.json` with `src/lib/venue-merge.js` (shared by the Worker and the site). The build stops if the edits can't be read, like approved submissions. "Undo my changes" puts a built-in venue back to how `venues.json` has it.
  - Room rules ("Boardroom at…", "City Hall Room…") and search keywords are still edited in `src/data/venues.json`.
  - The site publishes its venue list at `/venues.json` for that screen.

## Spotlight (paid promotion, $50)

Decided by Charlie, Nov 10, 2026. Modeled on SFV Local's "Boosted Event". "Charlie's picks" is gone: Charlie doesn't want his name on it.

- **What the buyer gets:** pinned to the top of its day on the calendar with a **Sponsored** label, rotation through the homepage **Spotlight** section, and one newsletter mention before the event (Charlie adds that by hand).
- **Buying it:** the last step of `/submit/` offers Free or Spotlight. `/submit/?spotlight=1` pre-selects Spotlight (used by the homepage box and the "Spotlight it" link on every event page). After sending, the buyer gets a Pay button: `SPOTLIGHT.payUrl` in `src/lib/site.js` (Charlie's Stripe Payment Link) with `client_reference_id` = the submission id and the email pre-filled, so the payment can be matched in Stripe. If `payUrl` is empty, the page says Charlie will email a payment link.
- **Stripe (set up Nov 23, 2026, through the Stripe connector):** product "Calendar Spotlight" (`prod_VgKnakZPjSBPRT`, $50) and Payment Link https://buy.stripe.com/4gMbJ1dSdbYk4Rw0Y1dEs00 (`plink_1Uey83DfkI8YLMjH76kcMphA`, promotion codes allowed). After paying, buyers land on `/submit/?spotlight=paid`, which shows a thank-you note. Charlie's account also holds his newsletter ad products; don't change those.
- **Review page:** Spotlight requests are flagged with the reference to look for in Stripe, and Sponsored is pre-ticked. Checkboxes: **Spotlight** (free pick), **Sponsored (paid)**, and **until** (last day; empty = the event's last date). Already-approved events can be switched on or off from "Recently approved".
- **Homepage section:** only events marked Spotlight or Sponsored, never filled automatically and never CitySpark's old picks. Three at random on each visit, Sponsored first. Nothing marked: a "Your event could be right here" box selling Spotlight.
- Sponsored events always get a full card (even if they repeat) and are first in their day.
- Later (Charlie): longer-running packages.

## Featured events

Built Nov 23, 2026. Charlie's own picks, free for now; he plans to sell Featured as an upgrade later.

- **Review page, "Featured events":** paste any event's address (any source: feeds, CitySpark, the newsletter check, submissions), tick "Every date of it" if wanted, and an optional **until** date (empty = until the event is over). "Stop featuring" undoes it. Saving starts a rebuild. Stored in KV `featured.json` (same matching as Hidden listings, plus `until`), sent to the build inside `/approved.json` (`featured`).
- Submissions can still be featured with the **Featured** checkbox when approving (it was called Spotlight before Nov 23; same `featured` flag).
- **What a Featured event gets:** a full card (even a weekly regular), pinned to the top of its day after any Sponsored ones, a gold star on the corner of its picture (on homepage cards, just right of the date, so it doesn't cover the category label), a navy **★ FEATURED** label and its own soft navy background (`--_featured-bg` in `EventCard.astro`; Charlie turned down red on Nov 23). Reads differently from paid gold and the green regulars, the label on its event page, and a place in the homepage Spotlight rotation.
- An event both Featured and Sponsored shows as Sponsored only.
- **Sponsored (paid) for any event (Nov 24, 2026):** the Featured events box has a **Sponsored (paid)** tick, so a paid Spotlight works for feed and CitySpark listings too (stored as `sponsored: true` on the pick in `featured.json`). `src/data/spotlight.json` is no longer needed for that.

## Admin bar on event pages

Built Nov 24, 2026 (Charlie: admin controls while viewing an event).

- **Turn it on:** visit any page with `?admin=on` (for example `https://events.livelovelascruces.com/?admin=on`). It stays on for that device and browser (localStorage `lc-admin`). `?admin=off` turns it off. Visitors never see it.
- **What it shows:** a slim strip above the breadcrumb on every event page with the event's status (Featured / Sponsored, until when) and buttons: ★ Feature (or Stop featuring), Sponsored (paid), Edit and Hide listing (feed events) or Edit or remove (events from the form), Hide picture (when it has one), Review page. "Every date" appears on repeating events.
- **How it works:** each button opens the review page in a new tab with `?act=…&slug=…&title=…` (plus `all=1`), which fills in the right box and points at it. Nothing is saved until Charlie taps that box's button. The review page stays behind the Cloudflare Access login, so the bar is only shortcuts: on someone else's device it does nothing they can use.
- The fill-in code is at the end of the review page script in `intake.js` (it only goes live when `intake.js` reaches `main`). The bar is in `src/pages/event/[slug].astro`, the switch in `Layout.astro`.
- "Edit or remove" finds the event under Recently approved (the last 60).

## Bigger list for older readers

Nov 23, 2026 (Charlie: most subscribers are seniors). Row pictures 8rem on desktop and 6rem on phones (were 4.75rem and 4.5rem), event names 1.3rem, time and venue line, summary and price at `--text-m`, summary up to two lines, tags at `--text-s`. The list is up to 52rem wide. On phones the time sits on its own line above the venue.

## Recurring events

Built Nov 14, 2026. One set of rules, `src/lib/repeat.js`, is used by the form, the submissions Worker and the site build, so a rule means the same thing everywhere. No extra library: the calendar works in plain Las Cruces dates, so daylight saving time can't shift a repeating date.

- **The form (`/submit/`):** "This repeats (weekly or monthly)" under the date row. The date row becomes the first date and sets the times. Choices: weekly or monthly, every 1 to 4, weekdays (weekly), "the 3rd Tuesday" or "the 17th" (monthly), an optional end date. It shows the rule in words and the next dates; tapping a date takes it out.
- **Venue suggestions:** the Venue box on the form suggests names as you type, from the master list (`src/data/venues.json`) plus every venue on the calendar. Picking one fills in its address unless the submitter typed their own. Addresses come from current listings, so a venue with no upcoming events suggests its name only. To keep an address for good, a later job is to store addresses in `venues.json`.
- **The review page:** shows the rule in words and the next dates. Charlie can set when it stops and list dates to leave out.
- **Stored as one entry** in the approved list, carrying the rule. Its slug has no date.
- **The build** turns each rule into dated listings for the next 90 days (`REPEAT_DAYS` in `src/lib/site.js`); each nightly build moves the window on. Each date gets its own page (`/event/<slug>-<date>/`). They show as regulars with the rule's wording ("Every other Tuesday"), even with one or two dates in the window. An overnight event (10 PM to 1 AM) ends the next day.
- **Replacing a CitySpark regular:** enter it once as a repeating event. On every date both exist, ours wins and the CitySpark copy is dropped (same name, day and venue).
- **Hand-added events** in `src/data/events.json` can carry the same `repeat` object.
- **Annual events:** the form has "This is an annual event". It is saved with the event and shown on the review page. Nothing uses it yet.
- **Not built yet:** one permanent page per series; add-to-calendar that repeats (`rrule()` in `repeat.js` is ready for it); annual events staying up after they pass and coming back to the review queue next year; changing a rule after approval other than its end date and left-out dates (remove it and add it again).
- **Detected series still exist:** feeds without rules (CitySpark, city) are still grouped when the same title and venue appear 3+ times.

## Submissions and editing

- **Edit links (built Nov 14, 2026):** every submission gets a private link, `/submit/?edit=<key>`, shown on the thank-you screen with a Copy button. Whoever has the link can change that one event. Events sent from a device are also listed on that device under "Your events" at the top of `/submit/`.
  - Changing an event that's still waiting simply updates it.
  - Changing an event that's on the calendar puts the change in the review queue, marked "Changed by the organizer". The calendar keeps the earlier version until Charlie approves. Reject keeps the earlier version.
  - An organizer can't switch on Spotlight or change the contact email through an edit.
- **View links under Recently approved (Nov 24, 2026):** each approved event has a **View** link that opens it on the calendar in a new tab (no searching for it). One-off events open their event page; repeating events open a calendar search for their name, since each date has its own page. A just-approved event's page appears once the rebuild finishes (a few minutes). `viewLink()` in the review page script in `intake.js`.
- **Charlie editing an approved event:** "Edit" next to it under Recently approved on the review page. It reopens in the queue with every field editable; Approve replaces the live version, Reject leaves it as it was.
- **Emails (built Nov 14, 2026):** sent by the `lc-events-intake` Worker through Cloudflare Email Service (`EMAIL` binding in `wrangler.intake.jsonc`; livelovelascruces.com was already set up as a sending domain on Nov 7), from events@livelovelascruces.com. Replies go to `NOTIFY_TO`.
  - To the submitter: a thank-you with their private edit link as soon as they send an event, and a note when it goes on the calendar (or when a change they made is approved). No email when Charlie reopens and fixes an event himself, and none on Reject.
  - To Charlie (`NOTIFY_TO` in `wrangler.intake.jsonc`): every new submission and every organizer change, with a link to the review page.
  - The wording is in `mailThanks`, `mailApproved` and `mailCharlie` in `intake.js`. A failed send is logged and never blocks a submission.
  - Links in the emails and on the review page use `LIVE_SITE` in `intake.js` (events.livelovelascruces.com since Nov 23).
- **"Here's how it'll look" (Nov 23, 2026):** a live preview of the listing's calendar row just above Submit on `/submit/`, same sizes as the real row. It updates as the organizer types and shows their photo (or flyer). `renderPreview()` in `submit.astro`.
- The thank-you screen no longer says the best listings make the newsletter (Charlie, Nov 23).
- **Welcome note on `/submit/` (Nov 23, 2026):** says this is the new calendar, what's better about it, and asks for problems and ideas at events@livelovelascruces.com (delivers to charlie@ through Google Workspace). "Got it" hides it on that device (localStorage `lc-events-welcome-seen`). Take it out once the calendar is no longer new.
- **Pasting a description keeps its paragraphs (Nov 23, 2026):** text copied from Grok, ChatGPT, Google Docs or a web page often lost its line breaks in the plain text box. On paste, the form rebuilds paragraphs from the copied web version, turns list items into "• " lines and drops Markdown marks (`**bold**`, `#` headings). Plain text that already has line breaks is pasted as is. `pastedText()` in `submit.astro`. The box is 6 rows tall.
- **Trusted submitters (built Nov 23, 2026):** emails Charlie trusts. Their new events and their edit-link changes go on the calendar right away, without review.
  - Review page: **Trust this submitter** on every waiting event (with a "regular" nudge once Charlie has approved 2 or more of theirs), a **Trusted submitters** list with an add-by-email box and **Stop trusting**. Recently approved marks events that went live on their own; taking one down asks whether to stop trusting the sender too.
  - Safety rails: at most `TRUSTED_PER_DAY` (10) a day each, the rest wait in the queue; paid Spotlight requests and suggested edits to other people's listings always wait; the person check still runs.
  - Emails: a trusted submitter gets one "is live on the calendar" email (`mailLive`) instead of the thank-you plus approval pair; Charlie gets "Live from a trusted submitter" with a pointer to Recently approved. The thank-you screen says "It's live on the calendar!" with a link.
  - Stored in KV `trusted.json`; approval counts per email in `submitters.json`; daily counts in `trusted/count/<email>/<date>` (expire after 2 days). Emails never go into the public `/approved.json`.
  - CitySpark's copied listings don't say who submitted them, so the list starts empty (Charlie can add emails by hand).
- **Thank-you email and screen (Nov 23, 2026):** say first that the event isn't on the calendar until it's checked ("Got it! … is waiting for a quick review").
- **"Already on the calendar?" check (built Nov 24, 2026):** the form looks for the same event before anything is sent, so organizers don't add duplicates.
  - **When:** right after a flyer is read (before the form shows), and when someone who typed it in hits Submit. Not for edit links or suggested edits. If the check can't run (no index, slow network), the form just carries on.
  - **How it matches** (`src/lib/dupes.js`, against the site's `/search.json`): same day, a name that's close ("Jazz Night w/ Bob" = "Jazz Night with Bob"; a looser name counts when the venue is the same), and not at a clearly different venue (five bars can each have Trivia Night). Venue spellings from `venues.json` count.
  - **Same flyer file:** the Worker keeps a fingerprint of every flyer it reads (KV `flyerhash/<sha-256>`, the last 5 uploads of that file, kept 180 days). Uploading the exact same file as a listing that's on the calendar finds that listing even if the flyer reads differently.
  - **The organizer's choices:** "That's it, I'm all set" (nothing is sent; they get the link to share), "That's mine, update it" (opens the listing as a suggested edit; their flyer becomes its picture and the flyer's price, link and description fill in anything missing), or "No, mine's a different event" (sent as normal, marked for Charlie).
  - **Review page:** a marked submission shows "Possible duplicate of <listing>", with a "Same event: approve this and hide the other listing" box (works like a suggested edit) and a **Reject: already listed** button that sends the organizer a friendly email with the listing's link (`mailDuplicate`). A possible duplicate from a trusted submitter waits for review instead of going live. Charlie's email subject says "New event (possible duplicate)".
- **Not built yet:** one link per venue that lists all of its events.
- Feed events (CitySpark, city) can't be edited: they are copies and are overwritten nightly. To change one, enter it through the form; ours replaces the feed's copy.

## Header and navigation: match livelovelascruces.com

Charlie wants the calendar's header and navigation to match **livelovelascruces.com** (same or very close), so the calendar feels like part of the main LLLC site rather than a separate one. This applies to this site only. Las Cruces Live and the Art Trail keep their own headers for now.

The livelovelascruces.com header (checked Nov 8, 2026; re-check the live site before building, it may have changed):

- LLLC logo, linking to https://livelovelascruces.com/
- Tagline: "Free Local Newsletter · Since 2024"
- Links, in order: **Local Events** (https://livelovelascruces.com/local-events), **Live Music** (https://livelovelascruces.com/live-music), **Events Calendar** (this site, `/`), **Dinner Club** (https://livelovelascruces.dnnr.io/), **Subscribe** (https://livelovelascruces.com/subscribe)
- No search, social icons or login in the header

How to build it:

- Snapshot the livelovelascruces.com header into Paper as the starting point, and match its logo, order, labels, spacing and type. Use the real LLLC logo files; don't redraw them:
  - `public/lllc-logo-on-light.png` (black and red lettering, for light backgrounds)
  - `public/lllc-logo-on-dark.png` (white and red lettering, for dark backgrounds)
  - Both are 500 × 125 PNG with transparent backgrounds, the same files the Art Trail uses. Show them at 250px wide or less so they stay sharp on high-resolution screens, with `width`/`height` set and `alt="Live Love Las Cruces"`. If a sharper SVG version is ever needed, ask Charlie.
- Mark **Events Calendar** as the current page.
- The calendar's own links (This weekend, Live music, Browse) and the **Add your event** button move to a second row or bar under the main nav, so visitors still reach them in one tap. Design this in Paper and get approval.
- Mobile: a menu that works with keyboard and screen readers, tap targets 44px or larger.
- Consider matching the footer too (same link groups as livelovelascruces.com: Social, Information, Nav, Legal). Ask Charlie.
- Links to livelovelascruces.com should carry `utm_source=lc-events` only where they lead to a signup (Subscribe), not on every nav link.

**Old URLs to keep working:** livelovelascruces.com's footer links to `https://events.livelovelascruces.com/add-event/` and `https://events.livelovelascruces.com/blog/` (pages on the current WordPress calendar). Before this site takes the events domain, add redirects in `public/_redirects` (for example `/add-event/` to `/submit/`) and ask Charlie what happens to the blog.

## Brand

Currently shares the Art Trail design system (same tokens and fonts in `src/styles/global.css`: cream `#FAF9F5`, red `#B23A2B`, agave `#2F5D50`, night `#1F2A44`, Bricolage Grotesque + Inter). Each category has its own color and artwork (`src/lib/topics.js`).

**Decided by Charlie (Nov 8, 2026):** keep the Art Trail colors. Replace Inter with **Schibsted Grotesk** as the body font, as shown in the approved Paper design; Bricolage Grotesque stays for headlines. Inter remains in the code until the font change is built.

| Role | Current token | ACSS role (proposed) |
|---|---|---|
| Page background | `--bg` | `bg-light` |
| Text / muted | `--ink` / `--muted` | `text-dark` / `text-dark-muted` |
| Red | `--ev-accent` | **primary** |
| Agave | `--agave` | **secondary** |
| Night | `--night` | **base** / `bg-dark` |
| Radius | `--ev-radius` | `radius` |

Category colors stay as their own set (not ACSS roles), but must pass contrast checks.

## Moving to ACSS: checklist

This is the first site to move to ACSS: it's the test bed for the workflow. Separate pull requests, in order:

1. [x] **Rename colliding tokens:** `--accent` → `--ev-accent`, `--accent-dark` → `--ev-accent-dark`, `--accent-tint` → `--ev-accent-tint`, `--radius` → `--ev-radius`. No visual change. (`intake.js` keeps its own `--accent`: the Worker's admin page defines it separately and never loads ACSS.)
2. [x] Settle the brand decision above. Design the homepage (agenda view) in Paper, desktop and mobile, **with the livelovelascruces.com header** (see "Header and navigation"). Approve.
3. [x] Generate `acss/settings.json`. Run `scripts/acss-sync.sh`. Record the stylesheet size and anything learned in the shared docs. Result (ACSS 4.0.2): `automatic.css` is 59.8 KB, 9.8 KB gzipped.
4. [x] Add `reset.css`, ACSS and `acss-bridge.css` to `Layout.astro`, on the redesign branch first (it has its own preview). Load `automatic.css` only (see the note under "Loading the output" in `agent-docs/acss-workflow.md`). Result: body font is now Schibsted Grotesk. The site's CSS bundle went from 10 KB (2 KB gzipped) to 60 KB (10 KB gzipped), which step 6 measures. Share images still use Inter (`src/lib/og.js`), and `@fontsource-variable/inter` is now unused but still in `package.json`.
5. [x] Convert components one at a time: Agenda, EventRow, EventCard, Header, Footer. Footer was converted to ACSS tokens only, with no redesign. Still on the old look: the homepage hero (tagline, "Tonight" panel, stat line), On now, Weekly regulars, Browse by vibe and the newsletter band in `src/pages/index.astro`,. 
   - **Nov 14: every remaining page and component now uses ACSS tokens** (homepage sections, event page, submit, category, this weekend, 404, Newsletter, EventArt, Lightbox, Footer, PreviewBanner): no legacy tokens, logical properties, spacing and type from the ACSS scale. `global.css` only holds helpers ACSS doesn't provide; the legacy `:root` tokens, the old `.btn` set and the re-declared headings, links and body are gone. Page content now uses the design's 1296px width and lines up with the header.
   - **Nov 14: class names on those pages are BEM** (`event-detail__info`, `submit-form__field`, `signup__box`), with data attributes for variants and states (`data-variant`, `data-size="compact"`, `data-missing` on form fields that still need filling in). The helpers in `global.css` (`wrap`, `section`, `eyebrow`, `lede`, `grid`...) keep their short names on purpose.
   - **Still to do:** match the homepage sections listed above to the Paper design.
6. [ ] PageSpeed check against the targets in `agent-docs/astro.md` before merging to `main`.

**Buttons:** ACSS buttons only: `btn--primary` (main action), `btn--base` (dark), `btn--base btn--outline` (quiet), `btn--primary-light` (on red), plus `btn--s` for small. There is no `.btn` class any more. Neutral buttons are off. Base outline was turned on in `acss/settings.json` on Nov 14 and is in the generated `automatic.css` (synced Nov 14).

**Hidden inputs:** a page-level rule like `input { inline-size: 100% }` also hits visually hidden inputs (`.sr-only`) and makes the page scroll sideways. Write `input:not(.sr-only)`.

**Turned off in ACSS for this site:** the accent color and its buttons (no accent role in the design), transparency shades for accent, tertiary, danger, info, success and warning, the light/dark color scheme switcher, basic overlays, text-shadow variables, forms plus automatic form styling (so loading ACSS can't restyle `/submit/`), default section styles (they turn every top-level `<section>` into a flex column and break the existing `.wrap` layout; revisit in step 5) and automatic image rounding.

## Design process (Charlie, Nov 18, 2026)

- Charlie isn't using Paper. Show design ideas as a quick mockup in the chat, then build on the preview (`redesign` branch) for him to look at. Nothing goes to `main` until he approves it on the preview.
- When Charlie asks for ideas or "how would that work", lay out the plan and wait for his go-ahead before building.

## Event list and pictures (preview, Nov 18, 2026)

- **List rows lead with the event** (modeled on SFV Local): picture, name, then time and venue, one line about it (its summary or the first sentence of the description), category and genre, badges (Sponsored, Kids & family, Seniors) and the price on the right ("See details" when there's none). No time column.
- **Weekly regulars** are the same size as one-off events, set apart by a light tint and their "Every Thursday" tag. Still folded under "Show N more regulars" on each day.
- **No picture:** a name card (event name, venue, topic icon, date) on the category color. Stock topic photos are off: one photo per topic was often wrong for the event. Row thumbnails keep the icon artwork.
- **Tall, square or slightly wide pictures** (most flyers and logos, anything narrower than 8:5) show whole on a blurred copy of themselves; clearly wide ones fill the box (`whole` in `EventArt.astro`, was 1.3 until Nov 23).
- **Pictures too small to look sharp** (under 300 pixels on the longest side; CitySpark kept some at 49×28) are dropped at build time and the event shows its name card (`MIN_SIDE` in `src/lib/thumbs.js`, Nov 23). CitySpark has no bigger copies of those. The build log counts them. Event pages keep every picture beside the details (wide ones too); "Tap to enlarge" opens it centered, as large as the screen allows.
- **Pictures (Nov 23, 2026; replaced "flyer plus photo"):** an optional flyer plus up to 4 photos. The form's Pictures box shows each one with **Main picture** and **Remove**; the main picture (default: the first photo, else the flyer; the flyer can be picked) is the calendar and share picture. Edit links show the pictures already uploaded.
  - Stored on the submission as `imageId` (flyer, or the first picture when there's no flyer), `photoIds` (up to 4) and `main`. Older records with one `photoId` still work (`photosOf()` / `mainOf()` in `intake.js`).
  - The Worker sends the site `image` (main), `flyer` (when it isn't the main one) and `photos` (the rest), see `calendarPictures()`. The event page shows the flyer, then the main photo, then the other photos as tap-to-enlarge tiles (`event-detail__gallery`). Thumbnails are made for gallery photos too (`photoThumbs`).
  - The review page lists every picture and marks the main one.
  - Tiles on the form are made in the browser, so their styles use `:global()` (Astro's scoped styles don't reach them).
- **Hidden pictures:** review page box. A listing's picture that doesn't fit is replaced by its name card (one date or every date).

## Design status

- Homepage: **approved by Charlie, Nov 8, 2026.** Paper file "Las Cruces Events", artboards `home / desktop`, `home / mobile` and `home / mobile, menu open`. The mobile artboard is a shortened sample: the built page keeps every day and section shown on desktop.
- Footer: leave as it is for now. Charlie will decide later whether it should match livelovelascruces.com's link groups.
- Subscribe button: Charlie chose the bright LLLC red to match livelovelascruces.com (Nov 9, 2026), knowing its text contrast is about 4:1, under the 4.5:1 target.

## Site-specific rules

- Never show an event that has ended. Today's events stay until they're over.
- Times are always America/Denver.
- Keep schema.org Event data, `.ics` feeds and Google Calendar links working on every event page.
- Weekly regulars and city meetings stay visually quieter than one-off events (except paid Spotlight events).
- Paid placements always carry a visible **Sponsored** label.
