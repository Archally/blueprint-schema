import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPdfOutputs, extractTitle, rebaseRelativeLinksForHtml, guideOutputStem, humanizeEntityLabel, renderGuideVisuals, rewriteMarkdownLinksForHtml, splitGuideBodySections, stylizeMainEntitiesSection } from './core.js';
import type { RenderedGuideSet } from './core.js';

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

describe('humanizeEntityLabel', () => {
  it('turns snake_case entity names into human-readable labels', () => {
    expect(humanizeEntityLabel('test_case')).toBe('Test Case');
    expect(humanizeEntityLabel('concept_ref')).toBe('Concept Reference');
    expect(humanizeEntityLabel('happy_path')).toBe('Happy Path');
  });

  it('applies editorial wording for awkward schema helper tokens', () => {
    expect(humanizeEntityLabel('owned_by')).toBe('Ownership');
    expect(humanizeEntityLabel('x-field')).toBe('Reusable Field');
    expect(humanizeEntityLabel('x-parameter')).toBe('Reusable Parameter');
    expect(humanizeEntityLabel('components.schemas')).toBe('Component Schemas');
  });

  it('keeps common acronym entities readable', () => {
    expect(humanizeEntityLabel('kpi')).toBe('KPI');
    expect(humanizeEntityLabel('slo')).toBe('SLO');
    expect(humanizeEntityLabel('ui')).toBe('UI');
  });

  it('handles wildcard typed-reference helpers', () => {
    expect(humanizeEntityLabel('*_ref')).toBe('Typed Reference');
  });
});

describe('stylizeMainEntitiesSection', () => {
  it('replaces code identifiers in the main entities section with human-readable labels', () => {
    const html = '<h2>Main entities in this guide</h2><ul><li><code>test_case</code>, <code>owned_by</code>, and <code>x-field</code> inside <code>components.schemas</code></li></ul><h2>What belongs here</h2><p>Body.</p>';
    const result = stylizeMainEntitiesSection(html);

    expect(result).toContain('class="main-entities-section"');
    expect(result).toContain('data-entity-code="test_case">Test Case</span>');
    expect(result).toContain('data-entity-code="owned_by">Ownership</span>');
    expect(result).toContain('data-entity-code="x-field">Reusable Field</span>');
    expect(result).toContain('data-entity-code="components.schemas">Component Schemas</span>');
    expect(result).not.toContain('<code>test_case</code>');
    expect(result).toContain('<h2>What belongs here</h2>');
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
describe('checkPdfOutputs', () => {
  it('reports a PDF in a nested folder that no guide produces as an orphan', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-check-'));
    try {
      const pdfDir = path.join(repoRoot, 'docs/handoff-guides/pdf');
      fs.mkdirSync(path.join(pdfDir, 'design/extra'), { recursive: true });
      fs.writeFileSync(path.join(pdfDir, 'design/arch.pdf'), '%PDF-1.4\n');
      fs.writeFileSync(path.join(pdfDir, 'design/extra/orphan.pdf'), '%PDF-1.4\n');
      const pdfManifest = { generatedBy: 'test', sourceDir: 'docs/handoff-guides/markdown', guides: [] };
      fs.writeFileSync(path.join(pdfDir, 'manifest.json'), `${JSON.stringify(pdfManifest, null, 2)}\n`);
      const rendered = { guides: [{ pdfRel: 'design/arch.pdf' }], linkErrors: [], buildManifest: pdfManifest, pdfManifest } as unknown as RenderedGuideSet;
      expect(checkPdfOutputs({ repoRoot }, rendered)).toEqual(['orphan:  docs/handoff-guides/pdf/design/extra/orphan.pdf']);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('rebaseRelativeLinksForHtml', () => {
  it('points a link to the PDF folder at the same folder from the HTML preview', () => {
    const input = 'Generated PDFs live in [`../pdf/`](../pdf/) and [the atlas](../pdf/blueprint-handoff-atlas.pdf#page=2).';
    expect(rebaseRelativeLinksForHtml(input, '/repo/docs/guides/markdown', '/repo/docs/guides/markdown/.build'))
      .toBe('Generated PDFs live in [`../pdf/`](../../pdf/) and [the atlas](../../pdf/blueprint-handoff-atlas.pdf#page=2).');
  });

  it('leaves guide links, anchors and external links untouched', () => {
    const input = '[Story](design/story.html#flow) [Top](#top) [Site](https://example.org/x)';
    expect(rebaseRelativeLinksForHtml(input, '/repo/docs/guides/markdown', '/repo/docs/guides/markdown/.build')).toBe(input);
  });
});
