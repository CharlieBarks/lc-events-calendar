import { PREVIEW } from '../lib/site.js';
export function GET() {
  const body = PREVIEW
    ? 'User-agent: *\nDisallow: /\n'
    : 'User-agent: *\nAllow: /\n\nSitemap: https://events.livelovelascruces.com/sitemap-index.xml\n';
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
}
