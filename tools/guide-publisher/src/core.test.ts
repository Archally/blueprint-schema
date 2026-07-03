import { describe, expect, it } from 'vitest';
import { extractTitle, guideOutputStem, renderGuideVisuals, rewriteMarkdownLinksForHtml, splitGuideBodySections } from './core.js';

describe('guideOutputStem', () => {
  it('maps README.md to blueprint-handoff-atlas', () => {
    expect(guideOutputStem('docs/handoff-guides/markdown/README.md')).toBe('blueprint-handoff-atlas');
  });

  it('maps nested guide files to their relative path without the plane prefix in the basename', () => {
    expect(guideOutputStem('docs/handoff-guides/markdown/design/story.md')).toBe('design/story');
  });
});

describe('extractTitle', () => {
  it('uses the first heading when present', () => {
    expect(extractTitle('# Blueprint Handoff Atlas\n\nBody', 'docs/handoff-guides/markdown/README.md')).toBe('Blueprint Handoff Atlas');
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
    const html = renderGuideVisuals('docs/handoff-guides/markdown/design/story.md', 'Story Handoff Guide');
    expect(html).toContain('Guide family map');
    expect(html).toContain('Capture → focus → transformation');
    expect(html).toContain('Story');
  });

  it('adds the multi-file guidance visual for the umbrella guide', () => {
    const html = renderGuideVisuals('docs/handoff-guides/markdown/README.md', 'Blueprint Handoff Atlas');
    expect(html).toContain('One layer can span multiple files');
    expect(html).toContain('consumer.concepts.yaml');
  });
});

describe('splitGuideBodySections', () => {
  it('extracts the knowledge area section from the body', () => {
    const html = '<h1>Story Handoff Guide</h1><p>Intro.</p><h2>Knowledge area</h2><p>Plain language. Technical language.</p><h2>What belongs here</h2><p>Body.</p>';
    const sections = splitGuideBodySections(html);
    expect(sections.introHtml).toContain('<h1>Story Handoff Guide</h1>');
    expect(sections.knowledgeAreaHtml).toContain('Plain language. Technical language.');
    expect(sections.remainingHtml).toContain('<h2>What belongs here</h2>');
  });
});