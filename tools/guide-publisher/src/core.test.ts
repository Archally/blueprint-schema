import { describe, expect, it } from 'vitest';
import { extractTitle, guideOutputStem, renderGuideVisuals, rewriteMarkdownLinksForHtml } from './core.js';

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

describe('renderGuideVisuals', () => {
  it('renders multiple visual sections for a regular guide', () => {
    const html = renderGuideVisuals('docs/authoring-guides/design-story.md', 'Story Authoring Guide');
    expect(html).toContain('Guide family map');
    expect(html).toContain('Capture → focus → transformation');
    expect(html).toContain('Story');
  });

  it('adds the multi-file guidance visual for the umbrella guide', () => {
    const html = renderGuideVisuals('docs/authoring-guides/README.md', 'Blueprint Authoring Atlas');
    expect(html).toContain('One layer can span multiple files');
    expect(html).toContain('consumer.concepts.yaml');
  });
});