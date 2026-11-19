/** Pure, browser-safe product resolution. Ids are opaque exact keys supplied by adapters. */
const owns = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
const sorted = values => [...new Set(values)].sort();
export function resolveCapabilityProducts(records, registry) {
  const diagnostics = [];
  const report = (record, code, message) => diagnostics.push({ code, id: record?.id, source: record?.source, message });
  const byId = new Map();
  const duplicates = new Set();
  for (const record of records) {
    if (byId.has(record.id)) {
      duplicates.add(record.id);
      report(record, 'duplicate-capability', `duplicate capability ${record.id}`);
    } else {
      byId.set(record.id, record);
    }
  }
  const fieldBearing = registry !== undefined || records.some(record => owns(record, 'products'));
  const products = new Map();
  const duplicateProducts = new Set();
  if (registry !== undefined && !Array.isArray(registry)) {
    report(undefined, 'invalid-registry', 'products registry must be a list');
  }
  for (const product of Array.isArray(registry) ? registry : []) {
    if (!product || typeof product.id !== 'string' || typeof product.name !== 'string') {
      report(product, 'invalid-product', 'product needs an id and name');
      continue;
    }
    if (products.has(product.id)) {
      duplicateProducts.add(product.id);
      report(product, 'duplicate-product', `duplicate product ${product.id}`);
    } else {
      products.set(product.id, product);
    }
  }
  const stated = new Map();
  for (const record of records) {
    if (!owns(record, 'products')) {
      continue;
    }
    const list = record.products;
    const valid = Array.isArray(list) && list.every(id => typeof id === 'string' && /^PDT\d{3,}$/.test(id)) && new Set(list).size === list.length;
    if (!valid) {
      report(record, 'invalid-products', 'products must be a unique list of PDT ids');
      stated.set(record.id, { products: [], unresolved: [], invalid: true });
      continue;
    }
    const unresolved = list.filter(id => !products.has(id) || duplicateProducts.has(id));
    for (const id of unresolved) {
      report(record, duplicateProducts.has(id) ? 'ambiguous-product' : 'missing-product', `unresolved product ${id}`);
    }
    stated.set(record.id, { products: sorted(list.filter(id => !unresolved.includes(id))), unresolved: sorted(unresolved), invalid: unresolved.length > 0 });
  }
  if (!fieldBearing) {
    report(undefined, 'legacy-model', 'legacy model: product tags are used only in a wholly fieldless model');
  }
  const resolutions = new Map();
  for (const record of byId.values()) {
    const issues = [];
    // Inspect topology independently of assignment, so an explicit override cannot hide malformed ancestry.
    const active = new Set();
    const done = new Set();
    const stack = [{ id: record.id, exit: false }];
    while (stack.length) {
      const { id, exit } = stack.pop();
      if (exit) {
        active.delete(id);
        done.add(id);
        continue;
      }
      if (active.has(id)) {
        issues.push('cycle');
        continue;
      }
      if (done.has(id)) {
        continue;
      }
      if (!byId.has(id)) {
        issues.push('broken-parent');
        continue;
      }
      if (duplicates.has(id)) {
        issues.push('duplicate-capability');
      }
      active.add(id);
      stack.push({ id, exit: true });
      for (const parent of byId.get(id).parentIds ?? []) {
        stack.push({ id: parent, exit: false });
      }
    }
    for (const code of sorted(issues)) {
      report(record, code, `unresolved ancestry: ${code}`);
    }
    const base = { products: undefined, names: [], origin: 'not stated', from: [], unresolved: [], diagnostics: [] };
    let result = base;
    if (duplicates.has(record.id)) {
      result = { ...base, products: [], origin: 'unresolved' };
    } else if (!fieldBearing) {
      const tags = Array.isArray(record.tags) ? record.tags : [];
      if (record.tags !== undefined && (!Array.isArray(record.tags) || tags.some(tag => typeof tag !== 'string'))) {
        report(record, 'invalid-tags', 'tags must be a list of strings');
      }
      if (tags.includes('blueprint-specific') && tags.includes('archally-wide')) {
        report(record, 'dual-product-tags', 'Blueprint takes legacy precedence over Archally');
      }
      const label = tags.includes('blueprint-specific') ? 'Blueprint' : tags.includes('archally-wide') ? 'Archally' : undefined;
      result = { ...base, products: label ? [label] : undefined, names: label ? [label] : [], origin: issues.length ? 'unresolved' : label ? 'legacy' : 'not stated' };
    } else {
      let frontier = [record.id];
      const visited = new Set();
      let sources = [];
      while (frontier.length && !sources.length) {
        const next = [];
        for (const id of sorted(frontier)) {
          if (visited.has(id)) {
            continue;
          }
          visited.add(id);
          if (stated.has(id)) {
            sources.push(id);
          } else {
            next.push(...(byId.get(id)?.parentIds ?? []));
          }
        }
        frontier = next;
      }
      const assignments = sources.map(id => stated.get(id));
      const signatures = new Set(assignments.map(value => JSON.stringify([value.products, value.unresolved, value.invalid])));
      const conflict = signatures.size > 1;
      if (conflict) {
        report(record, 'conflicting-products', 'nearest stated ancestors disagree');
      }
      const explicit = stated.has(record.id);
      if (conflict || (!explicit && issues.length)) {
        result = { ...base, products: [], origin: 'unresolved', from: sources };
      } else if (assignments.length) {
        const assignment = assignments[0];
        result = { ...base, products: assignment.products, names: assignment.products.map(id => products.get(id).name),
          origin: assignment.invalid ? 'unresolved' : explicit ? 'stated' : 'inherited', from: sources, unresolved: assignment.unresolved };
      }
    }
    resolutions.set(record.id, result);
  }
  for (const [id, result] of resolutions) {
    result.diagnostics = diagnostics.filter(diagnostic => diagnostic.id === id || diagnostic.id === undefined);
  }
  return { resolutions, diagnostics, fieldBearing };
}
