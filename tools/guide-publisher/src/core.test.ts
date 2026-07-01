import { describe, expect, it } from 'vitest';
import { extractTitle, guideOutputStem, rewriteMarkdownLinksForHtml } from './core.js';

describe('guideOutputStem', () => {
  it('maps README.md to blueprint-authoring-atlas', () => {
    expect(guideOutputStem('docs/authoring-guides/README.md')).toBe('blueprint-authoring-atlas');
  });

  it('maps other guide files to their basename', () => {
    expect(guideOutputStem('docs/authoring-guides/design-story.md')).toBe('design-story');
  });
});

describe('extractTitle', () => {
  it('uses the first heading when present', () => {
    expect(extractTitle('# Blueprint Authoring Atlas\n\nBody', 'docs/authoring-guides/README.md')).toBe('Blueprint Authoring Atlas');
  });
});

describe('rewriteMarkdownLinksForHtml', () => {
  it('rewrites local markdown links to html while preserving anchors', () => {
    const input = '[Story](./design-story.md) and [Concepts](./design-concepts.md#meaning)';
    expect(rewriteMarkdownLinksForHtml(input)).toBe('[Story](./design-story.html) and [Concepts](./design-concepts.html#meaning)');
  });

  it('leaves external links untouched', () => {
    const input = '[site](https://archally.pro)';
    expect(rewriteMarkdownLinksForHtml(input)).toBe(input);
  });
});