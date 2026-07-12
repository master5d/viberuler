/**
 * Build asciicast v2 files from the REAL captured output of the CLI, for `agg`
 * to render into the README gifs. This is the Windows path: vhs needs ttyd + a
 * headless browser and hangs there, and running the scan from WSL costs 615s
 * over the 9p mount versus 12s native.
 *
 * Nothing about the OUTPUT is fabricated — these are the unedited bytes the CLI
 * printed. The only thing authored here is the TIMING, and the vhs tape already
 * hid the scan wait behind Hide/Sleep, so the visible result is the same.
 *
 * Usage (from the repo root):
 *   FORCE_COLOR=1 node packages/cli/dist/bin.js --scan-dir <code-root> > assets/card.ansi
 *   FORCE_COLOR=1 node packages/cli/dist/bin.js audit                   > assets/audit.ansi
 *   node assets/gen-cast.mjs
 *   agg --renderer resvg --font-size 15 --line-height 1.35 \
 *       --idle-time-limit 3 --last-frame-duration 4 assets/demo.cast assets/demo.gif
 *
 * FORCE_COLOR matters: piped output is grey, and a grey card is a dead demo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.CAST_DIR ?? dirname(fileURLToPath(import.meta.url));
const card = readFileSync(`${DIR}/card.ansi`, 'utf8');
const audit = readFileSync(`${DIR}/audit.ansi`, 'utf8');

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Emoji occupy TWO terminal cells, not one. Counting them as one under-sizes the
// terminal and every card line wraps — which is exactly what happened first try.
const cells = (line) => {
  let n = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1f000 && cp <= 0x1faff) || // emoji blocks
      (cp >= 0x2600 && cp <= 0x27bf) ||   // misc symbols / dingbats
      (cp >= 0x1100 && cp <= 0x115f) ||   // hangul jamo
      cp === 0x2b50 || cp === 0x2705;
    n += wide ? 2 : 1;
  }
  return n;
};
const widthOf = (s) => Math.max(...strip(s).split('\n').map(cells));
const COLS = Math.max(widthOf(card), widthOf(audit)) + 4;
const ROWS = Math.max(strip(card).split('\n').length, strip(audit).split('\n').length) + 5;

const ev = [];
let t = 0;
const at = (dt, data) => {
  t += dt;
  ev.push([Number(t.toFixed(3)), 'o', data]);
};

const PROMPT = '\x1b[38;5;141m❯\x1b[0m ';
const CLEAR = '\x1b[2J\x1b[H';

// A raw terminal has no line discipline: "\n" moves DOWN but does not return to
// column 0. Feeding captured output straight in produces a staircase. Every line
// break must be a full CRLF.
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

function scene(cmd, output, { scanPause, hold }) {
  at(0.4, PROMPT);
  for (const ch of cmd) at(0.055, ch); // typing
  at(0.35, '\r\n');
  at(scanPause, ''); // the scan; the real one takes 26s / 12s
  at(0.05, crlf(output.endsWith('\n') ? output : output + '\n'));
  at(hold, '');
}

// Two casts, not one. A single terminal tall enough for the 55-line audit leaves
// the 25-line scorecard floating in half a screen of dead space.
function build(name, cmd, output, hold) {
  ev.length = 0;
  t = 0;
  at(0.3, CLEAR);
  scene(cmd, output, { scanPause: 1.6, hold });

  const rows = strip(output).split('\n').length + 3;
  const header = {
    version: 2,
    width: COLS,
    height: rows,
    timestamp: 1783900000,
    env: { SHELL: '/bin/bash', TERM: 'xterm-256color' },
  };
  const out = [JSON.stringify(header), ...ev.map((e) => JSON.stringify(e))].join('\n') + '\n';
  writeFileSync(`${DIR}/${name}.cast`, out);
  console.log(`${name}: cols=${COLS} rows=${rows} duration=${t.toFixed(1)}s`);
}

build('demo', 'npx viberuler --scan-dir C:\\telo', card, 6);
build('demo-audit', 'npx viberuler audit', audit, 8);
