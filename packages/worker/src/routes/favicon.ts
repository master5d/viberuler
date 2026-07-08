// Brand mark: dark tile, ruler ticks, V in the violet→green gradient.
// Served at /favicon.svg (and /favicon.ico for linkless visitors — modern
// browsers accept SVG there; legacy ones just show nothing, acceptable).
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#b388ff"/><stop offset="1" stop-color="#69f0ae"/>
</linearGradient></defs>
<rect width="64" height="64" rx="14" fill="#0b0e14"/>
<g stroke="#3a4152" stroke-width="3" stroke-linecap="round">
<line x1="8" y1="12" x2="18" y2="12"/>
<line x1="8" y1="25" x2="13" y2="25"/>
<line x1="8" y1="38" x2="18" y2="38"/>
<line x1="8" y1="51" x2="13" y2="51"/>
</g>
<path d="M27 13 L37 51 L47 13" stroke="url(#g)" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function handleFavicon(): Response {
  return new Response(FAVICON_SVG, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=604800, immutable',
    },
  });
}
