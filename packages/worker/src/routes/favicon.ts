import { SEAL_SVG } from '../brand.js';

// Bureau of Vibe Measurement notary seal, favicon-optimized (no ring text).
// Served at /favicon.svg (and /favicon.ico for linkless visitors — modern
// browsers accept SVG there; legacy ones just show nothing, acceptable).

export function handleFavicon(): Response {
  const svg = SEAL_SVG(64, { ring: false });
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=604800, immutable',
    },
  });
}
