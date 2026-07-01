#!/usr/bin/env node
// model-query — deterministic reuse-audit query over a model.json produced by the model-builder tool.
// Usage: node tools/model-query/src/cli.mjs [model.json] [section]
//   section ∈ findings | risks | decisions | actors | concepts | rules | clusters | all  (default: all)
// Generic: no project-specific data baked in; reads the merged model and reports the de-dup graph.

import fs from 'node:fs';

const modelPath = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : './model.json';
const section = process.argv[3] || process.argv[2]?.startsWith('-') ? (process.argv[3] || 'all') : 'all';
const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
const E = model.entities;
const R = model.relations;

const sliceOf = (e) => {
  const seg = (e.fileOrigin || '').replace(/\\/g, '/').split('/').filter(Boolean);
  return seg.length > 1 ? seg[0] : '(root)';
};
const byType = (t) => E.filter((e) => e.type === t);
const arr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);
const trunc = (s, n = 90) => (s ? String(s).replace(/\s+/g, ' ').slice(0, n) : '');

// ---- keyword clusters for theme grouping (generic recurring smell themes) ----
const CLUSTERS = {
  'no-events/sync-handoff': /no domain event|domain events|outbox|synchronous|sync |in-process|hand off|hand-off|background job|job queue|async worker|status column|react reliably/i,
  'god-class/cross-slice-coupling': /god.?class|cross-slice|navigation propert|polymorphic|foreign key|fk into|couple|coupling|ripple|reach into/i,
  'working-copy/published-dup': /working cop|temporary.*publish|draft.*publish|published.*copy|snapshot copy|duplicate.*publish/i,
  'plaintext-secret': /plaintext|plain-text|secret|credential|api key|token.*store|unencrypted/i,
  'dual-implementation/paradigm-dup': /two (paradigm|implementation|engine)|duplicat|parallel impl|bespoke.*generic|both .* export/i,
};
const themesFor = (txt) =>
  Object.entries(CLUSTERS).filter(([, re]) => re.test(txt)).map(([k]) => k);

function sectionFindings() {
  const F = byType('Finding');
  console.log(`\n#### FINDINGS (${F.length}) ####`);
  const groups = {};
  for (const e of F) (groups[sliceOf(e)] ??= []).push(e);
  for (const [slice, list] of Object.entries(groups).sort()) {
    console.log(`\n== ${slice} ==`);
    for (const e of list) {
      const d = e.data || {};
      const refs = [
        d.risk_refs?.length ? `risk_refs=[${d.risk_refs.join(',')}]` : null,
        d.decision_refs?.length ? `dec=[${d.decision_refs.join(',')}]` : null,
        d.migration_ref ? `mig=${d.migration_ref}` : null,
        d.affects?.context_refs?.length ? `ctx=[${d.affects.context_refs.join(',')}]` : null,
      ].filter(Boolean).join(' ');
      const txt = `${d.title || ''} ${d.statement || ''} ${d.summary || ''}`;
      const themes = themesFor(txt);
      console.log(
        `  ${e.displayId.padEnd(8)} ${(d.kind || '').padEnd(18)} ${(d.quality_characteristic || '-').padEnd(13)} ${(d.status || '-').padEnd(11)} ${refs}` +
        (themes.length ? `  «${themes.join('|')}»` : '')
      );
      console.log(`           ${trunc(d.title, 110)}`);
    }
  }
}

function sectionClusters() {
  const F = byType('Finding');
  console.log(`\n#### FINDING THEME CLUSTERS ####`);
  const buckets = {};
  for (const e of F) {
    const d = e.data || {};
    const txt = `${d.title || ''} ${d.statement || ''} ${d.summary || ''} ${d.recommendation || ''}`;
    for (const th of themesFor(txt)) {
      (buckets[th] ??= []).push({ id: `${sliceOf(e)}.${e.displayId}`, risk_refs: d.risk_refs || [] });
    }
  }
  for (const [th, list] of Object.entries(buckets)) {
    console.log(`\n== ${th} (${list.length}) ==`);
    for (const x of list) console.log(`  ${x.id.padEnd(34)} risk_refs=[${x.risk_refs.join(',')}]`);
  }
}

function sectionRisks() {
  const RK = byType('Risk');
  const DEC = byType('Decision');
  // a risk is non-orphan iff referenced by some decision.motivation_refs.risks
  const referenced = new Set();
  for (const d of DEC) for (const r of arr(d.data?.motivation_refs?.risks)) referenced.add(String(r).replace(/^.*\./, ''));
  console.log(`\n#### RISKS (${RK.length}) ####  (orphan = not in any decision.motivation_refs.risks)`);
  for (const e of RK) {
    const id = e.displayId;
    const bare = id.replace(/^.*\./, '');
    const orph = referenced.has(bare) || referenced.has(id) ? '' : '  ⚠ORPHAN';
    console.log(`  ${(sliceOf(e) + '.' + id).padEnd(28)}${orph}`);
    console.log(`     ${trunc(e.data?.statement, 130)}`);
  }
}

function sectionDecisions() {
  const DEC = byType('Decision');
  console.log(`\n#### DECISIONS (${DEC.length}) ####  (flag shared-tactic keywords)`);
  const TACTIC = {
    'TPH/one-concept-discriminator': /table-per-hierarch|\bTPH\b|discriminator|one concept over|single concept over/i,
    'ConditionCriteria-reuse': /conditioncriteria|condition criteria|predicate engine|criteria engine/i,
    'outbox/event-bus': /outbox|event bus|domain event/i,
    'read-model/CQRS': /read.model|cqrs|projection/i,
  };
  for (const e of DEC) {
    const d = e.data || {};
    const txt = `${d.title || ''} ${d.summary || ''} ${d.description || ''} ${JSON.stringify(d.rationale || '')}`;
    const tac = Object.entries(TACTIC).filter(([, re]) => re.test(txt)).map(([k]) => k);
    const risks = arr(d.motivation_refs?.risks).join(',');
    const hasCode = d.code_refs?.length ? 'code' : '----';
    console.log(`  ${(sliceOf(e) + '.' + e.displayId).padEnd(26)} ${hasCode} risks=[${risks}]` + (tac.length ? `  «${tac.join('|')}»` : ''));
    console.log(`     ${trunc(d.title, 110)}`);
  }
}

function sectionActors() {
  const A = byType('Actor');
  console.log(`\n#### ACTORS (${A.length}) ####  (group by normalized name → duplicate archetypes)`);
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
  const groups = {};
  for (const e of A) {
    const nm = e.term || e.data?.name || e.displayId;
    (groups[norm(nm)] ??= []).push(`${sliceOf(e)}.${e.displayId}(${nm})`);
  }
  for (const [, list] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    if (list.length > 1) console.log(`  ✦ ${list.join('  ')}`);
  }
  console.log('  --- singletons omitted ---');
}

function sectionConcepts() {
  const C = byType('Concept');
  console.log(`\n#### SHARED-KERNEL CONCEPTS ####  (same displayId/term across >1 slice)`);
  const byTerm = {};
  for (const e of C) {
    const key = (e.term || e.displayId).toLowerCase();
    (byTerm[key] ??= new Set()).add(`${sliceOf(e)}.${e.displayId}`);
  }
  for (const [term, set] of Object.entries(byTerm)) {
    if (set.size > 1) console.log(`  ${term.padEnd(24)} -> ${[...set].join(', ')}`);
  }
}

const run = { findings: sectionFindings, clusters: sectionClusters, risks: sectionRisks, decisions: sectionDecisions, actors: sectionActors, concepts: sectionConcepts };
if (section === 'all') for (const fn of Object.values(run)) fn();
else if (run[section]) run[section]();
else console.error(`Unknown section: ${section}. Use one of ${Object.keys(run).join(', ')} | all`);
