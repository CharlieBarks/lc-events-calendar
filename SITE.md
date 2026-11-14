# Las Cruces Events

Site-specific rules. The shared rules are in [AGENTS.md](AGENTS.md). Read the `README.md` too: it's the operations manual (feeds, Workers, images, CitySpark).

## What it is

The Live Love Las Cruces events calendar, replacing CitySpark at events.livelovelascruces.com. The place locals and visitors check for what's happening today, this weekend and this week.

- Live site (main branch): https://lc-events-calendar.cf2-99b.workers.dev (Worker `lc-events-calendar`)
- Design preview (redesign branch, noindex): https://lc-events-preview.cf2-99b.workers.dev (Worker `lc-events-preview`)
- Other Workers: `cityspark-export` (daily CitySpark copy, then rebuild), `lc-events-proxy` (City of Las Cruces feed)

## Data

| Data | Source | Edit by hand? |
|---|---|---|
| CitySpark listings and photos | `cityspark-export` Worker into KV, daily | No |
| City of Las Cruces events | City feed through `lc-events-proxy` | No |
| `src/data/events.json` | Events we add ourselves | **Yes** (`featured: true` = Spotlight; `sponsored: true` = paid Spotlight; `sample: true` = preview only) |
| `src/data/spotlight.json` | Spotlight for events that didn't come through the form (CitySpark, city), matched by name | **Yes** |
| `src/data/city-snapshot.json` | Offline copy of the city feed | No |
| `src/data/venues.json` | Master venue list: one name per venue, every other spelling as an alias | **Yes** (add a spelling whenever a new one turns up) |

- Offline build: `EVENTS_OFFLINE=1 npm run build`.
- The build stops on purpose if the CitySpark copy or the submissions can't be read, or if no source has any upcoming event. The city feed is optional. Keep those guards.
- Daily rebuild: the `lc-events-intake` Worker's schedule (`wrangler.intake.jsonc`, 12:10 AM Las Cruces time), not CitySpark.
- Cancelling CitySpark: set `FROZEN` = `1` on the `cityspark-export` Worker **first** (see README), then `CITYSPARK_SUBSCRIBED = false`.
- `cityspark-export` and `lc-events-proxy` are not deployed from this repo automatically. After changing `cityspark-export.js` or `worker.js`, the Worker has to be deployed by hand.
- `CITYSPARK_SUBSCRIBED` in `src/lib/site.js` switches CitySpark placeholder images to our artwork when the subscription ends.

## Search

- One search box at the top of the calendar's filters (homepage and category pages). It narrows the same day-by-day list and works together with the date and category filters.
- Index: `/search.json`, built with the site (title, venue, venue aliases and keywords, category, tags, short description). The browser only downloads it, plus the MiniSearch library, when someone starts typing.
- Typing suggests **venues** (picking one filters to that venue: `?venue=rio-grande-winery`) and **events** (opens the event page).
- Searches are shareable links: `/?q=trivia&when=week`.
- **Picking a category clears the search and venue** and shows the whole category (Charlie's call, Nov 10). Date buttons still combine with a search.
- Categories wrap onto extra lines on desktop (no sideways scrolling). On phones (560px and narrower) a "All categories" dropdown replaces the category buttons.
- **While searching** (a search or a venue filter is on), regulars and city meetings open up into full cards like one-off events. The normal view keeps them as slim rows, each with a small picture (flyer, photo or topic art). Approved by Charlie, Nov 10.

## Event pages

- **You might also like:** up to 4 events in the next 3 weeks that share the venue or category, one-offs with a picture first, each event once. Links to "More at <venue>" (the calendar filtered to that venue) and the category page.
- **Duplicates:** two listings are one event only when the name and day match and nothing says they're in different places. Same name at two different venues stays as two events. If one event shows twice because its venue is spelled two ways, add the spelling to `src/data/venues.json`.
- **Exhibits and long daily runs** ("On now") have an address without a date (`/event/lean-in/`) for the whole run. In the last days, when the run goes back to one listing per day, that address forwards to the next date.
- Later: **While you're nearby** (local businesses near the venue) once the Business Directory exists.
- Venue names come from `src/data/venues.json` via `src/lib/venues.js`. A room ("Munson Senior Center > Studio 2", "Boardroom at …") is kept next to the venue name, not as a separate venue.

## Spotlight (paid promotion, $50)

Decided by Charlie, Nov 10, 2026. Modeled on SFV Local's "Boosted Event". "Charlie's picks" is gone: Charlie doesn't want his name on it.

- **What the buyer gets:** pinned to the top of its day on the calendar with a **Sponsored** label, rotation through the homepage **Spotlight** section, and one newsletter mention before the event (Charlie adds that by hand).
- **Buying it:** the last step of `/submit/` offers Free or Spotlight. `/submit/?spotlight=1` pre-selects Spotlight (used by the homepage box and the "Spotlight it" link on every event page). After sending, the buyer gets a Pay button: `SPOTLIGHT.payUrl` in `src/lib/site.js` (Charlie's Stripe Payment Link) with `client_reference_id` = the submission id and the email pre-filled, so the payment can be matched in Stripe. If `payUrl` is empty, the page says Charlie will email a payment link.
- **Review page:** Spotlight requests are flagged with the reference to look for in Stripe, and Sponsored is pre-ticked. Checkboxes: **Spotlight** (free pick), **Sponsored (paid)**, and **until** (last day; empty = the event's last date). Already-approved events can be switched on or off from "Recently approved".
- **Homepage section:** only events marked Spotlight or Sponsored, never filled automatically and never CitySpark's old picks. Three at random on each visit, Sponsored first. Nothing marked: a "Your event could be right here" box selling Spotlight.
- Sponsored events always get a full card (even if they repeat) and are first in their day.
- Later (Charlie): longer-running packages.

## Recurring events

Charlie wants real recurring-event support. What exists today and what's planned:

- **Today:** `src/lib/events.js` *detects* series in the feeds (same title and venue 3+ times) and shows them as compact rows.
- **Planned:** events added by us or by organizers can carry a repeat rule (weekly / every other week / monthly by weekday or date, until date, skip dates). The build expands the rule into dates for the next 60 to 90 days using the `rrule` library (ask before adding the dependency). Dates are calculated in America/Denver so daylight saving time doesn't shift them.
- One page per series (evergreen, better for SEO) that lists upcoming dates. Add-to-calendar links and `.ics` keep the repeat rule.
- A one-off change ("moved to 8pm this week") is a skip date on the series plus a single replacement event.

## Submissions (planned)

`/submit/` will feed an approval queue using the same system as the Art Trail: private edit links, Review queue, Trusted Editors. Difference: a venue's edit link opens **its own list of events** (add, change, set up a series) instead of a single listing. Trusted venues' events publish directly; new ones wait for Charlie.

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
   - **Still to do:** rename the class names on those pages to BEM (they are still short names like `.detail`, `.info`, `.box`), and match the homepage sections listed above to the Paper design.
6. [ ] PageSpeed check against the targets in `agent-docs/astro.md` before merging to `main`.

**Buttons:** ACSS buttons only: `btn--primary` (main action), `btn--base` (dark), `btn--base btn--outline` (quiet), `btn--primary-light` (on red), plus `btn--s` for small. There is no `.btn` class any more. Neutral buttons are off. Base outline was turned on in `acss/settings.json` on Nov 14; until `scripts/acss-sync.sh` is run, `acss-bridge.css` carries a copy of that one rule. After the sync, delete it from the bridge.

**Hidden inputs:** a page-level rule like `input { inline-size: 100% }` also hits visually hidden inputs (`.sr-only`) and makes the page scroll sideways. Write `input:not(.sr-only)`.

**Turned off in ACSS for this site:** the accent color and its buttons (no accent role in the design), transparency shades for accent, tertiary, danger, info, success and warning, the light/dark color scheme switcher, basic overlays, text-shadow variables, forms plus automatic form styling (so loading ACSS can't restyle `/submit/`), default section styles (they turn every top-level `<section>` into a flex column and break the existing `.wrap` layout; revisit in step 5) and automatic image rounding.

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
