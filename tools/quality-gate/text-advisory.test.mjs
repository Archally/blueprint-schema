// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import * as config from './config.mjs';
import * as structure from './structure.mjs';
import * as textAdvisory from './text-advisory.mjs';

const CLI_PATH = fileURLToPath(new URL('./cli.mjs', import.meta.url));

const PILOT_PHRASES = {
  en: [
    'it is useful to point out that',
    'it bears mentioning that',
    'one thing to mention is that',
  ],
  pl: [
    'warto tu zaznaczyć, że',
    'należy w tym miejscu wspomnieć, że',
    'trzeba przy tym zauważyć, że',
  ],
};

describe('name and title length overrides with deterministic protection', () => {
  test('measures Unicode boundaries on name and title while protecting official titles and rule statements', () => {
    const file = '/fixture/domain.yaml';
    const entities = [
      { key: `${file}\u0000CN001`, entityId: 'CN001', name: 'Concept', file },
      { key: `${file}\u0000VR001`, entityId: 'VR001', name: 'Rule', file },
    ];
    const documents = [
      {
        file,
        doc: {
          concepts: [
            {
              id: 'CN001',
              name: 'Żółć123456',
              title: 'General Data Protection Regulation (EU) 2016/679',
              attributes: [
                {
                  id: 'CAT001',
                  name: 'Żółć1234567',
                  description: 'Nested attribute with a name one code point above limit.',
                },
              ],
            },
          ],
          validation: [
            {
              id: 'VR001',
              name: 'Automatic renewals above fifty seats require written finance approval before billing.',
              description: 'Rule statement expressed directly in name.',
            },
          ],
        },
      },
    ];

    const limits = config.resolveTextLength(
      {},
      {
        text_length: {
          name: {
            max_chars: 10,
            exclude_containers: ['validation'],
          },
          title: {
            max_chars: 20,
            protected_names: ['General Data Protection Regulation (EU) 2016/679'],
          },
        },
      },
    );

    const measured = structure.measureTextLength({ documents, entities, limits });
    assert.equal(measured.fields.name.source, 'project');
    assert.equal(measured.fields.name.measured, 2);
    assert.equal(measured.fields.name.overLimit, 1);
    assert.equal(entities[0].textLength.length, 1);
    assert.equal(entities[0].textLength[0].field, 'name');
    assert.equal(entities[0].textLength[0].path, 'concepts/0/attributes/0/name');
    assert.equal(entities[0].textLength[0].length, 11);
    assert.equal(entities[0].textLength[0].limit, 10);
    assert.equal(measured.fields.title.measured, 0);
    assert.equal(measured.fields.title.overLimit, 0);
    assert.deepEqual(entities[1].textLength, []);
  });

  test('rejects invalid protection settings on text_length', () => {
    for (const bad of [
      { name: { max_chars: 20, exclude_containers: 'validation' } },
      { name: { max_chars: 20, protected_paths: [''] } },
      { name: { max_chars: 20, protected_names: [42] } },
    ]) {
      assert.throws(() => config.resolveTextLength({}, { text_length: bad }), /text_length/);
    }
  });

  test('stores trimmed protected lists and matches exact path, descendant, not similarly named sibling', () => {
    const file = '/fixture/paths.yaml';
    const entities = [
      { key: `${file}\u0000CMD001`, entityId: 'CMD001', name: 'Exact', file },
      { key: `${file}\u0000CMD002`, entityId: 'CMD002', name: 'Parent', file },
      { key: `${file}\u0000CMD003`, entityId: 'CMD003', name: 'Sibling', file },
    ];
    const documents = [
      {
        file,
        doc: {
          operations: {
            exactTarget: {
              id: 'CMD001',
              name: 'Exact protected path name exceeding limit',
            },
            issueInvoice: {
              id: 'CMD002',
              name: 'Short',
              details: {
                name: 'Descendant protected path name exceeding limit',
              },
            },
            issueInvoiceExtra: {
              id: 'CMD003',
              name: 'Sibling path name exceeding limit',
            },
          },
        },
      },
    ];

    const limits = config.resolveTextLength(
      {},
      {
        text_length: {
          name: {
            max_chars: 10,
            exclude_containers: [' validation '],
            protected_paths: [' operations/exactTarget/name ', ' operations/issueInvoice '],
            protected_names: [' Official Title '],
          },
        },
      },
    );

    assert.deepEqual(limits.name.exclude_containers, ['validation']);
    assert.deepEqual(limits.name.protected_paths, ['operations/exactTarget/name', 'operations/issueInvoice']);
    assert.deepEqual(limits.name.protected_names, ['Official Title']);

    const measured = structure.measureTextLength({ documents, entities, limits });
    assert.equal(measured.fields.name.measured, 1);
    assert.equal(measured.fields.name.overLimit, 1);
    assert.deepEqual(entities[0].textLength, []);
    assert.deepEqual(entities[1].textLength, []);
    assert.equal(entities[2].textLength.length, 1);
    assert.equal(entities[2].textLength[0].path, 'operations/issueInvoiceExtra/name');
  });
});

describe('advisory label-to-prose echo (Unicode, Polish diacritics and negation)', () => {
  test('flags English ASCII echoes and guards substantive prose and negation', () => {
    assert.equal(textAdvisory.echoesLabelAdvisory('The order status field.', 'Order Status', 'en'), true);
    assert.equal(textAdvisory.echoesLabelAdvisory('Tracks fulfillment lifecycle state.', 'Order Status', 'en'), false);
    assert.equal(textAdvisory.echoesLabelAdvisory('Not the order status.', 'Order Status', 'en'), false);
    assert.equal(textAdvisory.echoesLabelAdvisory('Order status.', 'No Order Status', 'en'), false);
  });

  test('flags accented Polish echoes while preserving diacritics and negation', () => {
    assert.equal(textAdvisory.echoesLabelAdvisory('Pole żądanie płatności.', 'Żądanie płatności', 'pl'), true);
    assert.equal(textAdvisory.echoesLabelAdvisory('To jest błąd autoryzacji.', 'Błąd autoryzacji', 'pl'), true);

    assert.equal(textAdvisory.echoesLabelAdvisory('Sad.', 'Sąd', 'pl'), false);
    assert.equal(textAdvisory.echoesLabelAdvisory('Laska.', 'Łaska', 'pl'), false);
    assert.equal(textAdvisory.echoesLabelAdvisory('Blad.', 'Błąd', 'pl'), false);

    assert.equal(textAdvisory.echoesLabelAdvisory('Nie jest to żądanie płatności.', 'Żądanie płatności', 'pl'), false);
    assert.equal(textAdvisory.echoesLabelAdvisory('Dotyczy płatności.', 'Nie dotyczy płatności', 'pl'), false);
    assert.equal(
      textAdvisory.echoesLabelAdvisory('Żądanie płatności inicjuje przelew po zatwierdzeniu faktury.', 'Żądanie płatności', 'pl'),
      false,
    );

    assert.deepEqual(textAdvisory.splitUnicodeWords('UsługaŻądania', 'pl'), ['usługa', 'żądania']);
    assert.equal(textAdvisory.echoesLabelAdvisory('Usługa żądania.', 'UsługaŻądania', 'pl'), true);
    assert.equal(textAdvisory.echoesLabelAdvisory('Żądanie płatności.', 'ŻĄDANIEPłatności', 'pl'), true);
    assert.equal(
      textAdvisory.echoesLabelAdvisory('Usługa żądania.', 'Us\u0142ugaZ\u0307a\u0328dania', 'pl'),
      true,
    );
  });

  test('pairs labels strictly with the same record object, never with parent labels', () => {
    const file = '/fixture/concepts.yaml';
    const entities = [
      { key: `${file}\u0000CN001`, entityId: 'CN001', name: 'Order', file },
    ];
    const documents = [
      {
        file,
        doc: {
          concepts: [
            {
              id: 'CN001',
              name: 'Order',
              description: 'Commercial agreement created when checkout finishes.',
              attributes: [
                {
                  id: 'CAT001',
                  name: 'Total Amount',
                  description: 'The total amount value.',
                },
                {
                  id: 'CAT002',
                  name: 'Currency',
                  description: 'Order.',
                },
              ],
              details: {
                description: 'Order.',
              },
            },
          ],
        },
      },
    ];
    const advisory = config.resolveTextAdvisory(
      {},
      {
        text_advisory: {
          locale: 'en',
          label_echo: {},
        },
      },
    );

    const result = textAdvisory.measureTextAdvisory({ documents, entities, advisory });
    assert.equal(result.labelEcho.matches, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].signal, 'label-echo');
    assert.equal(result.findings[0].path, 'concepts/0/attributes/0/description');
    assert.equal(result.findings[0].labelField, 'name');
    assert.equal(result.findings[0].label, 'Total Amount');
  });

  test('resolves name-only owners only at collector locations and avoids same-name property collisions', () => {
    const file = '/fixture/models.yaml';
    const entities = [
      { key: `${file}\u0000billing.MDL001`, entityId: 'billing.MDL001', name: 'Order', file },
      { key: `${file}\u0000#Invoice`, entityId: undefined, name: 'Invoice', file },
    ];
    const documents = [
      {
        file,
        doc: {
          components: {
            schemas: {
              Order: {
                'x-model-id': 'billing.MDL001',
                type: 'object',
                description: 'Customer purchase order.',
                properties: {
                  Invoice: {
                    type: 'object',
                    name: 'Invoice',
                    description: 'It bears mentioning that this links the order to an invoice.',
                  },
                },
              },
              Invoice: {
                type: 'object',
                description: 'Issued billing document with finalized line items.',
              },
            },
          },
        },
      },
    ];
    const advisory = config.resolveTextAdvisory(
      {},
      {
        text_advisory: {
          locale: 'en',
          filler_phrases: {
            phrases: PILOT_PHRASES,
          },
        },
      },
    );

    const result = textAdvisory.measureTextAdvisory({ documents, entities, advisory });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].entityId, 'billing.MDL001');
    assert.equal(result.findings[0].entityName, 'Order');
    assert.equal(result.findings[0].path, 'components/schemas/Order/properties/Invoice/description');
    assert.equal(entities[0].textAdvisory.length, 1);
    assert.deepEqual(entities[1].textAdvisory, []);
  });
});

describe('advisory whole-phrase filler matching (locale scoping, Unicode boundaries and quotes)', () => {
  test('matches English and Polish pilot phrases at Unicode word boundaries and rejects substring collisions', () => {
    const enHit = textAdvisory.matchFillerPhrases(
      'It bears mentioning that each file has two copies.',
      PILOT_PHRASES.en,
      'en',
    );
    assert.deepEqual(enHit, ['it bears mentioning that']);

    const enCollisionPrefix = textAdvisory.matchFillerPhrases(
      'A bit bears mentioning that each file has two copies.',
      PILOT_PHRASES.en,
      'en',
    );
    assert.deepEqual(enCollisionPrefix, []);

    const enCollisionSuffix = textAdvisory.matchFillerPhrases(
      'It bears mentioning thatcher wrote the note.',
      PILOT_PHRASES.en,
      'en',
    );
    assert.deepEqual(enCollisionSuffix, []);

    const plHit = textAdvisory.matchFillerPhrases(
      'Warto tu zaznaczyć, że odnowienia automatyczne są zwolnione z kontroli.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plHit, ['warto tu zaznaczyć, że']);

    const plCollisionPrefix = textAdvisory.matchFillerPhrases(
      'Niewarto tu zaznaczyć, że odnowienia są zwolnione.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plCollisionPrefix, []);

    const plCollisionSuffix = textAdvisory.matchFillerPhrases(
      'Warto tu zaznaczyć, żebym pamiętał o kontroli.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plCollisionSuffix, []);

    const plNoDiacritics = textAdvisory.matchFillerPhrases(
      'Warto tu zaznaczyc, ze odnowienia sa zwolnione.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plNoDiacritics, []);

    const plDecomposedNfd = textAdvisory.matchFillerPhrases(
      'Warto tu zaznaczyc\u0301, z\u0307e odnowienia automatyczne sa\u0328 zwolnione.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plDecomposedNfd, ['warto tu zaznaczyć, że']);

    const plNoncomposingMark = textAdvisory.matchFillerPhrases(
      'Warto tu zaznaczyć, że\u0329 odnowienia automatyczne są zwolnione.',
      PILOT_PHRASES.pl,
      'pl',
    );
    assert.deepEqual(plNoncomposingMark, []);
  });

  test('protects identifiable quotes while still flagging unquoted filler and ambiguous context', () => {
    const enQuoted = textAdvisory.matchFillerPhrases(
      'The witness wrote "It bears mentioning that the alert was late."',
      PILOT_PHRASES.en,
      'en',
      { protectQuotes: true },
    );
    assert.deepEqual(enQuoted, []);

    const plQuoted = textAdvisory.matchFillerPhrases(
      'Świadek napisał „Trzeba przy tym zauważyć, że alarm był spóźniony.”',
      PILOT_PHRASES.pl,
      'pl',
      { protectQuotes: true },
    );
    assert.deepEqual(plQuoted, []);

    const mixedUnquotedAndQuote = textAdvisory.matchFillerPhrases(
      'It bears mentioning that the witness wrote "the alert was late."',
      PILOT_PHRASES.en,
      'en',
      { protectQuotes: true },
    );
    assert.deepEqual(mixedUnquotedAndQuote, ['it bears mentioning that']);

    const ambiguousUnquoted = textAdvisory.matchFillerPhrases(
      'The witness noted it bears mentioning that the alert was late.',
      PILOT_PHRASES.en,
      'en',
      { protectQuotes: true },
    );
    assert.deepEqual(ambiguousUnquoted, ['it bears mentioning that']);
  });
});

describe('text_advisory configuration validation and disabling', () => {
  test('returns null when text_advisory is not configured', () => {
    assert.equal(config.resolveTextAdvisory({}, {}), null);
  });

  test('rejects malformed blocks, unknown keys, missing filler locale and unsupported echo locale', () => {
    for (const bad of [
      null,
      [],
      'en',
      { unknown: true },
      { off: 'yes' },
      { locale: '' },
      { locale: 'constructor', filler_phrases: {} },
      { locale: 'en_US', filler_phrases: { phrases: { en_US: ['it bears mentioning that'] } } },
      { filler_phrases: { locale: 'en', phrases: { en_US: ['it bears mentioning that'] } } },
      { filler_phrases: { locale: 'en', phrases: { constructor: ['it bears mentioning that'] } } },
      { label_echo: { locale: 'fr' } },
      { label_echo: { typo: true } },
      { filler_phrases: { phrases: { en: ['it bears mentioning that'] } } },
      { filler_phrases: { locale: 'en', phrases: { en: [''] } } },
      { protect: { quotes: 'yes' } },
      { protect: { evidence_fields: 'evidence' } },
    ]) {
      assert.throws(() => config.resolveTextAdvisory({}, { text_advisory: bad }), /text_advisory/);
    }
  });

  test('canonicalizes locale tags and dictionary keys and uses own-key lookup safely', () => {
    const resolved = config.resolveTextAdvisory(
      {},
      {
        text_advisory: {
          locale: 'EN-us',
          filler_phrases: {
            phrases: {
              'en-us': ['it bears mentioning that'],
            },
          },
        },
      },
    );
    assert.equal(resolved.locale, 'en-US');
    assert.equal(resolved.fillerPhrases.locale, 'en-US');
    assert.deepEqual(resolved.fillerPhrases.phrases['en-US'], ['it bears mentioning that']);

    const unvalidatedAdvisory = {
      source: 'project',
      off: false,
      locale: 'constructor',
      labelEcho: {
        off: true,
        locale: 'en',
        labelFields: ['name'],
        proseFields: ['description'],
      },
      fillerPhrases: {
        off: false,
        locale: 'constructor',
        fields: ['description'],
        phrases: {},
      },
      protect: {
        quotes: true,
        evidenceFields: [],
        protectedPaths: [],
        protectedNames: [],
        protectedContainers: [],
      },
    };
    const safeSummary = textAdvisory.measureTextAdvisory({
      documents: [],
      entities: [],
      advisory: unvalidatedAdvisory,
    });
    assert.equal(safeSummary.fillerPhrases.measured, 0);
    assert.equal(safeSummary.config.fillerPhrases.phraseCount, 0);
  });
});

/**
 * Create an isolated Blueprint fixture model and run the CLI against it.
 * @param {(ctx: {root: string, run: (...flags: string[]) => import('node:child_process').SpawnSyncReturns<string>}) => void} action
 */
function withPilotFixture(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'text-advisory-'));
  try {
    fs.mkdirSync(path.join(root, 'billing'));
    fs.mkdirSync(path.join(root, 'compliance'));
    fs.writeFileSync(
      path.join(root, 'billing', 'domain.yaml'),
      YAML.stringify({
        operations: {
          issueInvoice: {
            id: 'billing.CMD001',
            name: 'Issue Invoice For Recurring Enterprise Accounts With Manual Approval',
            kind: 'command',
            description: 'It bears mentioning that each issued invoice keeps two audit copies.',
            summary: 'The issue invoice for recurring enterprise accounts with manual approval command.',
            evidence: [
              {
                summary: 'It bears mentioning that the finance lead approved the exception.',
                description: 'The witness wrote "One thing to mention is that the alert was late."',
              },
            ],
          },
          recordPayment: {
            id: 'billing.CMD002',
            name: 'Record Payment',
            kind: 'command',
            description: 'The witness wrote "It bears mentioning that the alert was late."',
            summary: 'Records a settled customer payment.',
          },
        },
        validation: [
          {
            id: 'billing.VR001',
            name: 'Automatic renewals above fifty seats require written finance approval before billing.',
            description: 'Applies to every annual contract renewal.',
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(root, 'compliance', 'pl-domain.yaml'),
      YAML.stringify({
        operations: {
          registerRequest: {
            id: 'compliance.CMD001',
            name: 'Żądanie płatności',
            title: 'General Data Protection Regulation (EU) 2016/679',
            kind: 'command',
            description: 'Warto tu zaznaczyć, że odnowienia automatyczne są zwolnione z kontroli.',
            summary: 'Pole żądanie płatności.',
          },
          recordAudit: {
            id: 'compliance.CMD002',
            name: 'Sąd',
            kind: 'command',
            description: 'Świadek napisał „Trzeba przy tym zauważyć, że alarm był spóźniony.”',
            summary: 'Sad owocowy w rejestrze.',
          },
        },
      }),
    );

    const specPath = path.join(root, 'spec.yaml');
    fs.writeFileSync(
      specPath,
      YAML.stringify({
        metrics: {
          'domain.operation.description': {
            layer: 'domain',
            threshold: 1,
            patch_threshold: 1,
          },
          'rule.description': {
            layer: 'rules',
            threshold: 1,
            patch_threshold: 1,
          },
        },
        text_length: {
          description: { max_chars: 400 },
          summary: { max_chars: 240, max_sentences: 1 },
        },
      }),
    );

    const run = (...flags) => spawnSync(
      process.execPath,
      [CLI_PATH, root, '--spec', specPath, ...flags],
      { encoding: 'utf8' },
    );
    action({ root, run });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('CLI integration: whole-model, scoped, JSON, strict parity and locale runs', () => {
  test('reports all three advisory signals in text and JSON while keeping strict score, baseline, verdict and exit identical', () => {
    withPilotFixture(({ root, run }) => {
      const baseline = {
        'domain.operation.description': 1,
        'rule.description': 1,
      };
      const sharedTextLength = {
        name: {
          max_chars: 40,
          exclude_containers: ['validation'],
        },
        title: {
          max_chars: 30,
          protected_names: ['General Data Protection Regulation (EU) 2016/679'],
        },
      };
      const offConfigPath = path.join(root, 'off.yaml');
      fs.writeFileSync(
        offConfigPath,
        YAML.stringify({
          baseline,
          text_length: sharedTextLength,
          text_advisory: {
            off: true,
          },
        }),
      );

      const enConfigPath = path.join(root, 'en-pilot.yaml');
      fs.writeFileSync(
        enConfigPath,
        YAML.stringify({
          baseline,
          text_length: sharedTextLength,
          text_advisory: {
            locale: 'en',
            label_echo: {
              label_fields: ['name', 'title'],
              prose_fields: ['description', 'summary'],
            },
            filler_phrases: {
              fields: ['description', 'summary', 'rationale', 'context', 'statement', 'note'],
              phrases: PILOT_PHRASES,
            },
            protect: {
              quotes: true,
            },
          },
        }),
      );

      const offRes = run('--config', offConfigPath, '--strict', '--json');
      const onRes = run('--config', enConfigPath, '--strict', '--json');

      assert.equal(offRes.status, 0, offRes.stderr);
      assert.equal(onRes.status, 0, onRes.stderr);

      const offRun = JSON.parse(offRes.stdout).runs[0];
      const onRun = JSON.parse(onRes.stdout).runs[0];

      assert.equal(onRes.status, offRes.status);
      assert.deepEqual(onRun.metrics, offRun.metrics);
      assert.deepEqual(onRun.breaches, offRun.breaches);
      assert.equal(onRun.ok, offRun.ok);
      assert.equal(offRun.textAdvisory.findings.length, 0);

      assert.equal(onRun.textLength.fields.name.overLimit, 1);
      assert.equal(onRun.textLength.fields.title.overLimit, 0);

      assert.equal(onRun.textAdvisory.labelEcho.matches, 1);
      assert.equal(onRun.textAdvisory.fillerPhrases.locale, 'en');
      assert.equal(onRun.textAdvisory.fillerPhrases.matches, 1);
      assert.equal(onRun.textAdvisory.findings.length, 2);

      const echoFinding = onRun.textAdvisory.findings.find((item) => item.signal === 'label-echo');
      const fillerFinding = onRun.textAdvisory.findings.find((item) => item.signal === 'filler-phrase');
      assert.equal(echoFinding.entityId, 'billing.CMD001');
      assert.equal(echoFinding.path, 'operations/issueInvoice/summary');
      assert.equal(echoFinding.labelField, 'name');
      assert.equal(fillerFinding.entityId, 'billing.CMD001');
      assert.equal(fillerFinding.path, 'operations/issueInvoice/description');
      assert.equal(fillerFinding.phrase, 'it bears mentioning that');
      assert.equal(fillerFinding.locale, 'en');

      const wholeText = run('--config', enConfigPath);
      assert.equal(wholeText.status, 0, wholeText.stderr);
      assert.match(wholeText.stdout, /Text length \(advisory\):/);
      assert.match(wholeText.stdout, /Text advisory \(advisory\):/);
      assert.match(wholeText.stdout, /label-echo on summary restates name/);
      assert.match(wholeText.stdout, /filler-phrase on description matched "it bears mentioning that" \[en\]/);

      for (const scopeFlags of [
        ['--slice', 'billing'],
        ['--file', 'billing/domain.yaml'],
        ['--entity', 'billing.CMD001'],
      ]) {
        const scopedText = run('--config', enConfigPath, ...scopeFlags);
        assert.equal(scopedText.status, 0, scopedText.stderr);
        assert.match(scopedText.stdout, /label-echo on summary/);
        assert.match(scopedText.stdout, /filler-phrase on description matched "it bears mentioning that"/);
      }

      const cleanEntity = JSON.parse(
        run('--config', enConfigPath, '--entity', 'billing.CMD002', '--json').stdout,
      ).runs[0];
      assert.equal(cleanEntity.textAdvisory.findings.length, 0);
      assert.deepEqual(cleanEntity.entities[0].textAdvisory, []);
    });
  });

  test('runs Polish locale separately without mixing English phrases and protects Polish quotations', () => {
    withPilotFixture(({ root, run }) => {
      const plConfigPath = path.join(root, 'pl-pilot.yaml');
      fs.writeFileSync(
        plConfigPath,
        YAML.stringify({
          text_advisory: {
            locale: 'pl',
            label_echo: {},
            filler_phrases: {
              phrases: PILOT_PHRASES,
            },
            protect: {
              quotes: true,
            },
          },
        }),
      );

      const response = run('--config', plConfigPath, '--slice', 'compliance', '--json');
      assert.equal(response.status, 0, response.stderr);
      const runResult = JSON.parse(response.stdout).runs[0];

      assert.equal(runResult.textAdvisory.labelEcho.matches, 1);
      assert.equal(runResult.textAdvisory.fillerPhrases.locale, 'pl');
      assert.equal(runResult.textAdvisory.fillerPhrases.matches, 1);

      const echoFinding = runResult.textAdvisory.findings.find((item) => item.signal === 'label-echo');
      const fillerFinding = runResult.textAdvisory.findings.find((item) => item.signal === 'filler-phrase');
      assert.equal(echoFinding.entityId, 'compliance.CMD001');
      assert.equal(echoFinding.label, 'Żądanie płatności');
      assert.equal(echoFinding.locale, 'pl');
      assert.equal(fillerFinding.entityId, 'compliance.CMD001');
      assert.equal(fillerFinding.phrase, 'warto tu zaznaczyć, że');
      assert.equal(fillerFinding.locale, 'pl');
    });
  });

  test('exits with code 2 on malformed text_advisory configuration', () => {
    withPilotFixture(({ root, run }) => {
      const badConfigPath = path.join(root, 'bad-advisory.yaml');
      fs.writeFileSync(
        badConfigPath,
        YAML.stringify({
          text_advisory: {
            filler_phrases: {
              phrases: PILOT_PHRASES,
            },
          },
        }),
      );
      const response = run('--config', badConfigPath, '--json');
      assert.equal(response.status, 2);
      assert.match(response.stderr, /text_advisory\.filler_phrases requires an explicit locale/);
    });
  });

  test('keeps strict exit 1, breaches, metrics and persisted baseline equal when toggling text_advisory', () => {
    withPilotFixture(({ root, run }) => {
      fs.writeFileSync(
        path.join(root, 'billing', 'breach.yaml'),
        YAML.stringify({
          operations: {
            missingDocCommand: {
              id: 'billing.CMD099',
              name: 'Cancel Subscription',
              kind: 'command',
            },
          },
        }),
      );

      const sharedTextLength = {
        name: {
          max_chars: 40,
          exclude_containers: ['validation'],
        },
      };
      const offConfigPath = path.join(root, 'breach-off.yaml');
      const onConfigPath = path.join(root, 'breach-on.yaml');

      fs.writeFileSync(
        offConfigPath,
        YAML.stringify({
          text_length: sharedTextLength,
          text_advisory: {
            off: true,
          },
        }),
      );
      fs.writeFileSync(
        onConfigPath,
        YAML.stringify({
          text_length: sharedTextLength,
          text_advisory: {
            locale: 'en',
            label_echo: {},
            filler_phrases: {
              phrases: PILOT_PHRASES,
            },
          },
        }),
      );

      const offStrict = run('--config', offConfigPath, '--strict', '--json');
      const onStrict = run('--config', onConfigPath, '--strict', '--json');

      assert.equal(offStrict.status, 1, offStrict.stderr);
      assert.equal(onStrict.status, 1, onStrict.stderr);

      const offRun = JSON.parse(offStrict.stdout).runs[0];
      const onRun = JSON.parse(onStrict.stdout).runs[0];

      assert.equal(offRun.ok, false);
      assert.equal(onRun.ok, false);
      assert.deepEqual(onRun.breaches, offRun.breaches);
      assert.ok(onRun.breaches.includes('domain.operation.description'));
      assert.deepEqual(onRun.metrics, offRun.metrics);
      assert.equal(offRun.textAdvisory.findings.length, 0);
      assert.ok(onRun.textAdvisory.findings.length > 0);

      const offUpdate = run('--config', offConfigPath, '--update-baseline', '--quiet');
      const onUpdate = run('--config', onConfigPath, '--update-baseline', '--quiet');
      assert.equal(offUpdate.status, 0, offUpdate.stderr);
      assert.equal(onUpdate.status, 0, onUpdate.stderr);

      const offPersisted = YAML.parse(fs.readFileSync(offConfigPath, 'utf8'));
      const onPersisted = YAML.parse(fs.readFileSync(onConfigPath, 'utf8'));
      assert.ok(offPersisted.baseline);
      assert.deepEqual(onPersisted.baseline, offPersisted.baseline);
    });
  });
});
