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
