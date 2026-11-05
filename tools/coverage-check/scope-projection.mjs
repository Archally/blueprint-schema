// GENERATED - do not edit.
// Emitted by tsc from the TypeScript module scope-projection.ts, its single implementation.
// This plain-ESM copy is what the zero-build tools run. Editing this file makes it disagree with
// its source; change the TypeScript module and regenerate this copy.

const entityTypes = {
    operations: 'Operation', capabilities: 'Capability', domains: 'Domain', subdomains: 'Subdomain',
    contexts: 'Context', services: 'Service', contracts: 'Contract', models: 'Models',
    happy_path: 'TestCase', edge_cases: 'TestCase', error_cases: 'TestCase', resources: 'InfraResource',
    infrastructure_resources: 'InfraResource', infra_resources: 'InfraResource',
};
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string' && !!item) : [];
const fold = (value) => value.toLowerCase().replace(/-/g, ' ').trim();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function projectScope(documents) {
    const entities = [];
    const edges = [];
    const unresolved = [];
    const parents = new Map();
    const byIdentity = new Map();
    for (const document of [...documents].sort((a, b) => compare(a.file, b.file))) {
        const segments = document.file.replace(/\\/g, '/').split('/');
        const slice = segments.length > 1 ? segments[0] : 'default';
        const basename = segments.at(-1);
        const walk = (node, location, collection, mapKey, parent) => {
            if (Array.isArray(node)) {
                node.forEach((item, index) => walk(item, `${location}[${index}]`, collection, null, parent));
                return;
            }
            if (!record(node))
                return;
            const type = collection === 'children' && parent?.type === 'Capability' ? 'Capability' : entityTypes[collection];
            const isDeclaration = type && (node.id != null || (['Context', 'Service'].includes(type) && node.name) || (mapKey && ['Contract', 'Models', 'Operation'].includes(type)));
            let owner = parent;
            if (isDeclaration || Array.isArray(node.code_refs)) {
                const authoredId = String(node.id ?? node['x-model-id'] ?? (type === 'Models' || type === 'Contract' ? mapKey : node.name ?? mapKey) ?? '(unnamed)');
                const name = String(node.name ?? authoredId);
                let canonicalName = authoredId;
                if (type === 'Context')
                    canonicalName = `${parent?.type === 'Party' ? parent.name : ''}.${name}`;
                if (type === 'Service')
                    canonicalName = `${parent?.data._archPath ?? ''}.${name}`;
                if (type === 'Contract')
                    canonicalName = `${parent?.data._archPath ?? ''}.${mapKey}`;
                const recognized = !!type;
                const entity = {
                    identity: `${document.file}#${location}`, sourceFile: document.file, location, authoredId, mapKey,
                    slice, canonicalHandle: recognized ? `${slice}-${basename}-${canonicalName}` : null,
                    type: type ?? collection, name, data: { ...node },
                };
                if (['Context', 'Service', 'Contract'].includes(entity.type))
                    entity.data._archPath = canonicalName;
                if (entity.type === 'Operation') {
                    entity.data._context_name = document.data.name;
                    entity.data._operation_key = mapKey;
                    entity.data._scope = segments.length > 1 ? segments[0] : undefined;
                    entity.data._domain_ref_default = document.data.domain_ref;
                }
                if (parent)
                    parents.set(entity.identity, parent);
                entities.push(entity);
                byIdentity.set(entity.identity, entity);
                owner = entity;
            }
            // Parties have a canonical name in the context path but are not a scope roll-up target.
            if (collection === 'parties' && typeof node.name === 'string') {
                owner = { type: 'Party', name: node.name, data: {}, identity: '', canonicalHandle: null };
            }
            for (const [key, value] of Object.entries(node)) {
                if (key === 'code_refs' || key.startsWith('_'))
                    continue;
                if (record(value) && ['operations', 'models', 'contracts', 'schemas', 'x-field', 'x-parameter'].includes(key)) {
                    for (const [entryKey, entry] of Object.entries(value))
                        walk(entry, `${location}[${JSON.stringify(key)}][${JSON.stringify(entryKey)}]`, ['schemas', 'x-field', 'x-parameter'].includes(key) ? 'models' : key, entryKey, owner);
                }
                else
                    walk(value, `${location}[${JSON.stringify(key)}]`, key, null, owner);
            }
        };
        walk(document.data, '$', '', null);
    }
    const typed = (type) => entities.filter(entity => entity.type === type && entity.canonicalHandle);
    const add = (source, target, type, data) => {
        if (!edges.some(edge => edge.source === source.identity && edge.target === target.identity && edge.type === type)) {
            edges.push({ source: source.identity, target: target.identity, type, ...(data ? { data } : {}) });
        }
    };
    const resolve = (source, ref, mode = 'generic') => {
        let candidates;
        if (mode === 'operation' && /^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9]*$/.test(ref)) {
            candidates = typed('Operation').filter(entity => [entity.slice, entity.sourceFile.split('/')[0]].some(scope => `${scope}:${entity.mapKey}` === ref));
        }
        else if (mode === 'module')
            candidates = entities.filter(entity => ['Context', 'Domain'].includes(entity.type) && entity.data.id === ref);
        else
            candidates = entities.filter(entity => entity.canonicalHandle && (['Context', 'Service', 'Contract'].includes(entity.type) ? entity.name : entity.authoredId) === ref);
        if (candidates.length === 1)
            return candidates[0];
        unresolved.push({ source: source.identity, ref, reason: candidates.length ? 'ambiguous' : 'unresolved' });
        return undefined;
    };
    const domainFor = (entity) => {
        const folder = entity.sourceFile.includes('/') ? entity.sourceFile.split('/')[0] : 'default';
        const matches = typed('Domain').filter(domain => fold(domain.name) === fold(folder));
        return folder !== 'default' && matches.length === 1 ? matches[0] : undefined;
    };
    for (const entity of entities) {
        const parent = parents.get(entity.identity);
        if (entity.type === 'Service' && parent?.type === 'Context')
            add(parent, entity, 'contains');
        if (entity.type === 'Contract' && parent?.type === 'Service')
            add(parent, entity, 'provides');
        if (entity.type === 'Context') {
            const ref = entity.data.domain_ref;
            if (typeof ref === 'string' && /^DMN\d{3,}$/.test(ref)) {
                const target = resolve(entity, ref);
                if (target)
                    add(entity, target, 'context_realizes_domain', { resolution: 'declared' });
            }
            else if (typeof ref === 'string' && /^SDM\d{3,}$/.test(ref)) {
                const subdomain = resolve(entity, ref);
                const domain = subdomain && parents.get(subdomain.identity);
                if (domain?.type === 'Domain')
                    add(entity, domain, 'context_realizes_domain', { resolution: 'declared' });
            }
            else if (!ref) {
                const target = domainFor(entity);
                if (target)
                    add(entity, target, 'context_realizes_domain', { resolution: 'folder' });
            }
        }
        if (entity.type === 'Operation') {
            const ref = entity.data._domain_ref_default;
            const target = typeof ref === 'string' && ref ? resolve(entity, ref) : domainFor(entity);
            if (target)
                add(entity, target, 'operation_in_domain', { resolution: ref ? 'file-header' : 'folder' });
        }
        if (entity.type === 'Capability') {
            for (const ref of strings(entity.data.realized_in)) {
                const target = resolve(entity, ref, 'module');
                if (target)
                    add(entity, target, 'capability_realized_in');
            }
        }
        if (entity.type === 'TestCase') {
            for (const ref of strings(entity.data.validates?.operations)) {
                const target = resolve(entity, ref, 'operation');
                if (target?.type === 'Operation')
                    add(entity, target, 'validates');
            }
        }
    }
    for (const operation of typed('Operation')) {
        const forms = [operation.authoredId];
        if (operation.data._scope)
            forms.push(`${operation.data._scope}.${operation.authoredId}`);
        if (operation.data._context_name)
            forms.push(`${operation.data._context_name}:${operation.name}`);
        for (const contract of typed('Contract')) {
            const provided = ['expose', 'send', 'provide', 'write'].flatMap(key => Array.isArray(contract.data[key]) ? contract.data[key].map((item) => typeof item === 'string' ? item : item?.domainName && item?.operationName ? `${item.domainName}:${item.operationName}` : '') : []);
            if (!forms.some(form => provided.includes(form)))
                continue;
            const service = parents.get(contract.identity);
            const context = service && parents.get(service.identity);
            if (context?.type === 'Context')
                add(operation, context, 'handled_by', { resolution: 'contract' });
        }
        if (!edges.some(edge => edge.source === operation.identity && edge.type === 'handled_by')) {
            const domain = edges.find(edge => edge.source === operation.identity && edge.type === 'operation_in_domain')?.target;
            const contexts = [...new Set(edges.filter(edge => edge.type === 'context_realizes_domain' && edge.target === domain).map(edge => edge.source))];
            if (contexts.length === 1)
                add(operation, byIdentity.get(contexts[0]), 'handled_by', { resolution: 'domain' });
        }
    }
    const listed = new Set();
    for (const capability of typed('Capability'))
        for (const ref of strings(capability.data.operations)) {
            const operation = resolve(capability, ref, 'operation');
            if (operation?.type === 'Operation') {
                listed.add(operation.identity);
                add(capability, operation, 'capability_operation', { origin: 'operation' });
            }
        }
    for (const capability of typed('Capability'))
        for (const operation of typed('Operation')) {
            if (listed.has(operation.identity))
                continue;
            const modules = edges.filter(edge => edge.source === capability.identity && edge.type === 'capability_realized_in')
                .map(edge => byIdentity.get(edge.target))
                .filter(module => edges.some(edge => edge.source === operation.identity && edge.target === module.identity && ['handled_by', 'operation_in_domain'].includes(edge.type)))
                .sort((a, b) => compare(a.authoredId, b.authoredId));
            if (modules.length)
                add(capability, operation, 'capability_operation', { origin: 'module', module: modules[0].authoredId, module_kind: modules[0].type === 'Domain' ? 'domain' : 'context', modules: [...new Set(modules.map(module => module.authoredId))] });
        }
    entities.sort((a, b) => compare(a.identity, b.identity));
    edges.sort((a, b) => compare(`${a.source}:${a.type}:${a.target}`, `${b.source}:${b.type}:${b.target}`));
    unresolved.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
    return { entities, edges, unresolved };
}
