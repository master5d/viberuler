import { describe, it, expect } from 'vitest';
import { shouldColor } from '../src/cli.js';

// Piped output is grey by default — correct, and the reason capture (demo
// recordings, CI logs) needs an override. These pin the precedence.
describe('shouldColor', () => {
  it('honours FORCE_COLOR when there is no TTY', () => {
    expect(shouldColor(false, { FORCE_COLOR: '1' })).toBe(true);
    expect(shouldColor(false, { FORCE_COLOR: '3' })).toBe(true);
  });

  it('treats FORCE_COLOR=0 as off, not as "set therefore on"', () => {
    expect(shouldColor(false, { FORCE_COLOR: '0' })).toBe(false);
  });

  it('lets NO_COLOR beat FORCE_COLOR — off always wins', () => {
    expect(shouldColor(false, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
  });

  it('lets --no-color beat everything', () => {
    expect(shouldColor(true, { FORCE_COLOR: '1' })).toBe(false);
  });

  it('falls back to the TTY check when neither env var is set', () => {
    // no TTY under vitest, so this is the piped case: grey
    expect(shouldColor(false, {})).toBe(Boolean(process.stdout.isTTY));
  });
});
