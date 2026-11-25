// @ts-check
/**
 * Spec + project-override loading.
 *
 * The spec ships with the tool and is the shared definition of what "good" means.
 * The project override (`.blueprint-quality.yaml`) is where a specific model states
 * its own bar, its ratchet, and its reasoned deferrals. Nothing here resolves paths
 * relative to the tool's own location beyond the default spec, so the same files
 * work wherever the tool directory is placed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  SUPPORTED_ECHO_LOCALES,
  DEFAULT_LABEL_FIELDS,
  DEFAULT_ECHO_PROSE_FIELDS,
  DEFAULT_FILLER_FIELDS,
  DEFAULT_EVIDENCE_FIELDS,
} from './text-advisory.mjs';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SPEC_PATH = path.join(TOOL_DIR, 'quality-spec.yaml');
export const PROJECT_CONFIG_NAME = '.blueprint-quality.yaml';

/** @param {string} file */
function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
}

/**
 * @param {string} [specPath]
 * @returns {{spec: object, path: string}}
 */
export function loadSpec(specPath) {
  const resolved = specPath ? path.resolve(specPath) : DEFAULT_SPEC_PATH;
  if (!fs.existsSync(resolved)) throw new Error(`quality spec not found: ${resolved}`);
  const spec = readYaml(resolved);
  if (!spec.metrics || typeof spec.metrics !== 'object') {
    throw new Error(`quality spec has no "metrics" block: ${resolved}`);
  }
  return { spec, path: resolved };
}

/**
 * Look for a project override in the model root, then walk up to the project dir —
 * `.blueprint/v2.8/` models conventionally keep theirs beside `.blueprint/`.
 * @param {string} modelRoot
 * @param {string} [explicitPath]
 * @returns {{config: object, path: string|null}}
 */
export function loadProjectConfig(modelRoot, explicitPath) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (!fs.existsSync(resolved)) throw new Error(`project config not found: ${resolved}`);
    return { config: readYaml(resolved), path: resolved };
  }
  let directory = path.resolve(modelRoot);
  for (let depth = 0; depth < 4; depth++) {
    const candidate = path.join(directory, PROJECT_CONFIG_NAME);
    if (fs.existsSync(candidate)) return { config: readYaml(candidate), path: candidate };
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { config: {}, path: null };
}

/**
 * Persist an updated baseline, preserving everything else in the file (including
 * comments where the file already existed).
 *
 * A whole-model update writes the flat `baseline.<metric>` entries and leaves any
 * per-slice `baseline.slices` untouched; a slice update writes only
 * `baseline.slices.<slice>.<metric>` and leaves the flat entries and its sibling
 * slices untouched. The two ratchets are independent claims and must not clobber
 * each other.
 * @param {string} configPath
 * @param {Record<string, number>} baseline metric → score for the run being ratcheted
 * @param {string} [slice] when given, write under `baseline.slices.<slice>` instead
 */
export function writeBaseline(configPath, baseline, slice) {
  const document = fs.existsSync(configPath)
    ? YAML.parseDocument(fs.readFileSync(configPath, 'utf8'))
    : YAML.parseDocument('# Blueprint quality-gate project configuration\n');

  // Read the existing baseline as a plain JS value so flat entries and the per-slice
  // block can be recombined and written back as a single node — setting the node and
  // then reaching back into it with setIn fights the YAML document model.
  const existing = document.get('baseline');
  const existingObject = existing && typeof existing.toJSON === 'function' ? existing.toJSON() : (existing ?? {});
  const { slices: existingSlices, ...existingFlat } = existingObject;

  let nextBaselineBlock;
  if (slice) {
    nextBaselineBlock = { ...existingFlat, slices: { ...(existingSlices ?? {}), [slice]: baseline } };
  } else {
    nextBaselineBlock = { ...baseline };
    if (existingSlices !== undefined) nextBaselineBlock.slices = existingSlices;
  }

  document.set('baseline', nextBaselineBlock);
  fs.writeFileSync(configPath, String(document));
}

/**
 * Validate that a value is an array of non-empty strings.
 * @param {unknown} value
 * @param {string} label
 * @returns {string[]}
 */
function assertStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a list of non-empty strings`);
  }
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`${label} must be a list of non-empty strings`);
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`${label} must be a list of non-empty strings`);
    }
    result.push(trimmed);
  }
  return result;
}

/**
 * Check whether a value is a plain non-array object.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (!value) {
    return false;
  }
  if (typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  return true;
}

/**
 * Validate and canonicalize a BCP 47 locale tag.
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function parseLocaleTag(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  try {
    const canonical = Intl.getCanonicalLocales(trimmed);
    if (canonical.length !== 1) {
      throw new Error(`${label} "${trimmed}" is not a valid BCP 47 locale tag`);
    }
    return canonical[0];
  } catch {
    throw new Error(`${label} "${trimmed}" is not a valid BCP 47 locale tag`);
  }
}

/**
 * Validate a boolean configuration setting.
 * @param {unknown} value
 * @param {string} label
 * @returns {boolean}
 */
function parseBooleanSetting(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be boolean`);
  }
  return value;
}

const TEXT_LENGTH_ALLOWED_KEYS = new Set([
  'max_chars',
  'hard_chars',
  'max_sentences',
  'off',
  'calibration',
  'exclude_containers',
  'protected_paths',
  'protected_names',
]);
const TEXT_LENGTH_LIMIT_KEYS = new Set(['max_chars', 'hard_chars', 'max_sentences']);
const TEXT_LENGTH_STRING_LIST_KEYS = new Set(['exclude_containers', 'protected_paths', 'protected_names']);

/**
 * Compute the default hard character limit: 1.5 times the soft limit, rounded
 * to the nearest 10 (always above small soft limits).
 * @param {number} maxChars
 * @returns {number}
 */
export function defaultHardChars(maxChars) {
  const rounded = Math.round((maxChars * 1.5) / 10) * 10;
  if (rounded >= maxChars) {
    return rounded;
  }
  return Math.ceil(maxChars * 1.5);
}

/**
 * Resolve the active text-length rule for a field occurrence.
 * Specificity order:
 *   1. `<schema>: <definition> / <property>`
 *   2. `<definition> / <property>`
 *   3. `<field>` (bare field-name fallback, unless `skipFallback` is true)
 * A matching rule with `off: true` stops fallback to a less specific key.
 * @param {Record<string, any>} limits
 * @param {{schemaName?: string|null, definition?: string|null, propertyPath?: string|null, field?: string|null, skipFallback?: boolean}} target
 * @returns {{key: string, rule: Record<string, any>}|null}
 */
export function resolveTextLengthRule(limits, target) {
  if (target.definition) {
    if (target.propertyPath) {
      const defPropKey = `${target.definition} / ${target.propertyPath}`;
      if (target.schemaName) {
        const qualifiedKey = `${target.schemaName}: ${defPropKey}`;
        if (Object.hasOwn(limits, qualifiedKey)) {
          return { key: qualifiedKey, rule: limits[qualifiedKey] };
        }
      }
      if (Object.hasOwn(limits, defPropKey)) {
        return { key: defPropKey, rule: limits[defPropKey] };
      }
    }
  }
  if (!target.skipFallback) {
    if (target.field) {
      if (Object.hasOwn(limits, target.field)) {
        return { key: target.field, rule: limits[target.field] };
      }
    }
  }
  return null;
}

/**
 * Validate and normalize one `text_length.<field>` entry.
 * @param {string} field
 * @param {unknown} rawEntry
 * @param {string} source
 * @returns {Record<string, any>}
 */
function parseTextLengthFieldEntry(field, rawEntry, source) {
  if (!isPlainObject(rawEntry)) {
    throw new Error(`text_length.${field} in ${source} must be a limit map`);
  }
  /** @type {Record<string, any>} */
  const normalizedEntry = {};
  for (const [settingKey, settingValue] of Object.entries(rawEntry)) {
    if (!TEXT_LENGTH_ALLOWED_KEYS.has(settingKey)) {
      throw new Error(`text_length.${field}: unknown setting ${settingKey}`);
    }
    if (TEXT_LENGTH_LIMIT_KEYS.has(settingKey)) {
      if (!Number.isSafeInteger(settingValue)) {
        throw new Error(`text_length.${field}.${settingKey} must be a positive integer`);
      }
      if (settingValue < 1) {
        throw new Error(`text_length.${field}.${settingKey} must be a positive integer`);
      }
      normalizedEntry[settingKey] = settingValue;
      continue;
    }
    if (settingKey === 'off') {
      normalizedEntry[settingKey] = parseBooleanSetting(settingValue, `text_length.${field}.off`);
      continue;
    }
    if (settingKey === 'calibration') {
      if (typeof settingValue !== 'string') {
        throw new Error(`text_length.${field}.calibration must be text`);
      }
      normalizedEntry[settingKey] = settingValue;
      continue;
    }
    if (TEXT_LENGTH_STRING_LIST_KEYS.has(settingKey)) {
      normalizedEntry[settingKey] = assertStringArray(settingValue, `text_length.${field}.${settingKey}`);
    }
  }
  return normalizedEntry;
}

/**
 * Merge and validate advisory text limits. Entries may be keyed by bare field name,
 * `<definition> / <property>`, or `<schema>: <definition> / <property>`.
 * Project entries override individual settings. Each active numeric limit derives
 * `hard_chars` as 1.5 times `max_chars` rounded to the nearest 10 unless overridden.
 * @param {any} spec
 * @param {any} config
 * @returns {Record<string, any>}
 */
export function resolveTextLength(spec, config) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const [source, block] of [['spec', spec.text_length], ['project', config.text_length]]) {
    const owner = source === 'spec' ? spec : config;
    if (!Object.hasOwn(owner, 'text_length')) {
      continue;
    }
    if (!isPlainObject(block)) {
      throw new Error(`text_length in ${source} must be a field map`);
    }
    for (const [field, rawEntry] of Object.entries(block)) {
      const normalizedEntry = parseTextLengthFieldEntry(field, rawEntry, source);
      const merged = { ...result[field], ...normalizedEntry, source };
      const hasLimit = merged.max_chars !== undefined || merged.max_sentences !== undefined;
      if (!merged.off) {
        if (!hasLimit) {
          throw new Error(`text_length.${field} needs max_chars or max_sentences`);
        }
      }
      result[field] = merged;
    }
  }
  for (const [field, entry] of Object.entries(result)) {
    if (entry.off) {
      continue;
    }
    if (entry.hard_chars !== undefined) {
      if (entry.max_chars !== undefined) {
        if (entry.hard_chars < entry.max_chars) {
          throw new Error(`text_length.${field}.hard_chars must be at least max_chars`);
        }
      }
      continue;
    }
    if (entry.max_chars !== undefined) {
      entry.hard_chars = defaultHardChars(entry.max_chars);
    }
  }
  return result;
}

const ADVISORY_TOP_ALLOWED_KEYS = new Set(['off', 'locale', 'label_echo', 'filler_phrases', 'protect']);
const LABEL_ECHO_ALLOWED_KEYS = new Set(['off', 'locale', 'label_fields', 'prose_fields']);
const FILLER_PHRASES_ALLOWED_KEYS = new Set(['off', 'locale', 'fields', 'phrases']);
const PROTECT_ALLOWED_KEYS = new Set([
  'quotes',
  'evidence_fields',
  'protected_paths',
  'protected_names',
  'protected_containers',
]);

/**
 * Parse and merge one `text_advisory.label_echo` block.
 * @param {unknown} rawBlock
 * @param {string} layerName
 * @param {{configured: boolean, off: boolean, locale: string|null, labelFields: string[], proseFields: string[]}} current
 */
function parseLabelEchoBlock(rawBlock, layerName, current) {
  if (!isPlainObject(rawBlock)) {
    throw new Error(`text_advisory.label_echo in ${layerName} must be a map`);
  }
  const next = { ...current };
  if (!next.configured) {
    next.off = false;
  }
  next.configured = true;
  for (const [settingKey, settingValue] of Object.entries(rawBlock)) {
    if (!LABEL_ECHO_ALLOWED_KEYS.has(settingKey)) {
      throw new Error(`text_advisory.label_echo: unknown setting ${settingKey}`);
    }
    if (settingKey === 'off') {
      next.off = parseBooleanSetting(settingValue, 'text_advisory.label_echo.off');
    }
    if (settingKey === 'locale') {
      next.locale = parseLocaleTag(settingValue, 'text_advisory.label_echo.locale');
    }
    if (settingKey === 'label_fields') {
      next.labelFields = assertStringArray(settingValue, 'text_advisory.label_echo.label_fields');
    }
    if (settingKey === 'prose_fields') {
      next.proseFields = assertStringArray(settingValue, 'text_advisory.label_echo.prose_fields');
    }
  }
  return next;
}

/**
 * Parse and merge one `text_advisory.filler_phrases` block.
 * @param {unknown} rawBlock
 * @param {string} layerName
 * @param {{configured: boolean, off: boolean, locale: string|null, fields: string[], phrases: Record<string, string[]>}} current
 */
function parseFillerPhrasesBlock(rawBlock, layerName, current) {
  if (!isPlainObject(rawBlock)) {
    throw new Error(`text_advisory.filler_phrases in ${layerName} must be a map`);
  }
  const next = { ...current };
  if (!next.configured) {
    next.off = false;
  }
  next.configured = true;
  for (const [settingKey, settingValue] of Object.entries(rawBlock)) {
    if (!FILLER_PHRASES_ALLOWED_KEYS.has(settingKey)) {
      throw new Error(`text_advisory.filler_phrases: unknown setting ${settingKey}`);
    }
    if (settingKey === 'off') {
      next.off = parseBooleanSetting(settingValue, 'text_advisory.filler_phrases.off');
    }
    if (settingKey === 'locale') {
      next.locale = parseLocaleTag(settingValue, 'text_advisory.filler_phrases.locale');
    }
    if (settingKey === 'fields') {
      next.fields = assertStringArray(settingValue, 'text_advisory.filler_phrases.fields');
    }
    if (settingKey === 'phrases') {
      if (!isPlainObject(settingValue)) {
        throw new Error('text_advisory.filler_phrases.phrases must be a locale map');
      }
      /** @type {Record<string, string[]>} */
      const mergedPhrases = { ...next.phrases };
      for (const [rawLocaleKey, phraseList] of Object.entries(settingValue)) {
        const canonicalLocale = parseLocaleTag(rawLocaleKey, 'text_advisory.filler_phrases.phrases locale key');
        mergedPhrases[canonicalLocale] = assertStringArray(
          phraseList,
          `text_advisory.filler_phrases.phrases.${canonicalLocale}`,
        );
      }
      next.phrases = mergedPhrases;
    }
  }
  return next;
}

/**
 * Parse and merge one `text_advisory.protect` block.
 * @param {unknown} rawBlock
 * @param {string} layerName
 * @param {{quotes: boolean, evidenceFields: string[], protectedPaths: string[], protectedNames: string[], protectedContainers: string[]}} current
 */
function parseProtectBlock(rawBlock, layerName, current) {
  if (!isPlainObject(rawBlock)) {
    throw new Error(`text_advisory.protect in ${layerName} must be a map`);
  }
  const next = { ...current };
  for (const [settingKey, settingValue] of Object.entries(rawBlock)) {
    if (!PROTECT_ALLOWED_KEYS.has(settingKey)) {
      throw new Error(`text_advisory.protect: unknown setting ${settingKey}`);
    }
    if (settingKey === 'quotes') {
      next.quotes = parseBooleanSetting(settingValue, 'text_advisory.protect.quotes');
    }
    if (settingKey === 'evidence_fields') {
      next.evidenceFields = assertStringArray(settingValue, 'text_advisory.protect.evidence_fields');
    }
    if (settingKey === 'protected_paths') {
      next.protectedPaths = assertStringArray(settingValue, 'text_advisory.protect.protected_paths');
    }
    if (settingKey === 'protected_names') {
      next.protectedNames = assertStringArray(settingValue, 'text_advisory.protect.protected_names');
    }
    if (settingKey === 'protected_containers') {
      next.protectedContainers = assertStringArray(settingValue, 'text_advisory.protect.protected_containers');
    }
  }
  return next;
}

/**
 * Merge and validate advisory text checks (`text_advisory`): label-to-prose echo,
 * locale-scoped filler phrases, and deterministic context protection.
 * Returns `null` when neither spec nor project config declares `text_advisory`.
 * @param {any} spec
 * @param {any} config
 */
export function resolveTextAdvisory(spec, config) {
  const hasSpec = Object.hasOwn(spec, 'text_advisory');
  const hasProject = Object.hasOwn(config, 'text_advisory');
  if (!hasSpec) {
    if (!hasProject) {
      return null;
    }
  }

  let source = 'spec';
  let off = false;
  /** @type {string|null} */
  let topLocale = null;

  let labelEcho = {
    configured: false,
    off: true,
    /** @type {string|null} */
    locale: null,
    labelFields: [...DEFAULT_LABEL_FIELDS],
    proseFields: [...DEFAULT_ECHO_PROSE_FIELDS],
  };

  let fillerPhrases = {
    configured: false,
    off: true,
    /** @type {string|null} */
    locale: null,
    fields: [...DEFAULT_FILLER_FIELDS],
    /** @type {Record<string, string[]>} */
    phrases: {},
  };

  let protect = {
    quotes: true,
    evidenceFields: [...DEFAULT_EVIDENCE_FIELDS],
    /** @type {string[]} */
    protectedPaths: [],
    /** @type {string[]} */
    protectedNames: [],
    /** @type {string[]} */
    protectedContainers: [],
  };

  const layers = [
    ['spec', spec, hasSpec],
    ['project', config, hasProject],
  ];

  for (const [layerName, owner, present] of layers) {
    if (!present) {
      continue;
    }
    const block = owner.text_advisory;
    if (!isPlainObject(block)) {
      throw new Error(`text_advisory in ${layerName} must be a map`);
    }
    source = String(layerName);

    for (const [settingKey, settingValue] of Object.entries(block)) {
      if (!ADVISORY_TOP_ALLOWED_KEYS.has(settingKey)) {
        throw new Error(`text_advisory: unknown setting ${settingKey}`);
      }
      if (settingKey === 'off') {
        off = parseBooleanSetting(settingValue, 'text_advisory.off');
      }
      if (settingKey === 'locale') {
        topLocale = parseLocaleTag(settingValue, 'text_advisory.locale');
      }
      if (settingKey === 'label_echo') {
        labelEcho = parseLabelEchoBlock(settingValue, source, labelEcho);
      }
      if (settingKey === 'filler_phrases') {
        fillerPhrases = parseFillerPhrasesBlock(settingValue, source, fillerPhrases);
      }
      if (settingKey === 'protect') {
        protect = parseProtectBlock(settingValue, source, protect);
      }
    }
  }

  const effectiveEchoLocale = labelEcho.locale ?? topLocale ?? 'en';
  if (!off) {
    if (!labelEcho.off) {
      if (!SUPPORTED_ECHO_LOCALES.includes(effectiveEchoLocale)) {
        throw new Error(
          `text_advisory.label_echo.locale "${effectiveEchoLocale}" is not supported (supported: ${SUPPORTED_ECHO_LOCALES.join(', ')})`,
        );
      }
    }
  }

  const effectiveFillerLocale = fillerPhrases.locale ?? topLocale;
  const hasAnyPhrases = Object.keys(fillerPhrases.phrases).length > 0;
  if (!off) {
    if (!fillerPhrases.off) {
      if (hasAnyPhrases) {
        if (!effectiveFillerLocale) {
          throw new Error('text_advisory.filler_phrases requires an explicit locale');
        }
      }
    }
  }

  return {
    source,
    off,
    locale: topLocale,
    labelEcho: {
      off: labelEcho.off,
      locale: effectiveEchoLocale,
      labelFields: labelEcho.labelFields,
      proseFields: labelEcho.proseFields,
    },
    fillerPhrases: {
      off: fillerPhrases.off,
      locale: effectiveFillerLocale,
      fields: fillerPhrases.fields,
      phrases: fillerPhrases.phrases,
    },
    protect,
  };
}
