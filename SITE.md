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
| `src/data/events.json` | Events we add ourselves | **Yes** (`featured: true` = Charlie's picks; `sample: true` = preview only) |
| `src/data/city-snapshot.json` | Offline copy of the city feed | No |

- Offline build: `EVENTS_OFFLINE=1 npm run build`.
- If the city feed can't be reached, the build stops on purpose. Keep that guard.
- `CITYSPARK_SUBSCRIBED` in `src/lib/site.js` switches CitySpark placeholder images to our artwork when the subscription ends.

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

**Open decision for Charlie:** keep the Art Trail look, or give the calendar its own palette in Paper so it feels like a sibling rather than a copy? Also the same Inter question as the Art Trail.

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
2. [ ] Settle the brand decision above. Design the homepage (agenda view) in Paper, desktop and mobile, **with the livelovelascruces.com header** (see "Header and navigation"). Approve.
3. [ ] Generate `acss/settings.json`. Run `scripts/acss-sync.sh`. Record the stylesheet size and anything learned in the shared docs.
4. [ ] Add `reset.css`, ACSS and `acss-bridge.css` to `Layout.astro`, on the redesign branch first (it has its own preview).
5. [ ] Convert components one at a time: Agenda, EventRow, EventCard, Header, Footer.
6. [ ] PageSpeed check against the targets in `agent-docs/astro.md` before merging to `main`.

## Design status

- Homepage: not started in Paper.

## Site-specific rules

- Never show an event that has ended. Today's events stay until they're over.
- Times are always America/Denver.
- Keep schema.org Event data, `.ics` feeds and Google Calendar links working on every event page.
- Weekly regulars and city meetings stay visually quieter than one-off events.
