import type { Entity, Relation } from '../../model/types.js';

/** Source identity excludes file placement and evidence, so moving or documenting a link keeps it. */
export function declarationOrigin(owner: Entity, selector: string): NonNullable<Relation['origin_ref']> {
  const data = owner.data ?? {};
  const identity = String(data.id ?? data.contract_name ?? data.name ?? data._contractType ?? owner.displayId);
  const ownerCoordinates = typeof data.id === 'string' ? '' : `[owner=${encodeURIComponent(JSON.stringify([
    data._scope ?? '', data._party ?? '', data._context ?? '', data._service ?? '',
  ]))}]`;
  return {
    ...(owner.fileOrigin !== undefined ? { file: owner.fileOrigin } : {}),
    declaration_id: identity,
    path: `${owner.type}[id=${encodeURIComponent(identity)}]${ownerCoordinates}.${selector}`,
  };
}

/** Presence matters: absent, partial and explicitly empty provenance are different statements. */
export function localEvidence(record: Record<string, unknown>): Record<string, unknown> {
  return Object.hasOwn(record, 'provenance') ? { provenance: record.provenance } : {};
}

export function companionEvidence(record: Record<string, unknown>, field: string, target: string): Record<string, unknown> {
  const maps = record.link_provenance as Record<string, Record<string, unknown>> | undefined;
  const entries = maps?.[field];
  return entries && Object.hasOwn(entries, target) ? { provenance: entries[target] } : {};
}

export function linkWitness(owner: Entity, selector: string, record: Record<string, unknown>): Record<string, unknown> {
  return { origin_ref: declarationOrigin(owner, selector), ...record };
}

export function contractWitness(owner: Entity, selector: string, evidence: Record<string, unknown>): Record<string, unknown> {
  return linkWitness(owner, selector, {
    ...evidence,
    ...(Object.hasOwn(owner.data ?? {}, 'provenance') ? { contract_provenance: owner.data!.provenance } : {}),
  });
}

/** ID-keyed owner selector plus occurrence, used only where the schema has no declaration ID. */
export function declarationRelationId(owner: Entity, selector: string, type: string): string {
  const origin = declarationOrigin(owner, selector);
  return `${origin.path}--${type}`;
}
