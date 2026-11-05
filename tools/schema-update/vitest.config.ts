import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    root,
    include: ['src/**/*.test.ts'],
    env: {
      BLUEPRINT_TEST_SCHEMA_ROOT: path.resolve(root, '../../schema/v2.8'),
      BLUEPRINT_TEST_VALIDATOR: path.resolve(root, '../validator/src/cli.mjs'),
    },
  },
});
