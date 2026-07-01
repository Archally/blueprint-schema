import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import puppeteer from 'puppeteer-core';

export interface PublisherOptions {
  repoRoot: string;
  sourceDir?: string;
  buildDir?: string;
  pdfDir?: string;
  browserPath?: string;
}

export interface GuideArtifact {
  sourceRel: string;
  title: string;
  sourceAbs: string;
  htmlRel: string;
  pdfRel: string;
  sourceHash: string;
  htmlHash: string;
  html: string;
}

export interface GuideManifestEntry {
  sourceRel: string;
  title: string;
  htmlRel: string;
  pdfRel: string;
  sourceHash: string;
  htmlHash: string;
}

export interface GuideManifest {
  generatedBy: string;
  sourceDir: string;
  guides: GuideManifestEntry[];
}

export interface RenderedGuideSet {
  guides: GuideArtifact[];
  linkErrors: string[];
  buildManifest: GuideManifest;
  pdfManifest: GuideManifest;
}

type GuideGroup = 'root' | 'design' | 'governance';

interface GuideVisualSpec {
  label: string;
  group: GuideGroup;
  captures: string[];
  outputs: string[];
  related: string[];
}

const DEFAULT_SOURCE_DIR = 'docs/authoring-guides';
const DEFAULT_BUILD_DIR = 'docs/authoring-guides/.build';
const DEFAULT_PDF_DIR = 'docs/authoring-guides/pdf';
const GENERATED_TARGET_PREFIXES = ['pdf/', './pdf/', '.build/', './.build/'];
const DEFAULT_BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const GUIDE_GROUP_LABELS: Record<GuideGroup, string> = {
  root: 'Root & Cross-cutting',
  design: 'Design',
  governance: 'Governance',
};

const GUIDE_GROUPS: Record<GuideGroup, string[]> = {
  root: [
    'docs/authoring-guides/README.md',
    'docs/authoring-guides/blueprint-schema.md',
    'docs/authoring-guides/metamodel-schema.md',
    'docs/authoring-guides/migration-schema.md',
  ],
  design: [
    'docs/authoring-guides/design-arch.md',
    'docs/authoring-guides/design-concepts.md',
    'docs/authoring-guides/design-domain.md',
    'docs/authoring-guides/design-dynamics.md',
    'docs/authoring-guides/design-infrastructure.md',
    'docs/authoring-guides/design-interactions.md',
    'docs/authoring-guides/design-models.md',
    'docs/authoring-guides/design-quality.md',
    'docs/authoring-guides/design-rules.md',
    'docs/authoring-guides/design-story.md',
  ],
  governance: [
    'docs/authoring-guides/governance-capability.md',
    'docs/authoring-guides/governance-decisions.md',
    'docs/authoring-guides/governance-motivation.md',
    'docs/authoring-guides/governance-organization.md',
    'docs/authoring-guides/governance-roadmap.md',
    'docs/authoring-guides/governance-test-cases.md',
    'docs/authoring-guides/governance-value-stream.md',
  ],
};

const GUIDE_VISUALS: Record<string, GuideVisualSpec> = {
  'docs/authoring-guides/README.md': {
    label: 'Authoring Atlas',
    group: 'root',
    captures: ['Workshop notes', 'Guide selection', 'Cross-layer consistency'],
    outputs: ['Transformation-ready text', 'Shared guide map', 'Review loop'],
    related: ['Blueprint Bundle', 'Metamodel Vocabulary', 'Migrations'],
  },
  'docs/authoring-guides/blueprint-schema.md': {
    label: 'Blueprint Bundle',
    group: 'root',
    captures: ['System scope', 'Slices & shared files', 'Bundle conventions'],
    outputs: ['Blueprint layout', 'Root vs slice structure', 'Whole-model clarity'],
    related: ['Authoring Atlas', 'Metamodel Vocabulary', 'Migrations'],
  },
  'docs/authoring-guides/metamodel-schema.md': {
    label: 'Metamodel Vocabulary',
    group: 'root',
    captures: ['Shared terms', 'Typed references', 'Cross-layer consistency'],
    outputs: ['Stable naming', 'Reference clarity', 'Shared language'],
    related: ['Authoring Atlas', 'Blueprint Bundle', 'Migrations'],
  },
  'docs/authoring-guides/migration-schema.md': {
    label: 'Migrations',
    group: 'root',
    captures: ['Change intent', 'Ordering & dependencies', 'Rollback concerns'],
    outputs: ['Model evolution plan', 'Traceable changes', 'Upgrade safety'],
    related: ['Authoring Atlas', 'Blueprint Bundle', 'Decisions'],
  },
  'docs/authoring-guides/design-arch.md': {
    label: 'Architecture',
    group: 'design',
    captures: ['Boundaries', 'Contexts & services', 'Dependencies'],
    outputs: ['Structural map', 'Ownership seams', 'System overview'],
    related: ['Infrastructure', 'Domain', 'Organization'],
  },
  'docs/authoring-guides/design-concepts.md': {
    label: 'Concepts',
    group: 'design',
    captures: ['Business entities', 'Identity & states', 'Relationships'],
    outputs: ['Shared domain meaning', 'Stable vocabulary', 'Concept links'],
    related: ['Story', 'Rules', 'Models'],
  },
  'docs/authoring-guides/design-domain.md': {
    label: 'Domain',
    group: 'design',
    captures: ['Commands/events/queries', 'Effects', 'Errors & questions'],
    outputs: ['Causal understanding', 'Operation catalog', 'Traceable change'],
    related: ['Story', 'Rules', 'Dynamics'],
  },
  'docs/authoring-guides/design-dynamics.md': {
    label: 'Dynamics',
    group: 'design',
    captures: ['Ordering', 'Parallel work', 'Timing hazards'],
    outputs: ['Runtime flow', 'Concurrency risks', 'Execution insight'],
    related: ['Domain', 'Infrastructure', 'Quality'],
  },
  'docs/authoring-guides/design-infrastructure.md': {
    label: 'Infrastructure',
    group: 'design',
    captures: ['Resources', 'Environments', 'Operational ownership'],
    outputs: ['Topology view', 'Runtime dependencies', 'Support boundaries'],
    related: ['Architecture', 'Dynamics', 'Organization'],
  },
  'docs/authoring-guides/design-interactions.md': {
    label: 'Interactions',
    group: 'design',
    captures: ['Screens', 'User actions', 'Responses & navigation'],
    outputs: ['UI flow clarity', 'State transitions', 'Links to stories'],
    related: ['Story', 'Concepts', 'Rules'],
  },
  'docs/authoring-guides/design-models.md': {
    label: 'Models',
    group: 'design',
    captures: ['Information bundles', 'Fields with meaning', 'Producers/consumers'],
    outputs: ['Shared payload shapes', 'Boundary clarity', 'Display/read-models'],
    related: ['Domain', 'Concepts', 'Interactions'],
  },
  'docs/authoring-guides/design-quality.md': {
    label: 'Quality',
    group: 'design',
    captures: ['Measures', 'Targets', 'Security/compliance needs'],
    outputs: ['Good-enough thresholds', 'Monitoring focus', 'Risk visibility'],
    related: ['Motivation', 'Infrastructure', 'Test Cases'],
  },
  'docs/authoring-guides/design-rules.md': {
    label: 'Rules',
    group: 'design',
    captures: ['Constraints', 'Derivations', 'Transitions'],
    outputs: ['Decision criteria', 'Allowed/forbidden behavior', 'State logic'],
    related: ['Concepts', 'Domain', 'Test Cases'],
  },
  'docs/authoring-guides/design-story.md': {
    label: 'Story',
    group: 'design',
    captures: ['Actors & goals', 'Activities & steps', 'Outcomes & exceptions'],
    outputs: ['Journey map', 'Process narrative', 'Layer handoff'],
    related: ['Interactions', 'Concepts', 'Domain'],
  },
  'docs/authoring-guides/governance-capability.md': {
    label: 'Capability',
    group: 'governance',
    captures: ['Business abilities', 'Hierarchy', 'Supported goals'],
    outputs: ['What the business can do', 'Stable map', 'Strategy links'],
    related: ['Value Stream', 'Motivation', 'Roadmap'],
  },
  'docs/authoring-guides/governance-decisions.md': {
    label: 'Decisions',
    group: 'governance',
    captures: ['Choices made', 'Options considered', 'Rationale & impact'],
    outputs: ['Explicit rationale', 'Traceable consequences', 'Governed change'],
    related: ['Motivation', 'Roadmap', 'Migrations'],
  },
  'docs/authoring-guides/governance-motivation.md': {
    label: 'Motivation',
    group: 'governance',
    captures: ['Goals & non-goals', 'Risks & assumptions', 'Trade-offs'],
    outputs: ['Strategic intent', 'Known uncertainties', 'Decision pressure'],
    related: ['Capability', 'Decisions', 'Quality'],
  },
  'docs/authoring-guides/governance-organization.md': {
    label: 'Organization',
    group: 'governance',
    captures: ['Parties', 'Departments & teams', 'Ownership'],
    outputs: ['Accountability map', 'Responsibility boundaries', 'Owner links'],
    related: ['Architecture', 'Infrastructure', 'Roadmap'],
  },
  'docs/authoring-guides/governance-roadmap.md': {
    label: 'Roadmap',
    group: 'governance',
    captures: ['Milestones', 'Deliverables', 'Dependencies & success'],
    outputs: ['Delivery shape', 'Priority sequence', 'Timeline expectations'],
    related: ['Capability', 'Decisions', 'Value Stream'],
  },
  'docs/authoring-guides/governance-test-cases.md': {
    label: 'Test Cases',
    group: 'governance',
    captures: ['Happy/edge/error cases', 'Expected results', 'Fitness checks'],
    outputs: ['Proof of behavior', 'Coverage thinking', 'Validation evidence'],
    related: ['Rules', 'Quality', 'Story'],
  },
  'docs/authoring-guides/governance-value-stream.md': {
    label: 'Value Stream',
    group: 'governance',
    captures: ['Trigger to outcome', 'Stages', 'Capabilities & actors'],
    outputs: ['End-to-end value view', 'Cross-boundary flow', 'Outcome framing'],
    related: ['Capability', 'Story', 'Roadmap'],
  },
};

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function hashText(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

function posixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function publisherSourceDir(options: PublisherOptions): string {
  return options.sourceDir ?? DEFAULT_SOURCE_DIR;
}

export function guideOutputStem(sourceRel: string): string {
  const base = path.basename(sourceRel, '.md');
  return base.toLowerCase() === 'readme' ? 'blueprint-authoring-atlas' : base;
}

export function extractTitle(sourceText: string, sourceRel: string): string {
  const match = normalizeText(sourceText).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || guideOutputStem(sourceRel);
}

export function rewriteMarkdownLinksForHtml(sourceText: string): string {
  return sourceText.replace(/\]\((?!https?:|mailto:|#)([^)]+\.md)(#[^)]+)?\)/gi, (_m, file, anchor = '') => `](${file.replace(/\.md$/i, '.html')}${anchor})`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function guideSpec(sourceRel: string, title: string): GuideVisualSpec {
  return GUIDE_VISUALS[sourceRel] ?? {
    label: title,
    group: 'design',
    captures: ['Core meaning', 'Relationships', 'Transformation notes'],
    outputs: ['Structured understanding', 'Reviewable content', 'YAML handoff'],
    related: [],
  };
}

function renderGuideMapDiagram(sourceRel: string, spec: GuideVisualSpec): string {
  const groupBlocks = (Object.keys(GUIDE_GROUPS) as GuideGroup[]).map((group) => {
    const chips = GUIDE_GROUPS[group].map((guideRel) => {
      const other = guideSpec(guideRel, path.basename(guideRel, '.md'));
      const current = guideRel === sourceRel;
      const related = spec.related.includes(other.label);
      const extra = current ? ' current' : related ? ' related' : '';
      return `<span class="guide-chip${extra}">${escapeHtml(other.label)}</span>`;
    }).join('');
    return `
      <section class="diagram-group${group === spec.group ? ' active' : ''}">
        <div class="diagram-group-title">${escapeHtml(GUIDE_GROUP_LABELS[group])}</div>
        <div class="chip-grid">${chips}</div>
      </section>`;
  }).join('');

  return `
    <section class="diagram-card">
      <div class="diagram-title">Guide family map</div>
      <div class="diagram-subtitle">Where this guide sits in the full Blueprint Authoring Atlas family.</div>
      <div class="family-map">${groupBlocks}</div>
    </section>`;
}

function renderCaptureFlowDiagram(spec: GuideVisualSpec): string {
  const renderItems = (items: string[]): string => items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  return `
    <section class="diagram-card">
      <div class="diagram-title">Capture → focus → transformation</div>
      <div class="diagram-subtitle">What to gather first, what this layer focuses on, and what a modeler or AI agent can produce from it.</div>
      <div class="flow-diagram">
        <div class="flow-box">
          <div class="flow-heading">Capture inputs</div>
          <ul>${renderItems(spec.captures)}</ul>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-box focus-box">
          <div class="flow-heading">${escapeHtml(spec.label)}</div>
          <div class="focus-note">This guide helps non-technical people express this layer clearly.</div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="flow-box">
          <div class="flow-heading">Transformation outputs</div>
          <ul>${renderItems(spec.outputs)}</ul>
        </div>
      </div>
    </section>`;
}

function renderMultiFileDiagram(): string {
  return `
    <section class="diagram-card">
      <div class="diagram-title">One layer can span multiple files</div>
      <div class="diagram-subtitle">Use thematic file splits when the knowledge is large, semantically clustered, or owned by different teams.</div>
      <div class="split-diagram">
        <div class="split-column">
          <div class="split-box primary-box">concepts.yaml</div>
          <div class="split-caption">One file is enough when the layer is still small and coherent.</div>
        </div>
        <div class="flow-arrow">→</div>
        <div class="split-column">
          <div class="split-stack">
            <div class="split-box">consumer.concepts.yaml</div>
            <div class="split-box">organization.concepts.yaml</div>
            <div class="split-box">internal.concepts.yaml</div>
          </div>
          <div class="split-caption">Split by meaningful theme, not arbitrary numbering. The files still describe one layer of knowledge.</div>
        </div>
      </div>
    </section>`;
}

export function renderGuideVisuals(sourceRel: string, title: string): string {
  const spec = guideSpec(sourceRel, title);
  const sections = [renderGuideMapDiagram(sourceRel, spec), renderCaptureFlowDiagram(spec)];
  if (sourceRel === 'docs/authoring-guides/README.md') sections.push(renderMultiFileDiagram());
  return `<section class="visual-stack">${sections.join('')}</section>`;
}

function renderHtmlDocument(title: string, sourceRel: string, htmlBody: string): string {
  const visuals = renderGuideVisuals(sourceRel, title);
  return normalizeText(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }
      main { max-width: 920px; margin: 0 auto; padding: 32px 40px 48px; background: #fff; }
      .meta { margin-bottom: 24px; padding: 12px 16px; border-radius: 10px; background: #eef2ff; color: #374151; font-size: 14px; }
      h1, h2, h3 { color: #0f172a; }
      h1 { margin-top: 0; }
      p, li { line-height: 1.6; }
      table { border-collapse: collapse; width: 100%; margin: 16px 0 24px; }
      th, td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
      pre code { display: block; padding: 12px; overflow-x: auto; }
      a { color: #1d4ed8; }
      blockquote { border-left: 4px solid #c7d2fe; margin: 16px 0; padding: 0 16px; color: #475569; }
      .visual-stack { display: grid; gap: 18px; margin: 0 0 28px; }
      .diagram-card { border: 1px solid #dbe2f0; border-radius: 14px; background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%); padding: 18px; }
      .diagram-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
      .diagram-subtitle { font-size: 13px; color: #475569; margin-bottom: 14px; }
      .family-map { display: grid; gap: 12px; }
      .diagram-group { border: 1px solid #d6deed; border-radius: 12px; background: #ffffffcc; padding: 12px; }
      .diagram-group.active { border-color: #2563eb; box-shadow: inset 0 0 0 1px #93c5fd; }
      .diagram-group-title { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #475569; margin-bottom: 10px; }
      .chip-grid { display: flex; flex-wrap: wrap; gap: 8px; }
      .guide-chip { border-radius: 999px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 6px 10px; font-size: 12px; color: #334155; }
      .guide-chip.related { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
      .guide-chip.current { border-color: #2563eb; background: #2563eb; color: #fff; font-weight: 600; }
      .flow-diagram, .split-diagram { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; }
      .split-diagram { grid-template-columns: 1fr auto 1.2fr; }
      .flow-box, .split-box { border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; padding: 14px; }
      .focus-box, .primary-box { border-color: #2563eb; background: #eff6ff; }
      .flow-heading { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
      .focus-note, .split-caption { font-size: 12px; color: #475569; line-height: 1.5; }
      .flow-box ul { margin: 0; padding-left: 18px; }
      .flow-box li { margin: 0 0 4px; }
      .flow-arrow { font-size: 24px; font-weight: 700; color: #2563eb; text-align: center; }
      .split-column { display: grid; gap: 10px; }
      .split-stack { display: grid; gap: 8px; }
      @media print {
        body { background: #fff; }
        main { max-width: none; margin: 0; padding: 0; }
        .meta, .visual-stack, h1, p:first-of-type { break-inside: avoid-page; }
        .diagram-card { break-inside: avoid; }
        h2 {
          break-before: page;
          page-break-before: always;
          margin-top: 0;
        }
        h2:first-of-type {
          break-before: auto;
          page-break-before: auto;
        }
        h2, h3 { break-after: avoid-page; }
        table, ul, ol, blockquote, pre { break-inside: avoid-page; }
      }
      @page { size: A4; margin: 14mm; }
    </style>
  </head>
  <body>
    <main>
      <div class="meta">Generated from <code>${sourceRel}</code> by <code>tools/guide-publisher</code>.</div>
      ${visuals}
      ${htmlBody}
    </main>
  </body>
</html>
`);
}

function localLinkErrors(sourceText: string, sourceAbs: string): string[] {
  const errors: string[] = [];
  const regex = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of normalizeText(sourceText).matchAll(regex)) {
    const target = match[1];
    if (!target || /^https?:|^mailto:|^#/i.test(target)) continue;
    const [rawPath] = target.split('#', 1);
    if (!rawPath) continue;
    if (GENERATED_TARGET_PREFIXES.some((prefix) => rawPath.startsWith(prefix))) continue;
    const resolved = path.resolve(path.dirname(sourceAbs), rawPath);
    if (!fs.existsSync(resolved)) {
      errors.push(`${posixPath(path.relative(process.cwd(), sourceAbs))}: broken link -> ${target}`);
    }
  }
  return errors;
}

export function renderGuideSet(options: PublisherOptions): RenderedGuideSet {
  const repoRoot = path.resolve(options.repoRoot);
  const sourceDir = path.resolve(repoRoot, publisherSourceDir(options));
  const sourceFiles = fs.readdirSync(sourceDir)
    .filter((entry) => entry.toLowerCase().endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));

  const guides: GuideArtifact[] = [];
  const linkErrors: string[] = [];
  for (const file of sourceFiles) {
    const sourceAbs = path.join(sourceDir, file);
    const sourceRel = posixPath(path.relative(repoRoot, sourceAbs));
    const sourceText = normalizeText(fs.readFileSync(sourceAbs, 'utf8'));
    linkErrors.push(...localLinkErrors(sourceText, sourceAbs));
    const title = extractTitle(sourceText, sourceRel);
    const stem = guideOutputStem(sourceRel);
    const htmlRel = `${stem}.html`;
    const pdfRel = `${stem}.pdf`;
    const htmlBody = markdown.render(rewriteMarkdownLinksForHtml(sourceText));
    const html = renderHtmlDocument(title, sourceRel, htmlBody);
    guides.push({
      sourceRel,
      title,
      sourceAbs,
      htmlRel,
      pdfRel,
      sourceHash: hashText(sourceText),
      htmlHash: hashText(html),
      html,
    });
  }

  const manifestGuides: GuideManifestEntry[] = guides.map((guide) => ({
    sourceRel: guide.sourceRel,
    title: guide.title,
    htmlRel: guide.htmlRel,
    pdfRel: guide.pdfRel,
    sourceHash: guide.sourceHash,
    htmlHash: guide.htmlHash,
  }));

  return {
    guides,
    linkErrors,
    buildManifest: { generatedBy: 'tools/guide-publisher', sourceDir: publisherSourceDir(options), guides: manifestGuides },
    pdfManifest: { generatedBy: 'tools/guide-publisher', sourceDir: publisherSourceDir(options), guides: manifestGuides },
  };
}

function manifestText(manifest: GuideManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function writeText(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, normalizeText(content), 'utf8');
}

export function writeBuildOutputs(options: PublisherOptions, rendered: RenderedGuideSet): void {
  const repoRoot = path.resolve(options.repoRoot);
  const buildDir = path.resolve(repoRoot, options.buildDir ?? DEFAULT_BUILD_DIR);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  for (const guide of rendered.guides) writeText(path.join(buildDir, guide.htmlRel), guide.html);
  writeText(path.join(buildDir, 'manifest.json'), manifestText(rendered.buildManifest));
}

export function resolveBrowserPath(options: PublisherOptions): string {
  const envPath = process.env.BLUEPRINT_GUIDES_BROWSER;
  const candidates = [options.browserPath, envPath, ...DEFAULT_BROWSER_CANDIDATES].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  throw new Error('No browser executable found for PDF export. Set BLUEPRINT_GUIDES_BROWSER or pass --browser <path>.');
}

export async function writePdfOutputs(options: PublisherOptions, rendered: RenderedGuideSet): Promise<void> {
  const repoRoot = path.resolve(options.repoRoot);
  const pdfDir = path.resolve(repoRoot, options.pdfDir ?? DEFAULT_PDF_DIR);
  fs.rmSync(pdfDir, { recursive: true, force: true });
  fs.mkdirSync(pdfDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: resolveBrowserPath(options),
    headless: true,
  });
  try {
    for (const guide of rendered.guides) {
      const page = await browser.newPage();
      await page.setContent(guide.html, { waitUntil: 'load' });
      await page.emulateMediaType('screen');
      await page.pdf({
        path: path.join(pdfDir, guide.pdfRel),
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  writeText(path.join(pdfDir, 'manifest.json'), manifestText(rendered.pdfManifest));
}

export function checkPdfOutputs(options: PublisherOptions, rendered: RenderedGuideSet): string[] {
  const repoRoot = path.resolve(options.repoRoot);
  const pdfDir = path.resolve(repoRoot, options.pdfDir ?? DEFAULT_PDF_DIR);
  const issues = [...rendered.linkErrors];
  const manifestAbs = path.join(pdfDir, 'manifest.json');
  const expectedManifest = manifestText(rendered.pdfManifest);

  if (!fs.existsSync(manifestAbs)) issues.push(`missing: ${posixPath(path.relative(repoRoot, manifestAbs))}`);
  else if (normalizeText(fs.readFileSync(manifestAbs, 'utf8')) !== normalizeText(expectedManifest)) issues.push(`stale:   ${posixPath(path.relative(repoRoot, manifestAbs))}`);

  const expectedPdfs = new Set(rendered.guides.map((guide) => guide.pdfRel));
  for (const guide of rendered.guides) {
    const pdfAbs = path.join(pdfDir, guide.pdfRel);
    if (!fs.existsSync(pdfAbs)) issues.push(`missing: ${posixPath(path.relative(repoRoot, pdfAbs))}`);
  }

  if (fs.existsSync(pdfDir)) {
    const onDiskPdfs = fs.readdirSync(pdfDir).filter((entry) => entry.toLowerCase().endsWith('.pdf'));
    for (const pdf of onDiskPdfs) {
      if (!expectedPdfs.has(pdf)) issues.push(`orphan:  ${posixPath(path.relative(repoRoot, path.join(pdfDir, pdf)))}`);
    }
  }

  return issues.sort();
}