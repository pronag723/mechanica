import { defineConfig } from 'vitest/config';

// One Vitest run over every workspace package; each package keeps its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
