// The small copies of event pictures made during the build: /thumbs/<id>-<width>.webp
// See src/lib/thumbs.js.
import { getEvents } from '../../lib/events.js';
import { thumbNames, thumbFile } from '../../lib/thumbs.js';

export async function getStaticPaths() {
  await getEvents(); // makes the thumbnails
  return thumbNames().map((name) => ({ params: { name } }));
}

export function GET({ params }) {
  return new Response(thumbFile(params.name), { headers: { 'Content-Type': 'image/webp' } });
}
