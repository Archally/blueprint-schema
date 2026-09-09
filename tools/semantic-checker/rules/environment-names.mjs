/**
 * One idea, two subjects, and neither expressible in the rule DSL: a string that names a deployment
 * environment and matches none of the environments the model declares.
 *
 * A model can say "environment" in several places, and each of them accepts a typed id beside a
 * plain name. Where the value or the key IS a typed id, a reference that resolves to nothing is
 * already a cross-reference error with a file and a location - nothing here repeats that. What no
 * validator can see is the NAME: it is not a reference, so nothing notices when the model holds two
 * vocabularies for one set of environments, or configures for a deployment it never declared. That
 * is this module's whole subject, on the two surfaces that carry a name: a server's `environment`
 * and the keys of a resource's per-environment configuration.
 *
 * SILENT WHERE THERE IS NOTHING TO COMPARE AGAINST. A model that declares no environment at all
 * produces no finding, however many names it uses. With nothing declared, every name is unmatched
 * and the report degenerates from "this name is not one of yours" into "you have not modelled your
 * environments" - a different and much broader claim, and one a model may decline for good reason.
 * It also keeps the rule honest on the older lines, where the schema has no environment entity to
 * declare: reporting there would ask an author for something their schema cannot express.
 *
 * WARNING, NOT ERROR, even where environments are declared. Per-environment configuration for an
 * environment the model has not introduced is a statement about a real deployment that the model is
 * silent on, and silence is not contradiction.
 */

/** The typed environment id, as the metamodel states it. A value matching this is a reference. */
const ENVIRONMENT_ID = /^([a-z][a-z0-9-]*\.)?ENV\d{3,}$/;

/** The configuration key that means "every environment" rather than naming one. */
const SHARED_KEY = 'ALL';

const ENVIRONMENT = 'Environment';

/** One index per model, however many subjects the engine walks. */
const cache = new WeakMap();

function declaredNames(model) {
  const cached = cache.get(model);
  if (cached) return cached;
  const names = new Set();
  for (const entity of model.entities ?? []) {
    if (entity.type !== ENVIRONMENT) continue;
    const name = entity.data?.name ?? entity.name;
    if (typeof name === 'string' && name.length > 0) names.add(name);
  }
  cache.set(model, names);
  return names;
}

const labelOf = (entity) => entity?.data?.id ?? entity?.displayId ?? entity?.id ?? '?';

function report(model, subject, values) {
  const declared = declaredNames(model);
  if (declared.size === 0) return { ok: true };
  const unmatched = [...new Set(values)].filter((value) => !declared.has(value));
  if (unmatched.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      subject: labelOf(subject),
      subject_name: subject?.data?.name ?? subject?.name ?? subject?.displayId ?? '',
      names: unmatched.sort().join(', '),
      declared: [...declared].sort().join(', '),
    },
  };
}

/** A server names its environment by a name no declared environment carries. */
export const serverEnvironmentNotDeclared = (model, subject) => {
  const servers = subject?.data?.servers;
  if (!Array.isArray(servers)) return { ok: true };
  const named = servers
    .map((server) => server?.environment)
    .filter((value) => typeof value === 'string' && !ENVIRONMENT_ID.test(value));
  return report(model, subject, named);
};

/** A resource configures for an environment name no declared environment carries. */
export const resourceEnvironmentConfigNotDeclared = (model, subject) => {
  const config = subject?.data?.environments;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: true };
  const keys = Object.keys(config).filter((key) => key !== SHARED_KEY && !ENVIRONMENT_ID.test(key));
  return report(model, subject, keys);
};
