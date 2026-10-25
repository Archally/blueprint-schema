import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { SourceLocator } from '@archally-blueprint-validator/core/cross-references.mjs';

export function parseSource(text: string) {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { keepSourceTokens: true, lineCounter });
  let data: unknown;
  try { if (!document.errors.length) data = document.toJS({ maxAliasCount: 100 }); } catch { /* invalid alias graph */ }
  return { text, document, lineCounter, data, valid: !document.errors.length && data !== undefined };
}
export type ParsedSource = ReturnType<typeof parseSource>;

/** Follow raw keys and indices, stopping at an authored alias rather than its remote anchor. */
export function sourceRange(source: ParsedSource, locator: SourceLocator): [number, number] | undefined {
  if (!source.valid) return undefined;
  let node: unknown = source.document.contents;
  for (const [index, segment] of locator.path.entries()) {
    if (isAlias(node)) break;
    if (isMap(node)) {
      const pair = node.items.find(item => isScalar(item.key) && String(item.key.value) === String(segment));
      if (!pair) return undefined;
      node = index === locator.path.length - 1 && locator.target === 'key' ? pair.key : pair.value;
    } else if (isSeq(node) && typeof segment === 'number') node = node.items[segment];
    else return undefined;
  }
  if (!isNode(node) || !node.range) return undefined;
  let [start, end] = node.range;
  if (isScalar(node) && (node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE')) { start++; end--; }
  return [start, end];
}
