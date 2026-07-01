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

function renderHtmlDocument(title: string, sourceRel: string, htmlBody: string): string {
  return normalizeText(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }
      main { max-width: 920px; margin: 0 auto; padding: 32px 40px 48px; background: #fff; min-height: 100vh; }
      .meta { margin-bottom: 24px; padding: 12px 16px; border-radius: 10px; background: #eef2ff; color: #374151; font-size: 14px; }
      h1, h2, h3 { color: #0f172a; }
      p, li { line-height: 1.6; }
      table { border-collapse: collapse; width: 100%; margin: 16px 0 24px; }
      th, td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; }
      pre code { display: block; padding: 12px; overflow-x: auto; }
      a { color: #1d4ed8; }
      blockquote { border-left: 4px solid #c7d2fe; margin: 16px 0; padding: 0 16px; color: #475569; }
      @page { size: A4; margin: 14mm; }
    </style>
  </head>
  <body>
    <main>
      <div class="meta">Generated from <code>${sourceRel}</code> by <code>tools/guide-publisher</code>.</div>
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