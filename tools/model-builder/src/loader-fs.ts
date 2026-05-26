import fs from 'node:fs';
import path from 'node:path';
import { loadFromMap } from './loader-map.js';

function walkYamlFiles(directory: string): string[] {
  const results: string[] = [];
  const stack = [directory];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (/\.(yaml|yml)$/i.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

export function loadFromDirectory(blueprintDirectory: string) {
  const absoluteDir = path.resolve(blueprintDirectory);

  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) {
    throw new Error(`Blueprint directory not found: ${absoluteDir}`);
  }

  const yamlFiles = walkYamlFiles(absoluteDir);
  const fileMap = new Map<string, string>();

  for (const filePath of yamlFiles) {
    const relativePath = path.relative(absoluteDir, filePath).split(path.sep).join('/');
    const content = fs.readFileSync(filePath, 'utf8');
    fileMap.set(relativePath, content);
  }

  return loadFromMap(fileMap);
}
