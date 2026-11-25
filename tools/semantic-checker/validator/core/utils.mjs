import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

export function walkFiles(dir, include) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (include(full)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

export function loadYaml(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return YAML.parse(raw);
}
