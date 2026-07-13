// Bureau of Vibe Measurement — shared identity module.
// Pure strings/functions: no I/O, no request state, no worker-runtime imports.
// Consumed by the rendering surfaces (og image, share page, home page, etc.)

export const PALETTE = Object.freeze({
  base: '#0b0e14',
  surface: '#11151f',
  violet: '#b388ff',
  green: '#69f0ae',
  amber: '#ffd54f',
  stamp: '#ff5252',
  ivory: '#c9c2ad',
  hairline: '#2a2f3a',
  muted: '#8a8f9c',
});

export const GAUGE_CELLS = 16;

export const SCALE_LABELS = [
  'hello world',
  'a CRUD app',
  'a wrapper',
  'another wrapper',
  'an AI startup',
  'AGI (by accident)',
] as const;

// SOURCE OF TRUTH: packages/cli/src/score.ts RANK_TABLE. Keep in lockstep
// (guarded by brand.test.ts's boundary assertions).
const RANK_TABLE: Array<[number, string]> = [
  [8000, 'Singularity Adjacent'],
  [6500, 'GIGACHAD SHIPPER'],
  [5000, 'Ship Machine'],
  [3500, 'Context Goblin'],
  [2000, 'Token Burner'],
  [800, 'Vibe Apprentice'],
];

export function rankForVibe(vibe: number): string {
  for (const [min, name] of RANK_TABLE) if (vibe >= min) return name;
  return 'Prompt Peasant';
}

export const certifyLine = (rank: string): string => `The Bureau certifies: ${rank.toUpperCase()}`;

function gaugeFill(vibe: number): number {
  return Math.max(0, Math.min(GAUGE_CELLS, Math.round((vibe / 8000) * GAUGE_CELLS)));
}

/**
 * Full seal — reproduces design/drafts/seal-notary.svg ("Notary Stamp", chosen
 * 2026-07-09). Internal coordinate system stays 0 0 200 200; width/height are
 * parameterized to `size`.
 */
function fullSealSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bureau of Vibe Measurement seal">
  <defs>
    <linearGradient id="vrg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PALETTE.violet}"/><stop offset="1" stop-color="${PALETTE.green}"/>
    </linearGradient>
    <path id="ring" d="M30,100 A70,70 0 0 1 170,100" fill="none"/>
  </defs>
  <circle cx="100" cy="100" r="97" fill="${PALETTE.base}"/>
  <circle cx="100" cy="100" r="95" fill="none" stroke="${PALETTE.violet}" stroke-width="2"/>
  <circle cx="100" cy="100" r="86" fill="none" stroke="${PALETTE.hairline}" stroke-width="1"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="${PALETTE.amber}" stroke-width="5" stroke-dasharray="1 8" opacity="0.55"/>
  <text font-family="ui-monospace,monospace" font-size="12.5" letter-spacing="1.5" fill="${PALETTE.ivory}">
    <textPath href="#ring" startOffset="50%" text-anchor="middle">BUREAU OF VIBE MEASUREMENT</textPath>
  </text>
  <text x="100" y="118" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="58" fill="url(#vrg)">VR</text>
  <g stroke="${PALETTE.green}" stroke-width="2" opacity="0.8">
    <line x1="72" y1="132" x2="128" y2="132"/>
    <line x1="72" y1="132" x2="72" y2="127"/><line x1="86" y1="132" x2="86" y2="129"/>
    <line x1="100" y1="132" x2="100" y2="127"/><line x1="114" y1="132" x2="114" y2="129"/>
    <line x1="128" y1="132" x2="128" y2="127"/>
  </g>
  <text x="100" y="158" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" letter-spacing="2" fill="${PALETTE.amber}">CERTIFIED &#183; 2026</text>
</svg>`;
}

/**
 * Favicon-legible mark: dark disc, violet outer ring, amber dashed tick
 * bezel, bold gradient VR. No ring text, no <textPath> (illegible at small
 * sizes / unsupported in some favicon renderers).
 */
function favSealSvg(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bureau of Vibe Measurement mark">
  <defs>
    <linearGradient id="vrg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PALETTE.violet}"/><stop offset="1" stop-color="${PALETTE.green}"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="97" fill="${PALETTE.base}"/>
  <circle cx="100" cy="100" r="95" fill="none" stroke="${PALETTE.violet}" stroke-width="4"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="${PALETTE.amber}" stroke-width="6" stroke-dasharray="1 8" opacity="0.55"/>
  <text x="100" y="128" text-anchor="middle" font-family="ui-monospace,monospace" font-weight="700" font-size="84" fill="url(#vrg)">VR</text>
</svg>`;
}

export function SEAL_SVG(size: number, opts?: { ring?: boolean }): string {
  const ring = opts?.ring ?? true;
  return ring ? fullSealSvg(size) : favSealSvg(size);
}

export function guillocheCss(): string {
  return `.paper {
  background-color: ${PALETTE.base};
  background-image:
    repeating-linear-gradient(45deg, ${PALETTE.hairline} 0px, ${PALETTE.hairline} 1px, transparent 1px, transparent 12px),
    repeating-linear-gradient(-45deg, ${PALETTE.hairline} 0px, ${PALETTE.hairline} 1px, transparent 1px, transparent 12px);
  background-size: 24px 24px;
}`;
}

export function gaugeHtml(vibe: number, opts?: { sus?: boolean; compact?: boolean }): string {
  const sus = opts?.sus ?? false;
  const compact = opts?.compact ?? false;
  // Fixed-width raster surfaces (OG image) can't fit all six labels without
  // collision; compact keeps the escalation joke's endpoints + midpoint.
  const labels = compact
    ? [SCALE_LABELS[0], SCALE_LABELS[2], SCALE_LABELS[5]]
    : SCALE_LABELS;

  const cells: string[] = [];
  const fillCount = sus ? 0 : gaugeFill(vibe);
  for (let i = 0; i < GAUGE_CELLS; i++) {
    const isFill = !sus && i < fillCount;
    const bg = isFill
      ? `linear-gradient(90deg, ${PALETTE.violet}, ${PALETTE.green})`
      : PALETTE.surface;
    // The class is inert in the OG image — satori ignores classes and honours only
    // the inline style, which must stay in explicit px. It exists so the HTML page
    // can shrink the gauge on a phone without touching the raster render.
    cells.push(
      `<div class="gcell"${isFill ? ' data-cell="fill"' : ''} style="display:flex;width:20px;height:20px;margin-right:4px;background:${bg};border:1px solid ${PALETTE.hairline};"></div>`,
    );
  }

  const track = `<div style="display:flex;flex-direction:row;align-items:center;">${cells.join('')}</div>`;

  const scoreOrBand = sus
    ? `<div style="display:flex;align-items:center;justify-content:center;padding:8px 16px;color:${PALETTE.stamp};font-family:ui-monospace,monospace;font-weight:700;">— UNDER REVIEW —</div>`
    : `<div style="display:flex;align-items:center;justify-content:flex-end;padding-left:16px;color:${PALETTE.ivory};font-family:ui-monospace,monospace;font-weight:700;font-size:32px;">${Math.round(vibe).toLocaleString('en-US')}</div>`;

  const scaleRow = `<div class="gscale" style="display:flex;flex-direction:row;justify-content:space-between;width:400px;">${labels
    .map(
      (label) =>
        `<div class="glabel" style="display:flex;color:${PALETTE.muted};font-family:ui-monospace,monospace;font-size:10px;">${label}</div>`,
    )
    .join('')}</div>`;

  return `<div class="ggrid" style="display:flex;flex-direction:column;">
  <div class="gtrack" style="display:flex;flex-direction:row;align-items:center;">
    ${track}
    ${scoreOrBand}
  </div>
  ${scaleRow}
</div>`;
}
