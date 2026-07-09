import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('package', () => {
  it('is named viberuler with a bin entry', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    );
    expect(pkg.name).toBe('viberuler');
    expect(pkg.bin.viberuler).toBe('dist/bin.js');
  });
});
