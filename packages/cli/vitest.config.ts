import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The git collector tests are real integration tests: each shells out to
    // `git` a dozen times, and spawning a process on Windows costs ~0.5s a go.
    // The 5s default fails them on a loaded machine — that is a flake, not a
    // defect, and a flaky suite is worse than a slow one.
    testTimeout: 30_000,
  },
});
