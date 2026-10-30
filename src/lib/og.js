// Builds the 1200x630 share images. Runs at build time only; nothing ships to visitors.
// Same recipe as the Art Trail: category color, Organ Mountains skyline, big Bricolage title.
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const W = 1200;
const H = 630;
const font = (pkg, file) => fs.readFileSync(path.resolve('node_modules', pkg, 'files', file));
const FONTS = [
  { name: 'Bricolage', data: font('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'), weight: 800, style: 'normal' },
  { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-500-normal.woff'), weight: 500, style: 'normal' },
  { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-600-normal.woff'), weight: 600, style: 'normal' },
];

const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const SKYLINE = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120" preserveAspectRatio="none" width="1200" height="230">
  <path d="M0 120 L0 92 L40 80 L70 88 L104 54 L122 66 L140 30 L152 44 L164 18 L176 40 L190 26 L204 52 L226 44 L250 70 L284 58 L320 82 L360 74 L400 90 L400 120 Z" fill="rgba(0,0,0,.2)"/>
  <path d="M0 120 L0 104 L60 98 L120 106 L200 96 L280 104 L340 98 L400 106 L400 120 Z" fill="rgba(0,0,0,.16)"/>
</svg>`);
const HEART = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40"><path fill="#FF0A06" d="M12 21.6 10.6 20.3C5.4 15.6 2 12.5 2 8.7 2 5.6 4.4 3.2 7.5 3.2c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 3.1 0 5.5 2.4 5.5 5.5 0 3.8-3.4 6.9-8.6 11.6L12 21.6Z"/></svg>`);

const h = (type, style, ...children) => ({ type, props: { style, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) } });
const img = (src, style) => ({ type: 'img', props: { src, style } });

export async function renderShareImage({ label, title, subtitle, color = '#B23A2B', icon }) {
  const titleSize = title.length > 48 ? 58 : title.length > 30 ? 70 : 88;
  const iconUri = icon && svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="300" height="300" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`);

  const tree = h('div', { width: W, height: H, display: 'flex', position: 'relative', backgroundColor: color, fontFamily: 'Inter', color: '#FFFFFF' },
    img(SKYLINE, { position: 'absolute', left: 0, bottom: 0, width: W, height: 230 }),
    iconUri && img(iconUri, { position: 'absolute', right: 70, top: 60, width: 300, height: 300 }),
    h('div', { display: 'flex', flexDirection: 'column', padding: '72px 80px 60px', width: W, height: H, boxSizing: 'border-box' },
      h('div', { display: 'flex' },
        h('div', { display: 'flex', backgroundColor: 'rgba(255,255,255,.94)', color: '#1C1B1A', fontWeight: 600, fontSize: 26, padding: '8px 20px', borderRadius: 999 }, label),
      ),
      h('div', { display: 'flex', fontFamily: 'Bricolage', fontWeight: 800, fontSize: titleSize, lineHeight: 1.04, letterSpacing: '-0.02em', marginTop: 34, width: 860 }, title),
      subtitle && h('div', { display: 'flex', fontSize: 30, fontWeight: 500, marginTop: 22, width: 900, opacity: 0.94, lineHeight: 1.3 }, subtitle.length > 110 ? subtitle.slice(0, 107) + '…' : subtitle),
      h('div', { display: 'flex', alignItems: 'center', marginTop: 'auto', fontFamily: 'Bricolage', fontWeight: 800, fontSize: 32 },
        img(HEART, { width: 40, height: 40, marginRight: 14 }),
        'Las Cruces Events · Live Love Las Cruces'),
    ),
  );

  const svg = await satori(tree, { width: W, height: H, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
