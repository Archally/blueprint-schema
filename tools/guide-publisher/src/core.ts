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

interface LayerPalette {
  border: string;
  bgTop: string;
  bgBottom: string;
  shadow: string;
  title: string;
  relatedBorder: string;
  relatedBg: string;
  relatedText: string;
  currentBorder: string;
  currentBg: string;
  currentText: string;
  focusBorder: string;
  focusBg: string;
  arrow: string;
  linkBorder: string;
  linkBg: string;
  linkText: string;
}

const DEFAULT_SOURCE_DIR = 'docs/handoff-guides/markdown';
const DEFAULT_BUILD_DIR = 'docs/handoff-guides/markdown/.build';
const DEFAULT_PDF_DIR = 'docs/handoff-guides/pdf';
const GENERATED_TARGET_PREFIXES = ['pdf/', './pdf/', '../pdf/', '.build/', './.build/', '../.build/'];
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
    'docs/handoff-guides/markdown/README.md',
    'docs/handoff-guides/markdown/blueprint-schema.md',
    'docs/handoff-guides/markdown/metamodel-schema.md',
    'docs/handoff-guides/markdown/migration-schema.md',
  ],
  design: [
    'docs/handoff-guides/markdown/design/arch.md',
    'docs/handoff-guides/markdown/design/concepts.md',
    'docs/handoff-guides/markdown/design/domain.md',
    'docs/handoff-guides/markdown/design/dynamics.md',
    'docs/handoff-guides/markdown/design/infrastructure.md',
    'docs/handoff-guides/markdown/design/interactions.md',
    'docs/handoff-guides/markdown/design/models.md',
    'docs/handoff-guides/markdown/design/quality.md',
    'docs/handoff-guides/markdown/design/rules.md',
    'docs/handoff-guides/markdown/design/story.md',
  ],
  governance: [
    'docs/handoff-guides/markdown/governance/capability.md',
    'docs/handoff-guides/markdown/governance/decisions.md',
    'docs/handoff-guides/markdown/governance/motivation.md',
    'docs/handoff-guides/markdown/governance/organization.md',
    'docs/handoff-guides/markdown/governance/roadmap.md',
    'docs/handoff-guides/markdown/governance/leverage.md',
    'docs/handoff-guides/markdown/governance/test-cases.md',
    'docs/handoff-guides/markdown/governance/value-stream.md',
  ],
};

// Tuned to resonate with the assigned VS Code Material Icon Theme file icons.
const LAYER_PALETTES: Record<string, LayerPalette> = {
  'blueprint-handoff-atlas': { border: '#64b5f6', bgTop: '#e3f2fd', bgBottom: '#bbdefb', shadow: 'rgba(25, 118, 210, 0.12)', title: '#1976d2', relatedBorder: '#90caf9', relatedBg: '#e3f2fd', relatedText: '#1565c0', currentBorder: '#1976d2', currentBg: '#1976d2', currentText: '#ffffff', focusBorder: '#64b5f6', focusBg: '#e3f2fd', arrow: '#1976d2', linkBorder: '#90caf9', linkBg: '#e3f2fd', linkText: '#1565c0' },
  'blueprint-schema': { border: '#64b5f6', bgTop: '#f5faff', bgBottom: '#e3f2fd', shadow: 'rgba(25, 118, 210, 0.10)', title: '#1565c0', relatedBorder: '#90caf9', relatedBg: '#e3f2fd', relatedText: '#1565c0', currentBorder: '#1976d2', currentBg: '#1976d2', currentText: '#ffffff', focusBorder: '#64b5f6', focusBg: '#e3f2fd', arrow: '#1976d2', linkBorder: '#90caf9', linkBg: '#e3f2fd', linkText: '#1565c0' },
  'metamodel-schema': { border: '#4fc3f7', bgTop: '#e1f5fe', bgBottom: '#b3e5fc', shadow: 'rgba(41, 182, 246, 0.12)', title: '#039be5', relatedBorder: '#81d4fa', relatedBg: '#e1f5fe', relatedText: '#0288d1', currentBorder: '#039be5', currentBg: '#039be5', currentText: '#ffffff', focusBorder: '#4fc3f7', focusBg: '#e1f5fe', arrow: '#039be5', linkBorder: '#81d4fa', linkBg: '#e1f5fe', linkText: '#0288d1' },
  'migration-schema': { border: '#64b5f6', bgTop: '#e3f2fd', bgBottom: '#bbdefb', shadow: 'rgba(66, 165, 245, 0.12)', title: '#1e88e5', relatedBorder: '#90caf9', relatedBg: '#e3f2fd', relatedText: '#1976d2', currentBorder: '#1e88e5', currentBg: '#1e88e5', currentText: '#ffffff', focusBorder: '#64b5f6', focusBg: '#e3f2fd', arrow: '#1e88e5', linkBorder: '#90caf9', linkBg: '#e3f2fd', linkText: '#1976d2' },
  'design-arch': { border: '#ef5350', bgTop: '#ffebee', bgBottom: '#fff8e1', shadow: 'rgba(229, 57, 53, 0.12)', title: '#d32f2f', relatedBorder: '#ef9a9a', relatedBg: '#ffebee', relatedText: '#c62828', currentBorder: '#d32f2f', currentBg: '#d32f2f', currentText: '#ffffff', focusBorder: '#f9a825', focusBg: '#fff8e1', arrow: '#e53935', linkBorder: '#ef9a9a', linkBg: '#ffebee', linkText: '#c62828' },
  'design-concepts': { border: '#82b1ff', bgTop: '#e3f2fd', bgBottom: '#bbdefb', shadow: 'rgba(68, 138, 255, 0.12)', title: '#2979ff', relatedBorder: '#82b1ff', relatedBg: '#e3f2fd', relatedText: '#1565c0', currentBorder: '#2979ff', currentBg: '#2979ff', currentText: '#ffffff', focusBorder: '#82b1ff', focusBg: '#e3f2fd', arrow: '#2979ff', linkBorder: '#82b1ff', linkBg: '#e3f2fd', linkText: '#1565c0' },
  'design-domain': { border: '#ce93d8', bgTop: '#f3e5f5', bgBottom: '#e1bee7', shadow: 'rgba(171, 71, 188, 0.12)', title: '#8e24aa', relatedBorder: '#ce93d8', relatedBg: '#f3e5f5', relatedText: '#7b1fa2', currentBorder: '#8e24aa', currentBg: '#8e24aa', currentText: '#ffffff', focusBorder: '#ce93d8', focusBg: '#f3e5f5', arrow: '#8e24aa', linkBorder: '#ce93d8', linkBg: '#f3e5f5', linkText: '#7b1fa2' },
  'design-dynamics': { border: '#ffca28', bgTop: '#fff8e1', bgBottom: '#fce4ec', shadow: 'rgba(173, 20, 87, 0.12)', title: '#ad1457', relatedBorder: '#ffca28', relatedBg: '#fff8e1', relatedText: '#ad1457', currentBorder: '#ad1457', currentBg: '#ad1457', currentText: '#ffffff', focusBorder: '#ffca28', focusBg: '#fff8e1', arrow: '#ff5252', linkBorder: '#ffca28', linkBg: '#fff8e1', linkText: '#ad1457' },
  'design-infrastructure': { border: '#4fc3f7', bgTop: '#e1f5fe', bgBottom: '#b3e5fc', shadow: 'rgba(41, 182, 246, 0.12)', title: '#039be5', relatedBorder: '#81d4fa', relatedBg: '#e1f5fe', relatedText: '#0288d1', currentBorder: '#039be5', currentBg: '#039be5', currentText: '#ffffff', focusBorder: '#4fc3f7', focusBg: '#e1f5fe', arrow: '#039be5', linkBorder: '#81d4fa', linkBg: '#e1f5fe', linkText: '#0288d1' },
  'design-interactions': { border: '#ff8a65', bgTop: '#fbe9e7', bgBottom: '#ede7f6', shadow: 'rgba(124, 77, 255, 0.12)', title: '#7c4dff', relatedBorder: '#ff8a65', relatedBg: '#fce4ec', relatedText: '#ad1457', currentBorder: '#7c4dff', currentBg: '#7c4dff', currentText: '#ffffff', focusBorder: '#29b6f6', focusBg: '#e3f2fd', arrow: '#7c4dff', linkBorder: '#ff8a65', linkBg: '#fce4ec', linkText: '#ad1457' },
  'design-models': { border: '#69f0ae', bgTop: '#e8f5e9', bgBottom: '#e1f5fe', shadow: 'rgba(79, 195, 247, 0.12)', title: '#039be5', relatedBorder: '#69f0ae', relatedBg: '#e8f5e9', relatedText: '#00897b', currentBorder: '#039be5', currentBg: '#039be5', currentText: '#ffffff', focusBorder: '#69f0ae', focusBg: '#e8f5e9', arrow: '#039be5', linkBorder: '#69f0ae', linkBg: '#e8f5e9', linkText: '#00897b' },
  'design-quality': { border: '#9ccc65', bgTop: '#f1f8e9', bgBottom: '#dcedc8', shadow: 'rgba(124, 179, 66, 0.12)', title: '#689f38', relatedBorder: '#aed581', relatedBg: '#f1f8e9', relatedText: '#558b2f', currentBorder: '#689f38', currentBg: '#689f38', currentText: '#ffffff', focusBorder: '#9ccc65', focusBg: '#f1f8e9', arrow: '#689f38', linkBorder: '#aed581', linkBg: '#f1f8e9', linkText: '#558b2f' },
  'design-rules': { border: '#ffab91', bgTop: '#fbe9e7', bgBottom: '#ffccbc', shadow: 'rgba(255, 112, 67, 0.12)', title: '#e64a19', relatedBorder: '#ffab91', relatedBg: '#fbe9e7', relatedText: '#d84315', currentBorder: '#e64a19', currentBg: '#e64a19', currentText: '#ffffff', focusBorder: '#ffab91', focusBg: '#fbe9e7', arrow: '#e64a19', linkBorder: '#ffab91', linkBg: '#fbe9e7', linkText: '#d84315' },
  'design-story': { border: '#90caf9', bgTop: '#e3f2fd', bgBottom: '#bbdefb', shadow: 'rgba(66, 165, 245, 0.12)', title: '#1e88e5', relatedBorder: '#90caf9', relatedBg: '#e3f2fd', relatedText: '#1976d2', currentBorder: '#1e88e5', currentBg: '#1e88e5', currentText: '#ffffff', focusBorder: '#90caf9', focusBg: '#e3f2fd', arrow: '#1e88e5', linkBorder: '#90caf9', linkBg: '#e3f2fd', linkText: '#1976d2' },
  'governance-capability': { border: '#ffd54f', bgTop: '#fffde7', bgBottom: '#fff9c4', shadow: 'rgba(255, 202, 40, 0.12)', title: '#f57f17', relatedBorder: '#ffe082', relatedBg: '#fffde7', relatedText: '#f57f17', currentBorder: '#f57f17', currentBg: '#f57f17', currentText: '#ffffff', focusBorder: '#ffd54f', focusBg: '#fffde7', arrow: '#f57f17', linkBorder: '#ffe082', linkBg: '#fffde7', linkText: '#f57f17' },
  'governance-decisions': { border: '#81c784', bgTop: '#e8f5e9', bgBottom: '#c8e6c9', shadow: 'rgba(76, 175, 80, 0.12)', title: '#388e3c', relatedBorder: '#a5d6a7', relatedBg: '#e8f5e9', relatedText: '#2e7d32', currentBorder: '#388e3c', currentBg: '#388e3c', currentText: '#ffffff', focusBorder: '#81c784', focusBg: '#e8f5e9', arrow: '#388e3c', linkBorder: '#a5d6a7', linkBg: '#e8f5e9', linkText: '#2e7d32' },
  'governance-motivation': { border: '#ffd54f', bgTop: '#fff8e1', bgBottom: '#ffecb3', shadow: 'rgba(255, 202, 40, 0.12)', title: '#ff8f00', relatedBorder: '#ffe082', relatedBg: '#fff8e1', relatedText: '#f57c00', currentBorder: '#ff8f00', currentBg: '#ff8f00', currentText: '#ffffff', focusBorder: '#ffd54f', focusBg: '#fff8e1', arrow: '#ff8f00', linkBorder: '#ffe082', linkBg: '#fff8e1', linkText: '#f57c00' },
  'governance-organization': { border: '#9ccc65', bgTop: '#f1f8e9', bgBottom: '#dcedc8', shadow: 'rgba(124, 179, 66, 0.12)', title: '#689f38', relatedBorder: '#aed581', relatedBg: '#f1f8e9', relatedText: '#558b2f', currentBorder: '#689f38', currentBg: '#689f38', currentText: '#ffffff', focusBorder: '#9ccc65', focusBg: '#f1f8e9', arrow: '#689f38', linkBorder: '#aed581', linkBg: '#f1f8e9', linkText: '#558b2f' },
  'governance-roadmap': { border: '#ef5350', bgTop: '#ffebee', bgBottom: '#fff8e1', shadow: 'rgba(229, 57, 53, 0.12)', title: '#d32f2f', relatedBorder: '#ef9a9a', relatedBg: '#ffebee', relatedText: '#c62828', currentBorder: '#d32f2f', currentBg: '#d32f2f', currentText: '#ffffff', focusBorder: '#f9a825', focusBg: '#fff8e1', arrow: '#e53935', linkBorder: '#ef9a9a', linkBg: '#ffebee', linkText: '#c62828' },
  'governance-leverage': { border: '#ffd54f', bgTop: '#fff8e1', bgBottom: '#ffe082', shadow: 'rgba(255, 179, 0, 0.12)', title: '#ff8f00', relatedBorder: '#ffe082', relatedBg: '#fff8e1', relatedText: '#f57c00', currentBorder: '#ff8f00', currentBg: '#ff8f00', currentText: '#ffffff', focusBorder: '#ffd54f', focusBg: '#fff8e1', arrow: '#fb8c00', linkBorder: '#ffe082', linkBg: '#fff8e1', linkText: '#f57c00' },
  'governance-test-cases': { border: '#ffd54f', bgTop: '#fff8e1', bgBottom: '#ffecb3', shadow: 'rgba(255, 202, 40, 0.12)', title: '#fb8c00', relatedBorder: '#ffe082', relatedBg: '#fff8e1', relatedText: '#f57c00', currentBorder: '#fb8c00', currentBg: '#fb8c00', currentText: '#ffffff', focusBorder: '#ffd54f', focusBg: '#fff8e1', arrow: '#fb8c00', linkBorder: '#ffe082', linkBg: '#fff8e1', linkText: '#f57c00' },
  'governance-value-stream': { border: '#ff8a80', bgTop: '#ffebee', bgBottom: '#fff8e1', shadow: 'rgba(183, 28, 28, 0.12)', title: '#b71c1c', relatedBorder: '#ef9a9a', relatedBg: '#ffebee', relatedText: '#c62828', currentBorder: '#b71c1c', currentBg: '#b71c1c', currentText: '#ffffff', focusBorder: '#fbc02d', focusBg: '#fff8e1', arrow: '#e53935', linkBorder: '#ef9a9a', linkBg: '#ffebee', linkText: '#c62828' },
};

const GUIDE_VISUALS: Record<string, GuideVisualSpec> = {
  'docs/handoff-guides/markdown/README.md': {
    label: 'Handoff Atlas',
    group: 'root',
    captures: ['Workshop notes', 'Guide selection', 'Cross-layer consistency'],
    outputs: ['Transformation-ready text', 'Shared guide map', 'Review loop'],
    related: ['Blueprint Bundle', 'Metamodel Vocabulary', 'Migrations'],
  },
  'docs/handoff-guides/markdown/blueprint-schema.md': {
    label: 'Blueprint Bundle',
    group: 'root',
    captures: ['System scope', 'Slices & shared files', 'Bundle conventions'],
    outputs: ['Blueprint layout', 'Root vs slice structure', 'Whole-model clarity'],
    related: ['Handoff Atlas', 'Metamodel Vocabulary', 'Migrations'],
  },
  'docs/handoff-guides/markdown/metamodel-schema.md': {
    label: 'Metamodel Vocabulary',
    group: 'root',
    captures: ['Shared terms', 'Typed references', 'Cross-layer consistency'],
    outputs: ['Stable naming', 'Reference clarity', 'Shared language'],
    related: ['Handoff Atlas', 'Blueprint Bundle', 'Migrations'],
  },
  'docs/handoff-guides/markdown/migration-schema.md': {
    label: 'Migrations',
    group: 'root',
    captures: ['Change intent', 'Ordering & dependencies', 'Rollback concerns'],
    outputs: ['Model evolution plan', 'Traceable changes', 'Upgrade safety'],
    related: ['Handoff Atlas', 'Blueprint Bundle', 'Decisions'],
  },
  'docs/handoff-guides/markdown/design/arch.md': {
    label: 'Architecture',
    group: 'design',
    captures: ['Boundaries', 'Contexts & services', 'Dependencies'],
    outputs: ['Structural map', 'Ownership seams', 'System overview'],
    related: ['Infrastructure', 'Domain', 'Organization'],
  },
  'docs/handoff-guides/markdown/design/concepts.md': {
    label: 'Concepts',
    group: 'design',
    captures: ['Business entities', 'Identity & states', 'Relationships'],
    outputs: ['Shared domain meaning', 'Stable vocabulary', 'Concept links'],
    related: ['Story', 'Rules', 'Models'],
  },
  'docs/handoff-guides/markdown/design/domain.md': {
    label: 'Domain',
    group: 'design',
    captures: ['Commands/events/queries', 'Effects', 'Errors & questions'],
    outputs: ['Causal understanding', 'Operation catalog', 'Traceable change'],
    related: ['Story', 'Rules', 'Dynamics'],
  },
  'docs/handoff-guides/markdown/design/dynamics.md': {
    label: 'Dynamics',
    group: 'design',
    captures: ['Ordering', 'Parallel work', 'Timing hazards'],
    outputs: ['Runtime flow', 'Concurrency risks', 'Execution insight'],
    related: ['Domain', 'Infrastructure', 'Quality'],
  },
  'docs/handoff-guides/markdown/design/infrastructure.md': {
    label: 'Infrastructure',
    group: 'design',
    captures: ['Resources', 'Environments', 'Operational ownership'],
    outputs: ['Topology view', 'Runtime dependencies', 'Support boundaries'],
    related: ['Architecture', 'Dynamics', 'Organization'],
  },
  'docs/handoff-guides/markdown/design/interactions.md': {
    label: 'Interactions',
    group: 'design',
    captures: ['Screens', 'User actions', 'Responses & navigation'],
    outputs: ['UI flow clarity', 'State transitions', 'Links to stories'],
    related: ['Story', 'Concepts', 'Rules'],
  },
  'docs/handoff-guides/markdown/design/models.md': {
    label: 'Models',
    group: 'design',
    captures: ['Information bundles', 'Fields with meaning', 'Producers/consumers'],
    outputs: ['Shared payload shapes', 'Boundary clarity', 'Display/read-models'],
    related: ['Domain', 'Concepts', 'Interactions'],
  },
  'docs/handoff-guides/markdown/design/quality.md': {
    label: 'Quality',
    group: 'design',
    captures: ['Measures', 'Targets', 'Security/compliance needs'],
    outputs: ['Good-enough thresholds', 'Monitoring focus', 'Risk visibility'],
    related: ['Motivation', 'Infrastructure', 'Test Cases'],
  },
  'docs/handoff-guides/markdown/design/rules.md': {
    label: 'Rules',
    group: 'design',
    captures: ['Constraints', 'Derivations', 'Transitions'],
    outputs: ['Decision criteria', 'Allowed/forbidden behavior', 'State logic'],
    related: ['Concepts', 'Domain', 'Test Cases'],
  },
  'docs/handoff-guides/markdown/design/story.md': {
    label: 'Story',
    group: 'design',
    captures: ['Actors & goals', 'Activities & steps', 'Outcomes & exceptions'],
    outputs: ['Journey map', 'Process narrative', 'Layer handoff'],
    related: ['Interactions', 'Concepts', 'Domain'],
  },
  'docs/handoff-guides/markdown/governance/capability.md': {
    label: 'Capability',
    group: 'governance',
    captures: ['Business abilities', 'Hierarchy', 'Supported goals'],
    outputs: ['What the business can do', 'Stable map', 'Strategy links'],
    related: ['Value Stream', 'Motivation', 'Roadmap'],
  },
  'docs/handoff-guides/markdown/governance/decisions.md': {
    label: 'Decisions',
    group: 'governance',
    captures: ['Choices made', 'Options considered', 'Rationale & impact'],
    outputs: ['Explicit rationale', 'Traceable consequences', 'Governed change'],
    related: ['Motivation', 'Leverage', 'Migrations'],
  },
  'docs/handoff-guides/markdown/governance/motivation.md': {
    label: 'Motivation',
    group: 'governance',
    captures: ['Goals & non-goals', 'Risks & assumptions', 'Trade-offs'],
    outputs: ['Strategic intent', 'Known uncertainties', 'Decision pressure'],
    related: ['Capability', 'Decisions', 'Quality'],
  },
  'docs/handoff-guides/markdown/governance/organization.md': {
    label: 'Organization',
    group: 'governance',
    captures: ['Parties', 'Departments & teams', 'Ownership'],
    outputs: ['Accountability map', 'Responsibility boundaries', 'Owner links'],
    related: ['Architecture', 'Infrastructure', 'Roadmap'],
  },
  'docs/handoff-guides/markdown/governance/roadmap.md': {
    label: 'Roadmap',
    group: 'governance',
    captures: ['Milestones', 'Work breakdown', 'Dependencies & success'],
    outputs: ['Delivery shape', 'Execution sequence', 'Timeline expectations'],
    related: ['Leverage', 'Capability', 'Value Stream'],
  },
  'docs/handoff-guides/markdown/governance/leverage.md': {
    label: 'Leverage',
    group: 'governance',
    captures: ['Vital few priorities', 'What they address', 'Consequences of action/inaction'],
    outputs: ['Prioritized intervention map', 'Why-now clarity', 'Delegation to roadmap work'],
    related: ['Quality', 'Decisions', 'Roadmap'],
  },
  'docs/handoff-guides/markdown/governance/test-cases.md': {
    label: 'Test Cases',
    group: 'governance',
    captures: ['Happy/edge/error cases', 'Expected results', 'Fitness checks'],
    outputs: ['Proof of behavior', 'Coverage thinking', 'Validation evidence'],
    related: ['Rules', 'Quality', 'Story'],
  },
  'docs/handoff-guides/markdown/governance/value-stream.md': {
    label: 'Value Stream',
    group: 'governance',
    captures: ['Trigger to outcome', 'Stages', 'Capabilities & actors'],
    outputs: ['End-to-end value view', 'Cross-boundary flow', 'Outcome framing'],
    related: ['Capability', 'Story', 'Roadmap'],
  },
};

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

const ENTITY_LABEL_EXACT_OVERRIDES: Record<string, string> = {
  '*_ref': 'Typed Reference',
  'components.schemas': 'Component Schemas',
  'owned_by': 'Ownership',
  'x-field': 'Reusable Field',
  'x-parameter': 'Reusable Parameter',
};

const ENTITY_LABEL_WORD_OVERRIDES: Record<string, string> = {
  api: 'API',
  code: 'Code',
  html: 'HTML',
  id: 'ID',
  ids: 'IDs',
  kpi: 'KPI',
  kpis: 'KPIs',
  pdf: 'PDF',
  ref: 'Reference',
  refs: 'References',
  sla: 'SLA',
  slas: 'SLAs',
  slo: 'SLO',
  slos: 'SLOs',
  ui: 'UI',
  x: 'X',
};

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
  const normalized = posixPath(sourceRel);
  if (normalized === 'docs/handoff-guides/markdown/README.md') return 'blueprint-handoff-atlas';
  const relative = posixPath(path.relative('docs/handoff-guides/markdown', normalized));
  return relative.replace(/\.md$/i, '');
}

function guideThemeKey(sourceRel: string): string {
  return guideOutputStem(sourceRel).replace(/\//g, '-');
}

function guidePalette(sourceRel: string): LayerPalette {
  return LAYER_PALETTES[guideThemeKey(sourceRel)] ?? LAYER_PALETTES['blueprint-handoff-atlas'];
}

export function extractTitle(sourceText: string, sourceRel: string): string {
  const match = normalizeText(sourceText).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || guideOutputStem(sourceRel);
}

export function humanizeEntityLabel(codeText: string): string {
  const normalized = codeText.trim();
  if (!normalized) return normalized;

  const exactOverride = ENTITY_LABEL_EXACT_OVERRIDES[normalized.toLowerCase()];
  if (exactOverride) return exactOverride;

  return normalized
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      return ENTITY_LABEL_WORD_OVERRIDES[lower] ?? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(' ');
}

export function rewriteMarkdownLinksForHtml(sourceText: string): string {
  return sourceText.replace(/\]\((?!https?:|mailto:|#)([^)]+\.md)(#[^)]+)?\)/gi, (_m, file, anchor = '') => `](${file.replace(/\.md$/i, '.html')}${anchor})`);
}

function annotateGuideLinks(htmlBody: string, sourceRel: string): string {
  const currentDir = path.posix.dirname(posixPath(sourceRel));
  return htmlBody.replace(/<a href="([^"]+\.html(?:#[^"]+)?)">/gi, (match, hrefWithAnchor: string) => {
    const [hrefPath] = hrefWithAnchor.split('#', 1);
    const targetSourceRel = posixPath(path.posix.normalize(path.posix.join(currentDir, hrefPath.replace(/\.html$/i, '.md'))));
    if (!(targetSourceRel in GUIDE_VISUALS) && targetSourceRel !== 'docs/handoff-guides/markdown/README.md') return match;
    const themeKey = guideThemeKey(targetSourceRel);
    return `<a class="guide-link theme-${themeKey}" href="${hrefWithAnchor}">`;
  });
}

function renderThemeCss(): string {
  return Object.entries(LAYER_PALETTES).map(([key, palette]) => `
      .theme-shell.theme-${key} {
        --theme-border: ${palette.border};
        --theme-bg-top: ${palette.bgTop};
        --theme-bg-bottom: ${palette.bgBottom};
        --theme-shadow: ${palette.shadow};
        --theme-title: ${palette.title};
        --theme-related-border: ${palette.relatedBorder};
        --theme-related-bg: ${palette.relatedBg};
        --theme-related-text: ${palette.relatedText};
        --theme-current-border: ${palette.currentBorder};
        --theme-current-bg: ${palette.currentBg};
        --theme-current-text: ${palette.currentText};
        --theme-focus-border: ${palette.focusBorder};
        --theme-focus-bg: ${palette.focusBg};
        --theme-arrow: ${palette.arrow};
      }
      .guide-link.theme-${key} {
        border-color: ${palette.linkBorder};
        background: ${palette.linkBg};
        color: ${palette.linkText};
      }`).join('\n');
}

function findMarkdownFilesRecursive(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.build' || entry.name === 'pdf') return [];
        return findMarkdownFilesRecursive(abs);
      }
      return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [abs] : [];
    })
    .sort((a, b) => a.localeCompare(b));
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
      <div class="diagram-subtitle">Where this guide sits in the full Blueprint Handoff Atlas family.</div>
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
  if (sourceRel === 'docs/handoff-guides/markdown/README.md') sections.push(renderMultiFileDiagram());
  return `<section class="visual-stack">${sections.join('')}</section>`;
}

export function stylizeMainEntitiesSection(htmlBody: string): string {
  return normalizeText(htmlBody).replace(
    /(<h2>Main entities in this guide<\/h2>\s*)([\s\S]*?)(?=<h2>|$)/i,
    (_match, heading: string, sectionBody: string) => {
      const renderedBody = sectionBody.replace(/<code>([^<]+)<\/code>/g, (_codeMatch, codeText: string) => {
        const original = codeText.trim();
        const label = humanizeEntityLabel(original);
        return `<span class="entity-token" data-entity-code="${escapeHtml(original)}">${escapeHtml(label)}</span>`;
      });
      return `${heading}<section class="main-entities-section">${renderedBody}</section>`;
    },
  );
}

export interface GuideBodySections {
  introHtml: string;
  knowledgeAreaHtml: string;
  remainingHtml: string;
}

export function splitGuideBodySections(htmlBody: string): GuideBodySections {
  const normalized = normalizeText(htmlBody);
  const firstHeadingIndex = normalized.search(/<h2>/i);
  if (firstHeadingIndex < 0) {
    return { introHtml: normalized, knowledgeAreaHtml: '', remainingHtml: '' };
  }

  const introHtml = normalized.slice(0, firstHeadingIndex);
  const bodyFromFirstHeading = normalized.slice(firstHeadingIndex);
  const knowledgeMatch = bodyFromFirstHeading.match(/^\s*<h2>Knowledge area<\/h2>\s*((?:<p>[\s\S]*?<\/p>\s*)+)/i);

  if (!knowledgeMatch) {
    return {
      introHtml,
      knowledgeAreaHtml: '',
      remainingHtml: bodyFromFirstHeading,
    };
  }

  return {
    introHtml,
    knowledgeAreaHtml: knowledgeMatch[1] ?? '',
    remainingHtml: bodyFromFirstHeading.slice(knowledgeMatch[0].length),
  };
}

function renderKnowledgeAreaCallout(knowledgeAreaHtml: string, group: GuideGroup): string {
  if (!knowledgeAreaHtml.trim()) return '';
  return `
    <section class="knowledge-callout group-${group}">
      <div class="knowledge-title">Knowledge area</div>
      <div class="knowledge-body">${knowledgeAreaHtml}</div>
    </section>`;
}

function renderHtmlDocument(title: string, sourceRel: string, htmlBody: string): string {
  const spec = guideSpec(sourceRel, title);
  const themedBody = stylizeMainEntitiesSection(annotateGuideLinks(htmlBody, sourceRel));
  const sections = splitGuideBodySections(themedBody);
  const visuals = renderGuideVisuals(sourceRel, title);
  const knowledgeCallout = renderKnowledgeAreaCallout(sections.knowledgeAreaHtml, spec.group);
  const themeKey = guideThemeKey(sourceRel);
  const themeCss = renderThemeCss();
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
      .main-entities-section .entity-token {
        color: var(--theme-title, #334155);
        font-family: Segoe UI, Arial, sans-serif;
        font-weight: 700;
        background: transparent;
        padding: 0;
        border-radius: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      pre code { display: block; padding: 12px; overflow-x: auto; }
      a { color: #1d4ed8; }
      .guide-link { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; text-decoration: none; font-weight: 600; }
      blockquote { border-left: 4px solid #c7d2fe; margin: 16px 0; padding: 0 16px; color: #475569; }
      .intro-block { margin-bottom: 20px; }
      .knowledge-callout { margin: 0 0 22px; padding: 18px 20px; border-radius: 16px; border: 1px solid var(--theme-border, #cbd5e1); background: linear-gradient(180deg, var(--theme-bg-top, #f8fafc) 0%, var(--theme-bg-bottom, #eef2ff) 100%); box-shadow: 0 12px 24px var(--theme-shadow, rgba(15, 23, 42, 0.08)); }
      .knowledge-title { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--theme-title, #334155); font-weight: 700; margin-bottom: 8px; }
      .knowledge-body p { margin: 0; font-size: 16px; line-height: 1.65; color: #0f172a; }
      .knowledge-body strong:first-of-type { color: #111827; }
      .visual-stack { display: grid; gap: 18px; margin: 0 0 28px; }
      .diagram-card { border: 1px solid #dbe2f0; border-radius: 14px; background: linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%); padding: 18px; }
      .diagram-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
      .diagram-subtitle { font-size: 13px; color: #475569; margin-bottom: 14px; }
      .family-map { display: grid; gap: 12px; }
      .diagram-group { border: 1px solid #d6deed; border-radius: 12px; background: #ffffffcc; padding: 12px; }
      .diagram-group.active { border-color: var(--theme-current-border, #2563eb); box-shadow: inset 0 0 0 1px var(--theme-border, #93c5fd); }
      .diagram-group-title { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #475569; margin-bottom: 10px; }
      .chip-grid { display: flex; flex-wrap: wrap; gap: 8px; }
      .guide-chip { border-radius: 999px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 6px 10px; font-size: 12px; color: #334155; }
      .guide-chip.related { border-color: var(--theme-related-border, #93c5fd); background: var(--theme-related-bg, #eff6ff); color: var(--theme-related-text, #1d4ed8); }
      .guide-chip.current { border-color: var(--theme-current-border, #2563eb); background: var(--theme-current-bg, #2563eb); color: var(--theme-current-text, #fff); font-weight: 600; }
      .flow-diagram, .split-diagram { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; }
      .split-diagram { grid-template-columns: 1fr auto 1.2fr; }
      .flow-box, .split-box { border: 1px solid #cbd5e1; border-radius: 12px; background: #fff; padding: 14px; }
      .focus-box, .primary-box { border-color: var(--theme-focus-border, #2563eb); background: var(--theme-focus-bg, #eff6ff); }
      .flow-heading { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
      .focus-note, .split-caption { font-size: 12px; color: #475569; line-height: 1.5; }
      .flow-box ul { margin: 0; padding-left: 18px; }
      .flow-box li { margin: 0 0 4px; }
      .flow-arrow { font-size: 24px; font-weight: 700; color: var(--theme-arrow, #2563eb); text-align: center; }
      .split-column { display: grid; gap: 10px; }
      .split-stack { display: grid; gap: 8px; }
      ${themeCss}
      @media print {
        body { background: #fff; }
        main { max-width: none; margin: 0; padding: 0; }
        .meta, .intro-block, .knowledge-callout, .visual-stack { break-inside: avoid-page; }
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
        .main-entities-section .entity-token { color: var(--theme-title, #334155) !important; }
      }
      @page { size: A4; margin: 14mm; }
    </style>
  </head>
  <body>
    <main class="theme-shell theme-${themeKey}">
      <div class="meta">Generated from <code>${sourceRel}</code> by <code>tools/guide-publisher</code>.</div>
      <section class="intro-block">${sections.introHtml}</section>
      ${knowledgeCallout}
      ${visuals}
      ${sections.remainingHtml}
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
  const sourceFiles = findMarkdownFilesRecursive(sourceDir);

  const guides: GuideArtifact[] = [];
  const linkErrors: string[] = [];
  for (const sourceAbs of sourceFiles) {
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
      const pdfAbs = path.join(pdfDir, guide.pdfRel);
      fs.mkdirSync(path.dirname(pdfAbs), { recursive: true });
      await page.pdf({
        path: pdfAbs,
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