# Live Love Las Cruces Events Calendar

Astro starter for a fast, branded events calendar to replace CitySpark.

## Features in this starter
- Homepage with featured + upcoming event cards
- Dynamic `/event/[slug]` pages generated from data
- Beehiiv-matched styling (Bricolage Grotesque headings, dark header, clean system-ui body)
- Schema.org Event markup + basic SEO
- Click-to-enlarge lightbox on event images (listing cards and detail pages)
- Category and date filters
- Submission form at `/submit`
- Responsive grid and accessible foundations

## Local development
```bash
npm install
npm run dev
```

## Deploy to Cloudflare Pages
1. In Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
2. Select this repository.
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Add your custom domain (events.livelovelascruces.com) once the project is live.

## Next steps
- Wire real data feeds (city iCal Worker, Eventbrite, venue sites).
- Connect the submission form to an approval queue / D1.
- Add AI vision extraction for uploaded graphics.
- Stripe-powered featured slots.
