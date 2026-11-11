import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: path.resolve(__dirname),
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});