import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sweepSandbox } from './setup/tmp-sandbox.js';
import { makeTmpDir } from './helpers/tmp.js';

describe('sweepSandbox', () => {
  it('passes and removes an empty sandbox', async () => {
    const sb = await makeTmpDir('vibe-sb-empty-');
    expect(sweepSandbox(sb)).toBeNull();
    expect(existsSync(sb)).toBe(false);
  });

  it('fails on leftovers and still removes them', async () => {
    const sb = await makeTmpDir('vibe-sb-leak-');
    mkdirSync(join(sb, 'leaked-dir'));
    const problem = sweepSandbox(sb);
    expect(problem).toContain('1 temp entries behind: leaked-dir');
    expect(problem).toContain(sb);
    expect(existsSync(sb)).toBe(false);
  });

  // Stands in for Windows EPERM on a dir a child process still holds; chmod
  // can't reproduce it on Linux when the suite runs as root.
  it('fails when removal throws, even if nothing was listed', async () => {
    const sb = await makeTmpDir('vibe-sb-busy-');
    const problem = sweepSandbox(sb, () => {
      throw Object.assign(new Error('EPERM: operation not permitted, rmdir'), { code: 'EPERM' });
    });
    expect(problem).toContain('could not remove it');
    expect(problem).toContain('EPERM');
    expect(problem).toContain(sb);
  });

  it('reports leftovers and the removal error together', async () => {
    const sb = await makeTmpDir('vibe-sb-both-');
    mkdirSync(join(sb, 'held'));
    const problem = sweepSandbox(sb, () => { throw new Error('EBUSY'); });
    expect(problem).toMatch(/behind: held; could not remove it: Error: EBUSY/);
  });
});
