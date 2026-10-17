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
    const problem = sweepSandbox(sandbox);
    if (problem) {
      process.exitCode = 1; // vitest logs a teardown throw but would still exit 0
      throw new Error(problem);
    }
  };
}

// Returns why the run must fail, or null if the sandbox was empty and is gone.
// The verdict never hinges on the removal succeeding: on Windows a leaked dir
// held open by a child process makes rm throw EPERM, and "couldn't check or
// clean" must not read as "clean".
export function sweepSandbox(sandbox: string, rm: (p: string) => void = removeDir): string | null {
  const problems: string[] = [];
  try {
    const left = readdirSync(sandbox);
    if (left.length) problems.push(`tests left ${left.length} temp entries behind: ${left.join(', ')}`);
  } catch (e) {
    problems.push(`could not list it: ${String(e)}`);
  }
  try {
    rm(sandbox);
  } catch (e) {
    problems.push(`could not remove it: ${String(e)}`);
  }
  return problems.length ? `temp sandbox ${sandbox}: ${problems.join('; ')}` : null;
}

function removeDir(p: string): void {
  rmSync(p, { recursive: true, force: true, maxRetries: 5 });
}
