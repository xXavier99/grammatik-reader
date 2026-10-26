/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the build works from any GitHub Pages sub-path (/<repo>/).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
