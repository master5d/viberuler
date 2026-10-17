import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { makeTmpDir, cleanupTmpDirs } from './helpers/tmp.js';

describe('makeTmpDir', () => {
  it('runs inside the per-run sandbox, not the bare system temp', () => {
    expect(basename(tmpdir())).toMatch(/^viberuler-test-/);
  });

  it('cleanupTmpDirs removes every dir it handed out, contents included', async () => {
    const a = await makeTmpDir('vibe-guard-a-');
    const b = await makeTmpDir('vibe-guard-b-');
    expect(dirname(a)).toBe(tmpdir());
    await mkdir(join(a, 'nested', 'deep'), { recursive: true });
    await writeFile(join(a, 'nested', 'deep', 'f.txt'), 'x');
    await cleanupTmpDirs();
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });
});
