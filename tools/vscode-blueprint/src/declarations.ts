import { isMap, isScalar, isSeq, LineCounter, parseDocument, type YAMLMap } from 'yaml';

export interface Declaration {
  id: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
  origin: 'layer' | 'introduction' | 'metadata';
  name: string;
  title: string;
  kind: string;
  summary: string;
  status: string;
}

function stringField(mapping: YAMLMap, key: string): string {
  const value = mapping.get(key, true);
  return isScalar(value) && typeof value.value === 'string' ? value.value : '';
}

/** Parse nodes rather than text mentions, retaining the ID scalar's unquoted range. */
export function classifyDeclarations(file: string, text: string): Declaration[] {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter });
  if (document.errors.length) return [];
  const root = document.contents;
  const normalized = file.replace(/\\/g, '/');
  const migration = /(?:^|[/.])migrations?\.ya?ml$|\/\.migrations\//.test(normalized)
    || (isMap(root) && (root.has('migration') || root.has('change_set') || isMap(root.get('changes', true))));
  const declarations: Declaration[] = [];

  function walk(node: unknown, ancestry: string[], introduction = false): void {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, ancestry, introduction);
      return;
    }
    if (!isMap(node)) return;
    const currentChange = ancestry[0] === 'change_set';
    const legacyEntityChange = ancestry.length === 2 && ancestry[0] === 'changes' && ancestry[1] === 'entities';
    const operation = stringField(node, 'kind') || stringField(node, 'op') || stringField(node, 'operation');
    let introducing = introduction;
    if (currentChange && ['new', 'add', 'split', 'modify', 'remove', 'merge', 'rename', 'deprecate'].includes(operation)) introducing = operation === 'new';
    if (legacyEntityChange) introducing = operation === 'add';
    const identifier = node.get('id', true);
    const metadata = ancestry.length === 1 && ancestry[0] === 'migration';
    const legacyPayload = ancestry[0] === 'changes' && ancestry[1] === 'entities' && ancestry[2] === 'after' && ancestry.length === 3;
    const origin = migration ? (metadata ? 'metadata' : 'introduction') : 'layer';
    const declares = !migration || metadata || (introducing && (currentChange || legacyPayload));
    if (declares && isScalar(identifier) && typeof identifier.value === 'string' && identifier.range) {
      const id = identifier.value;
      if (/^[A-Za-z][A-Za-z0-9.\-]*\d{2,5}$/.test(id)) {
        let startOffset = identifier.range[0];
        let endOffset = identifier.range[1];
        if (text[startOffset] === '"' || text[startOffset] === "'") {
          startOffset += 1;
          endOffset -= 1;
        }
        const start = lineCounter.linePos(startOffset);
        const end = lineCounter.linePos(endOffset);
        const name = stringField(node, 'name') || stringField(node, 'title');
        const kind = stringField(node, 'kind') || stringField(node, 'stereotype') || stringField(node, 'type');
        const description = (stringField(node, 'summary') || stringField(node, 'description')).split('\n')[0];
        const summary = [[kind, name].filter(Boolean).join(' '), description].filter(Boolean).join(' - ');
        declarations.push({
          id, origin, name, kind,
          title: stringField(node, 'title'),
          summary: summary.length > 160 ? summary.slice(0, 157) + '…' : summary,
          status: stringField(node, 'status') || 'unspecified',
          start: { line: start.line - 1, character: start.col - 1 },
          end: { line: end.line - 1, character: end.col - 1 },
        });
      }
    }
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
      const key = pair.key.value;
      const payload = ['entity', 'after', 'payload', 'value'].includes(key);
      const explicitNew = currentChange && !operation && key === 'new';
      walk(pair.value, [...ancestry, key], explicitNew || (introducing && payload));
    }
  }
  walk(root, []);
  return declarations;
}

/** Keep candidates so layer deletion restores introductions without a rebuild. */
export function preferredDeclarations<T extends { origin: Declaration['origin']; modelRoot: string | undefined }>(candidates: T[]): T[] {
  const layerRoots = new Set(candidates.filter(candidate => candidate.origin === 'layer').map(candidate => candidate.modelRoot));
  return candidates.filter(candidate => candidate.origin !== 'introduction' || !layerRoots.has(candidate.modelRoot));
}
