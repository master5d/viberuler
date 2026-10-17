import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guard: the whole run gets a private temp root (TMPDIR/TEMP/TMP point into it,
// and test workers inherit that env). Anything a test leaves there — whatever
// its prefix, makeTmpDir or a raw mkdtemp — fails the run at teardown, and the
// sandbox is removed either way, so the real temp dir stays clean.
export default function setup(): () => void {
  const sandbox = mkdtempSync(join(tmpdir(), 'viberuler-test-'));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = sandbox;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const left = readdirSync(sandbox);
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
    if (left.length) {
      process.exitCode = 1; // vitest logs a teardown throw but would still exit 0
      throw new Error(`tests left ${left.length} temp entries behind: ${left.join(', ')}`);
    }
  };
}
