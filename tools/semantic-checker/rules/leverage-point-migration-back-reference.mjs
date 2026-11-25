// @ts-check
/**
 * Report deprecated statements from resolved migration-to-leverage edges.
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function leveragePointMigrationBackReference(model, subject) {
  if (!subject || subject.type !== 'LeveragePoint') return { ok: true };
  const byId = new Map(model.entities.map((entity) => [entity.id, entity]));
  const migrations = [];
  const seen = new Set();
  for (const relation of model.relations) {
    if (relation.type !== 'migration_serves_leverage' || relation.target !== subject.id) continue;
    const provenance = relation.data?.provenance;
    if (provenance !== 'leverage-point' && provenance !== 'both') continue;
    if (seen.has(relation.source)) continue;
    seen.add(relation.source);
    const migration = byId.get(relation.source);
    const label = migration?.displayId ?? relation.source;
    if (!migration || migration.type !== 'Migration') {
      migrations.push(`${label} - names no migration the model declares; correct or remove it`);
      continue;
    }
    migrations.push(provenance === 'both'
      ? `${label} - already lists this leverage point in leverage_refs, so the entry here can go`
      : `${label} - does NOT list this leverage point, so add it to the migration's leverage_refs first`);
  }
  if (migrations.length === 0) return { ok: true };
  return { ok: false, context: { count: String(migrations.length), migrations } };
}
