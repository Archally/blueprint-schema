/** Only declaration carriers are traversed here, never arbitrary properties or evidence payloads. */
const nestedCarriers = ['dependencies', 'relations', 'needs', 'servers', 'exchange', 'topic', 'queue', 'subscription'];
const operationFields = {
  openapi: ['expose'], httpClient: ['call'], http_client: ['call'],
  asyncapi: ['send', 'receive', 'broker_ref'], channel: ['send', 'receive', 'broker_ref'],
  openrpc: ['expose', 'call'], rpc: ['expose', 'call'], protobuf: ['expose', 'call'],
  mcp: ['expose', 'call'], cli: ['expose', 'call'], inprocess: ['provide', 'consume'],
  shareddata: ['write', 'read', 'store_ref'], scheduledtransfer: ['write', 'read'],
  graphql: ['queries', 'mutations', 'subscriptions'], arazzo: [], cncfsw: [],
};

const recordOf = value => value && typeof value === 'object' && !Array.isArray(value);

/** Visit an extracted entity's carriers once. Child entities are checked on their own turn. */
export function visitLinkCarriers(data, visit, path = '', kind = '') {
  if (!recordOf(data)) return;
  visit(data, path, kind || data._contractType || '');
  for (const key of nestedCarriers) {
    const value = data[key];
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visitLinkCarriers(child, visit, `${childPath}[${index}]`, key));
    } else {
      visitLinkCarriers(value, visit, childPath, key);
    }
  }
}

function fieldsOf(kind) {
  if (kind === 'Service') return ['imports', 'uses', 'routes_to', 'resource_refs'];
  if (kind === 'MessageChannel') return ['broker_ref'];
  if (['topic', 'queue', 'subscription'].includes(kind)) return ['channel_ref'];
  return operationFields[kind] ?? [];
}

/** Metadata does not create a link. Even another valid declaration ID is an orphan here. */
export function companionProblems(data, kind, path = '') {
  const problems = [];
  if (!recordOf(data?.link_provenance)) return problems;
  const prefix = path ? `${path}.link_provenance` : 'link_provenance';
  const fields = fieldsOf(kind);
  for (const [field, entries] of Object.entries(data.link_provenance)) {
    const location = `${prefix}.${field}`;
    if (!fields.includes(field)) {
      problems.push(`${location}: field is not a link on this owner`);
      continue;
    }
    if (!recordOf(entries)) continue;
    const declared = Array.isArray(data[field]) ? data[field] : [data[field]];
    for (const target of Object.keys(entries)) {
      if (!declared.includes(target)) problems.push(`${location}[${JSON.stringify(target)}]: target is not declared in this field`);
    }
  }
  return problems;
}

/** Raw documents include child entities; the validator supplies their full source paths. */
export function documentCompanionProblems(data) {
  const problems = [];
  const walk = (value, path = '', kind = '') => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${path}[${index}]`, kind));
      return;
    }
    if (!recordOf(value)) return;
    problems.push(...companionProblems(value, kind, path));
    for (const [key, child] of Object.entries(value)) {
      if (['link_provenance', 'provenance', 'evidence', 'properties'].includes(key)) continue;
      const childPath = path ? `${path}.${key}` : key;
      let childKind = key;
      if (key === 'services') childKind = 'Service';
      if (key === 'channels') childKind = 'MessageChannel';
      if (kind === 'contracts') childKind = key;
      walk(child, childPath, childKind);
    }
  };
  walk(data);
  return problems;
}
