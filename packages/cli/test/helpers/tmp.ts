import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every temp dir a test makes goes through here, so none outlives its file:
// test/setup/tmp.ts removes them in afterAll. A dev box's %TEMP% had grown to
// hundreds of thousands of entries from suites that mkdtemp'd and walked away.
const created = new Set<string>();

export async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.add(dir);
  return dir;
}

export async function cleanupTmpDirs(): Promise<void> {
  const dirs = [...created];
  created.clear();
  // maxRetries: Windows holds git's pack files open for a beat after the spawn exits.
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5 })));
  const left = dirs.filter((d) => existsSync(d));
  if (left.length) throw new Error(`temp dirs survived cleanup: ${left.join(', ')}`);
}
