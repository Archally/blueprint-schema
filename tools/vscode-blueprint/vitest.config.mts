import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const validator = ['../../../schemas/blueprint/.shared/validator', '../validator/src']
  .map(candidate => fileURLToPath(new URL(candidate, import.meta.url)))
  .find(candidate => existsSync(candidate));
export default defineConfig({
  resolve: { alias: { '@archally-blueprint-validator': validator! } },
  test: { include: ['src/diagnostic*.test.ts', 'src/packaging.test.ts'] },
});
