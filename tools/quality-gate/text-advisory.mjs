// @ts-check
/**
 * Advisory text checks: label-to-prose echo and locale-scoped filler phrases.
 *
 * All signals here are strictly advisory. They never alter coverage metrics,
 * baselines, verdicts or strict exit codes, and they keep the scored checker
 * in `heuristics.mjs` intact.
 */

import { echoesSubject } from './heuristics.mjs';
import { nameOf, typedIdOf } from './collect.mjs';

export const SUPPORTED_ECHO_LOCALES = ['en', 'pl'];

export const DEFAULT_LABEL_FIELDS = ['name', 'title'];
export const DEFAULT_ECHO_PROSE_FIELDS = ['description', 'summary'];
export const DEFAULT_FILLER_FIELDS = ['description', 'summary', 'rationale', 'context', 'statement', 'note'];
export const DEFAULT_EVIDENCE_FIELDS = [
  'evidence',
  'quotes',
  'quote',
  'excerpt',
  'excerpts',
  'citation',
  'citations',
  'source_text',
  'verbatim',
  'transcript',
  'attribution',
];

const ASCII_ONLY_RE = /^[\x00-\x7F]*$/;
const UNICODE_WORD_RE = /[\p{L}\p{N}\p{M}]+/gu;
const WORD_CHAR_CLASS = '[\\p{L}\\p{N}\\p{M}_]';
const STARTS_WITH_WORD_RE = /^[\p{L}\p{N}\p{M}_]/u;
const ENDS_WITH_WORD_RE = /[\p{L}\p{N}\p{M}_]$/u;

const TOP_LEVEL_ENTITY_CONTAINERS = new Set([
  'operations',
  'errors',
  'concepts',
  'actors',
  'enumerations',
  'structural',
  'classification',
  'derivation',
  'equivalence',
  'validation',
  'transition',
  'user_stories',
  'processes',
  'stories',
  'use_cases',
  'happy_path',
  'edge_cases',
  'error_cases',
  'fitness_functions',
  'decisions',
  'risks',
]);

/**
 * @typedef {object} LabelEchoEntityFinding
 * @property {'label-echo'} signal
 * @property {string} field
 * @property {string} path
 * @property {string} labelField
 * @property {string} label
 * @property {string} locale
 */

/**
 * @typedef {object} FillerPhraseEntityFinding
 * @property {'filler-phrase'} signal
 * @property {string} field
 * @property {string} path
 * @property {string} phrase
 * @property {string} locale
 */

/**
 * @typedef {LabelEchoEntityFinding | FillerPhraseEntityFinding} EntityTextAdvisoryFinding
 */

/**
 * @typedef {LabelEchoEntityFinding & {entityId: string|null, entityName: string, file: string}} LabelEchoSummaryFinding
 */

/**
 * @typedef {FillerPhraseEntityFinding & {entityId: string|null, entityName: string, file: string}} FillerPhraseSummaryFinding
 */

/**
 * @typedef {LabelEchoSummaryFinding | FillerPhraseSummaryFinding} TextAdvisoryFinding
 */

/**
 * @typedef {object} TextAdvisoryOwner
 * @property {string} file
 * @property {string} name
 * @property {string} [entityId]
 * @property {EntityTextAdvisoryFinding[]} [textAdvisory]
 */

const EN_STOP_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'it', 'its', 'and', 'or',
  'field', 'fields', 'property', 'properties', 'attribute', 'attributes',
  'value', 'values', 'object', 'entity', 'item', 'items',
  'holds', 'contains', 'represents', 'stores', 'indicates', 'specifies',
  'event', 'events', 'command', 'commands', 'operation', 'operations',
  'query', 'queries', 'rule', 'rules', 'decision', 'decisions',
  'risk', 'risks', 'story', 'stories', 'concept', 'concepts', 'actor', 'actors',
  'model', 'models', 'schema', 'schemas', 'payload', 'payloads',
  'request', 'requests', 'response', 'responses', 'record', 'records',
  'identifier', 'identifiers', 'data', 'info', 'information', 'detail', 'details',
  'flag', 'flags', 'list', 'lists', 'name', 'names', 'description', 'descriptions',
  'type', 'types', 'status', 'state', 'step', 'steps', 'case', 'cases', 'test', 'tests',
]);

const PL_STOP_WORDS = new Set([
  'to', 'ten', 'ta', 'te', 'tym', 'tej', 'tych',
  'jest', 'są', 'był', 'była', 'było', 'być', 'będzie',
  'w', 'we', 'z', 'ze', 'na', 'do', 'od', 'po', 'za', 'dla', 'o', 'u', 'przy', 'przez',
  'i', 'oraz', 'lub', 'albo', 'który', 'która', 'które', 'których',
  'pole', 'pola', 'wartość', 'wartości', 'atrybut', 'atrybuty',
  'obiekt', 'encja', 'element', 'elementy', 'pozycja', 'pozycje',
  'opis', 'nazwa', 'tytuł', 'typ', 'status', 'stan', 'flaga', 'lista',
  'zdarzenie', 'zdarzenia', 'komenda', 'komendy', 'operacja', 'operacje',
  'zapytanie', 'zapytania', 'reguła', 'reguły', 'decyzja', 'decyzje',
  'ryzyko', 'ryzyka', 'koncept', 'aktor', 'model', 'schemat', 'rekord',
  'dane', 'informacja', 'informacje', 'szczegóły', 'identyfikator',
  'zawiera', 'przechowuje', 'reprezentuje', 'określa', 'wskazuje', 'oznacza',
]);

const NEGATION_WORDS = {
  en: new Set(['not', 'no', 'never', 'without', 'cannot', 'neither', 'nor', 'none', 'non']),
  pl: new Set(['nie', 'bez', 'brak', 'nigdy', 'ani', 'żaden', 'żadna', 'żadne', 'żadnych', 'nikt', 'nic']),
};

/**
 * Escape a document path segment using JSON Pointer escaping.
 * @param {string} segment
 * @returns {string}
 */
export function escapePointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Format document path segments as a slash-separated pointer path.
 * @param {string[]} segments
 * @returns {string}
 */
export function formatPointerPath(segments) {
  return segments.map(escapePointerSegment).join('/');
}

/**
 * Replace deterministically identifiable quoted spans and blockquote lines with
 * a separator so quoted evidence does not trigger filler phrase matches.
 * @param {string} text
 * @returns {string}
 */
export function stripQuotedSpans(text) {
  return String(text)
    .replace(/^\s*>.*$/gm, ' \u0000 ')
    .replace(/„[^”]+”/g, ' \u0000 ')
    .replace(/“[^”]+”/g, ' \u0000 ')
    .replace(/«[^»]+»/g, ' \u0000 ')
    .replace(/"[^"]+"/g, ' \u0000 ');
}

/**
 * Return true when trimmed text consists entirely of a quoted span or blockquote.
 * @param {string} text
 * @returns {boolean}
 */
export function isEntirelyQuoted(text) {
  const trimmed = String(text).trim();
  if (trimmed.length === 0) {
    return false;
  }
  const stripped = stripQuotedSpans(trimmed).replace(/\u0000/g, '').trim();
  return stripped.length === 0;
}

/**
 * Tokenize Unicode text into lowercase words while preserving diacritics.
 * @param {string} text
 * @param {string} locale
 * @returns {string[]}
 */
export function splitUnicodeWords(text, locale) {
  const normalized = String(text)
    .normalize('NFC')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2');
  const matches = normalized.match(UNICODE_WORD_RE);
  if (!matches) {
    return [];
  }
  return matches.map((word) => word.toLocaleLowerCase(locale));
}

/**
 * Check whether two token lists differ in negation markers.
 * @param {string[]} proseWords
 * @param {string[]} labelWords
 * @param {string} locale
 * @returns {boolean}
 */
function hasNegationMismatch(proseWords, labelWords, locale) {
  const negations = NEGATION_WORDS[locale];
  if (!negations) {
    return false;
  }
  const proseHasNegation = proseWords.some((word) => negations.has(word));
  const labelHasNegation = labelWords.some((word) => negations.has(word));
  return proseHasNegation !== labelHasNegation;
}

/**
 * Advisory check: return true when `prose` merely echoes `label` for the given locale.
 *
 * Uses `echoesSubject` from `heuristics.mjs` only for ASCII-only English inputs,
 * combined with a negation-asymmetry guard. Uses Unicode-aware tokenization and
 * locale-specific stop words for Polish and non-ASCII inputs.
 *
 * @param {string} prose
 * @param {string} label
 * @param {string} locale
 * @returns {boolean}
 */
export function echoesLabelAdvisory(prose, label, locale) {
  const trimmedProse = String(prose).trim();
  const trimmedLabel = String(label).trim();
  if (trimmedProse.length === 0) {
    return false;
  }
  if (trimmedLabel.length === 0) {
    return false;
  }

  const proseWords = splitUnicodeWords(trimmedProse, locale);
  const labelWords = splitUnicodeWords(trimmedLabel, locale);
  if (proseWords.length === 0) {
    return false;
  }
  if (labelWords.length === 0) {
    return false;
  }
  if (hasNegationMismatch(proseWords, labelWords, locale)) {
    return false;
  }

  const isEnglish = locale === 'en';
  const proseIsAscii = ASCII_ONLY_RE.test(trimmedProse);
  const labelIsAscii = ASCII_ONLY_RE.test(trimmedLabel);
  if (isEnglish) {
    if (proseIsAscii) {
      if (labelIsAscii) {
        return echoesSubject(trimmedProse, trimmedLabel);
      }
    }
  }

  const stopWords = locale === 'pl' ? PL_STOP_WORDS : EN_STOP_WORDS;
  const proseSignificant = proseWords.filter((word) => !stopWords.has(word));
  if (proseSignificant.length === 0) {
    return true;
  }
  const labelSignificant = new Set(labelWords.filter((word) => !stopWords.has(word)));
  if (labelSignificant.size === 0) {
    return false;
  }
  return proseSignificant.every((word) => labelSignificant.has(word));
}

/**
 * Escape a literal string for use inside a RegExp.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a Unicode word-boundary matcher for a configured phrase.
 * @param {string} phrase
 * @param {string} locale
 * @returns {{phrase: string, pattern: RegExp}}
 */
function compilePhraseMatcher(phrase, locale) {
  const normalized = String(phrase).normalize('NFC').trim().toLocaleLowerCase(locale);
  const parts = normalized.split(/\s+/).map(escapeRegExp);
  const body = parts.join('\\s+');
  const prefix = STARTS_WITH_WORD_RE.test(normalized) ? `(?<!${WORD_CHAR_CLASS})` : '';
  const suffix = ENDS_WITH_WORD_RE.test(normalized) ? `(?!${WORD_CHAR_CLASS})` : '';
  return {
    phrase,
    pattern: new RegExp(`${prefix}${body}${suffix}`, 'gu'),
  };
}

/**
 * Find all configured phrases matching at Unicode word boundaries in `text`.
 * @param {string} text
 * @param {string[]} phrases
 * @param {string} locale
 * @param {{protectQuotes?: boolean}} [options]
 * @returns {string[]}
 */
export function matchFillerPhrases(text, phrases, locale, options = {}) {
  if (phrases.length === 0) {
    return [];
  }
  const protectQuotes = options.protectQuotes !== false;
  const prepared = protectQuotes ? stripQuotedSpans(text) : String(text);
  const searchable = prepared.normalize('NFC').toLocaleLowerCase(locale);
  /** @type {string[]} */
  const matched = [];
  for (const phrase of phrases) {
    const matcher = compilePhraseMatcher(phrase, locale);
    if (matcher.pattern.test(searchable)) {
      matched.push(phrase);
    }
  }
  return matched;
}

/**
 * Check whether a document path matches any configured protected path (exact or segment prefix).
 * @param {string} pointerPath
 * @param {string[]} protectedPaths
 * @returns {boolean}
 */
export function isProtectedPath(pointerPath, protectedPaths) {
  for (const candidate of protectedPaths) {
    if (pointerPath === candidate) {
      return true;
    }
    if (pointerPath.startsWith(`${candidate}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether any path segment belongs to a protected set (evidence fields or containers).
 * @param {string[]} segments
 * @param {Set<string>} protectedSegments
 * @returns {boolean}
 */
function hasProtectedSegment(segments, protectedSegments) {
  for (const segment of segments) {
    if (protectedSegments.has(segment)) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether a string matches a configured protected proper name or official title.
 * @param {string} value
 * @param {Set<string>} protectedNames
 * @returns {boolean}
 */
function isProtectedName(value, protectedNames) {
  if (protectedNames.size === 0) {
    return false;
  }
  const normalized = String(value).normalize('NFC').trim().toLowerCase();
  return protectedNames.has(normalized);
}

/**
 * Return true when `segments` points to a collector location where ID-less
 * entities are declared by name.
 * @param {string[]} segments
 * @returns {boolean}
 */
function isNamedCollectorLocation(segments) {
  if (segments.length === 2) {
    return TOP_LEVEL_ENTITY_CONTAINERS.has(segments[0]);
  }
  if (segments.length === 3) {
    if (segments[0] === 'components') {
      return segments[1] === 'schemas';
    }
    return false;
  }
  if (segments.length === 4) {
    const isStoryContainer = segments[0] === 'processes' || segments[0] === 'stories';
    if (isStoryContainer) {
      return segments[2] === 'activities';
    }
    return false;
  }
  return false;
}

/**
 * Resolve the owning entity for a visited object node. Typed IDs match anywhere;
 * name-only entities match only at collector record locations.
 * @param {any} node
 * @param {string[]} segments
 * @param {string|undefined} key
 * @param {TextAdvisoryOwner|undefined} currentOwner
 * @param {Map<string, TextAdvisoryOwner>} byId
 * @param {Map<string, TextAdvisoryOwner>} byName
 * @returns {TextAdvisoryOwner|undefined}
 */
function resolveNodeOwner(node, segments, key, currentOwner, byId, byName) {
  if (Array.isArray(node)) {
    return currentOwner;
  }
  const id = typedIdOf(node.id) ?? typedIdOf(node['x-model-id']);
  if (id) {
    const matchedById = byId.get(id);
    if (matchedById) {
      return matchedById;
    }
  }
  if (isNamedCollectorLocation(segments)) {
    const isSchemaLocation = segments.length === 3
      && segments[0] === 'components'
      && segments[1] === 'schemas';
    const candidateName = isSchemaLocation
      ? String(key ?? node['x-model-id'] ?? '(schema)')
      : String(nameOf(node, key));
    const matchedByName = byName.get(candidateName);
    if (matchedByName) {
      return matchedByName;
    }
  }
  return currentOwner;
}

/**
 * Collect trimmed non-empty label entries present directly on a record object.
 * @param {any} node
 * @param {string[]} labelFields
 * @returns {Array<{field: string, value: string}>}
 */
function collectRecordLabels(node, labelFields) {
  /** @type {Array<{field: string, value: string}>} */
  const recordLabels = [];
  if (Array.isArray(node)) {
    return recordLabels;
  }
  for (const labelField of labelFields) {
    const labelValue = node[labelField];
    if (typeof labelValue === 'string') {
      const trimmedLabel = labelValue.trim();
      if (trimmedLabel.length > 0) {
        recordLabels.push({ field: labelField, value: trimmedLabel });
      }
    }
  }
  return recordLabels;
}

/**
 * Record one typed advisory finding on both the owning entity and the run summary.
 * @param {TextAdvisoryOwner} owner
 * @param {string} file
 * @param {EntityTextAdvisoryFinding} entityFinding
 * @param {TextAdvisoryFinding[]} summaryFindings
 */
function recordAdvisoryFinding(owner, file, entityFinding, summaryFindings) {
  if (!owner.textAdvisory) {
    owner.textAdvisory = [];
  }
  owner.textAdvisory.push(entityFinding);
  summaryFindings.push({
    ...entityFinding,
    entityId: owner.entityId ?? null,
    entityName: owner.name,
    file,
  });
}

/**
 * Check whether a string field triggers a label-echo advisory finding.
 * @param {object} input
 * @param {string} input.field
 * @param {string} input.trimmedValue
 * @param {string} input.pointerPath
 * @param {boolean} input.pathProtected
 * @param {Array<{field: string, value: string}>} input.recordLabels
 * @param {TextAdvisoryOwner} input.owner
 * @param {string} input.file
 * @param {{labelEchoEnabled: boolean, echoLocale: string, echoProseFields: Set<string>, protectedNames: Set<string>, protectQuotes: boolean}} input.context
 * @param {{labelEcho: {measured: number, matches: number, protected: number}, findings: TextAdvisoryFinding[]}} input.summary
 */
function evaluateLabelEchoField({
  field,
  trimmedValue,
  pointerPath,
  pathProtected,
  recordLabels,
  owner,
  file,
  context,
  summary,
}) {
  if (!context.labelEchoEnabled) {
    return;
  }
  if (!context.echoProseFields.has(field)) {
    return;
  }
  if (recordLabels.length === 0) {
    return;
  }
  const valueProtected = pathProtected
    || isProtectedName(trimmedValue, context.protectedNames)
    || (context.protectQuotes && isEntirelyQuoted(trimmedValue));
  if (valueProtected) {
    summary.labelEcho.protected++;
    return;
  }
  summary.labelEcho.measured++;
  for (const labelEntry of recordLabels) {
    if (isProtectedName(labelEntry.value, context.protectedNames)) {
      summary.labelEcho.protected++;
      continue;
    }
    if (echoesLabelAdvisory(trimmedValue, labelEntry.value, context.echoLocale)) {
      summary.labelEcho.matches++;
      /** @type {LabelEchoEntityFinding} */
      const entityFinding = {
        signal: 'label-echo',
        field,
        path: pointerPath,
        labelField: labelEntry.field,
        label: labelEntry.value,
        locale: context.echoLocale,
      };
      recordAdvisoryFinding(owner, file, entityFinding, summary.findings);
      break;
    }
  }
}

/**
 * Check whether a string field triggers locale-scoped filler-phrase findings.
 * @param {object} input
 * @param {string} input.field
 * @param {string} input.trimmedValue
 * @param {string} input.pointerPath
 * @param {boolean} input.pathProtected
 * @param {TextAdvisoryOwner} input.owner
 * @param {string} input.file
 * @param {{fillerEnabled: boolean, fillerLocale: string|null, fillerFields: Set<string>, compiledPhrases: Array<{phrase: string, pattern: RegExp}>, protectedNames: Set<string>, protectQuotes: boolean}} input.context
 * @param {{fillerPhrases: {measured: number, matches: number, protected: number}, findings: TextAdvisoryFinding[]}} input.summary
 */
function evaluateFillerPhraseField({
  field,
  trimmedValue,
  pointerPath,
  pathProtected,
  owner,
  file,
  context,
  summary,
}) {
  if (!context.fillerEnabled) {
    return;
  }
  if (!context.fillerFields.has(field)) {
    return;
  }
  if (context.compiledPhrases.length === 0) {
    return;
  }
  if (!context.fillerLocale) {
    return;
  }
  const valueProtected = pathProtected
    || isProtectedName(trimmedValue, context.protectedNames);
  if (valueProtected) {
    summary.fillerPhrases.protected++;
    return;
  }
  summary.fillerPhrases.measured++;
  const prepared = context.protectQuotes ? stripQuotedSpans(trimmedValue) : trimmedValue;
  const searchable = prepared.normalize('NFC').toLocaleLowerCase(context.fillerLocale);
  for (const matcher of context.compiledPhrases) {
    matcher.pattern.lastIndex = 0;
    if (matcher.pattern.test(searchable)) {
      summary.fillerPhrases.matches++;
      /** @type {FillerPhraseEntityFinding} */
      const entityFinding = {
        signal: 'filler-phrase',
        field,
        path: pointerPath,
        phrase: matcher.phrase,
        locale: context.fillerLocale,
      };
      recordAdvisoryFinding(owner, file, entityFinding, summary.findings);
    }
  }
}

/**
 * Traverse one parsed YAML document and dispatch string fields to advisory matchers.
 * @param {object} input
 * @param {string} input.file
 * @param {any} input.doc
 * @param {Map<string, TextAdvisoryOwner>} input.byId
 * @param {Map<string, TextAdvisoryOwner>} input.byName
 * @param {any} input.context
 * @param {any} input.summary
 */
function walkAdvisoryDocument({ file, doc, byId, byName, context, summary }) {
  const ancestors = new Set();

  /**
   * @param {any} node
   * @param {string[]} segments
   * @param {TextAdvisoryOwner|undefined} owner
   * @param {string|undefined} key
   */
  const visit = (node, segments, owner, key) => {
    if (!node) {
      return;
    }
    if (typeof node !== 'object') {
      return;
    }
    if (ancestors.has(node)) {
      return;
    }
    ancestors.add(node);

    const currentOwner = resolveNodeOwner(node, segments, key, owner, byId, byName);
    const recordLabels = collectRecordLabels(node, context.labelFields);

    for (const [field, value] of Object.entries(node)) {
      const pointer = [...segments, field];
      if (currentOwner) {
        if (typeof value === 'string') {
          const trimmedValue = value.trim();
          if (trimmedValue.length > 0) {
            const pointerPath = formatPointerPath(pointer);
            const pathProtected = hasProtectedSegment(pointer, context.evidenceFields)
              || hasProtectedSegment(pointer, context.protectedContainers)
              || isProtectedPath(pointerPath, context.protectedPaths);
            evaluateLabelEchoField({
              field,
              trimmedValue,
              pointerPath,
              pathProtected,
              recordLabels,
              owner: currentOwner,
              file,
              context,
              summary,
            });
            evaluateFillerPhraseField({
              field,
              trimmedValue,
              pointerPath,
              pathProtected,
              owner: currentOwner,
              file,
              context,
              summary,
            });
          }
        }
      }

      const childKey = Array.isArray(node) ? undefined : field;
      visit(value, pointer, currentOwner, childKey);
    }

    ancestors.delete(node);
  };

  visit(doc, [], undefined, undefined);
}

/**
 * Measure advisory label-echo and locale-scoped filler-phrase signals across
 * the observed entities' source documents.
 *
 * @param {object} input
 * @param {Array<{file: string, doc: any}>} input.documents
 * @param {Array<TextAdvisoryOwner>} input.entities
 * @param {any} input.advisory resolved advisory config from `resolveTextAdvisory`
 */
export function measureTextAdvisory({ documents, entities, advisory }) {
  /** @type {Map<string, Array<TextAdvisoryOwner>>} */
  const byFile = new Map();
  for (const entity of entities) {
    entity.textAdvisory = [];
    const bucket = byFile.get(entity.file) ?? [];
    bucket.push(entity);
    byFile.set(entity.file, bucket);
  }

  const labelEchoEnabled = !advisory.off && !advisory.labelEcho.off;
  const fillerEnabled = !advisory.off && !advisory.fillerPhrases.off;
  const echoLocale = advisory.labelEcho.locale;
  const fillerLocale = advisory.fillerPhrases.locale;
  const phraseBook = new Map(Object.entries(advisory.fillerPhrases.phrases ?? {}));
  const fillerPhrasesList = fillerLocale ? (phraseBook.get(fillerLocale) ?? []) : [];
  const compiledPhrases = fillerEnabled && fillerLocale
    ? fillerPhrasesList.map((phrase) => compilePhraseMatcher(phrase, fillerLocale))
    : [];

  const context = {
    labelEchoEnabled,
    fillerEnabled,
    echoLocale,
    fillerLocale,
    compiledPhrases,
    labelFields: advisory.labelEcho.labelFields,
    echoProseFields: new Set(advisory.labelEcho.proseFields),
    fillerFields: new Set(advisory.fillerPhrases.fields),
    evidenceFields: new Set(advisory.protect.evidenceFields),
    protectedContainers: new Set(advisory.protect.protectedContainers),
    protectedPaths: advisory.protect.protectedPaths,
    protectedNames: new Set(
      advisory.protect.protectedNames.map((entry) => String(entry).normalize('NFC').trim().toLowerCase()),
    ),
    protectQuotes: advisory.protect.quotes,
  };

  const summary = {
    config: {
      source: advisory.source,
      off: advisory.off,
      locale: advisory.locale,
      labelEcho: {
        off: !labelEchoEnabled,
        locale: echoLocale,
        labelFields: [...context.labelFields],
        proseFields: [...advisory.labelEcho.proseFields],
      },
      fillerPhrases: {
        off: !fillerEnabled,
        locale: fillerLocale,
        fields: [...advisory.fillerPhrases.fields],
        phraseCount: fillerPhrasesList.length,
      },
      protect: {
        quotes: context.protectQuotes,
        evidenceFields: [...advisory.protect.evidenceFields],
        protectedPaths: [...context.protectedPaths],
        protectedNames: [...advisory.protect.protectedNames],
        protectedContainers: [...advisory.protect.protectedContainers],
      },
    },
    labelEcho: {
      measured: 0,
      matches: 0,
      protected: 0,
    },
    fillerPhrases: {
      locale: fillerLocale,
      measured: 0,
      matches: 0,
      protected: 0,
    },
    /** @type {TextAdvisoryFinding[]} */
    findings: [],
  };

  if (advisory.off) {
    return summary;
  }

  for (const { file, doc } of documents) {
    const candidates = byFile.get(file) ?? [];
    /** @type {Map<string, TextAdvisoryOwner>} */
    const byId = new Map();
    /** @type {Map<string, TextAdvisoryOwner>} */
    const byName = new Map();
    for (const entity of candidates) {
      if (entity.entityId) {
        byId.set(entity.entityId, entity);
      } else if (!byName.has(entity.name)) {
        byName.set(entity.name, entity);
      }
    }
    walkAdvisoryDocument({ file, doc, byId, byName, context, summary });
  }

  return summary;
}
