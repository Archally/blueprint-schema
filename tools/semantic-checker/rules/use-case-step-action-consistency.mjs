/**
 * Consistency between a use-case step (or a navigation) and the UI Action it names.
 *
 * The valued check: a main-scenario step names both `ui_action` and `operation`, and that
 * Action's `triggers_operations[]` does not contain the step operation. Extra ops on the Action
 * are not a defect. Empty `triggers_operations` plus a named step operation is a disagreement.
 * Either field absent is silence. alternative_flow is not consulted.
 *
 * Two local-typing extras, same warn: the Action's `screen` should equal `navigation.from` when
 * `via_action` is set, and should equal `step.screen` when a main-scenario step names both.
 *
 * Refs are compared after resolving display ids (and `operation_ref`'s domain:key form), so
 * `orders.CMD001` and `CMD001` that name one entity do not disagree.
 */

const DOMAIN_KEY_REF = /^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9]*$/;

/** @param {import('@archally/semantic-checker').CheckableModel} model */
function index(model) {
  const byId = new Map();
  const byDisplay = new Map();
  const opByKey = new Map();
  for (const entity of model.entities ?? []) {
    byId.set(entity.id, entity);
    if (entity.type === 'Missing') continue;
    if (typeof entity.displayId === 'string' && entity.displayId) {
      byDisplay.set(entity.displayId, entity);
      const dot = entity.displayId.indexOf('.');
      if (dot > 0) {
        const bare = entity.displayId.slice(dot + 1);
        if (!byDisplay.has(bare)) byDisplay.set(bare, entity);
      }
    }
    if (entity.type === 'Operation') {
      const data = entity.data && typeof entity.data === 'object' ? entity.data : {};
      const key = data._operation_key;
      if (typeof key === 'string' && key) {
        const scope = typeof data._scope === 'string' ? data._scope : undefined;
        const domains = new Set([scope].filter(Boolean));
        const origin = typeof entity.fileOrigin === 'string' ? entity.fileOrigin.replace(/\\/g, '/').split('/')[0] : undefined;
        if (origin) domains.add(origin);
        for (const domain of domains) {
          const refKey = `${domain}:${key}`;
          if (!opByKey.has(refKey)) opByKey.set(refKey, entity);
        }
      }
    }
  }
  return { byId, byDisplay, opByKey };
}

/**
 * @param {string} ref
 * @param {ReturnType<typeof index>} tables
 * @param {string | undefined} type
 */
function resolve(ref, tables, type) {
  if (typeof ref !== 'string' || !ref) return null;
  const tryType = (entity) => (entity && (!type || entity.type === type) ? entity : null);
  const exact = tryType(tables.byDisplay.get(ref));
  if (exact) return exact;
  if (DOMAIN_KEY_REF.test(ref)) {
    const keyed = tryType(tables.opByKey.get(ref));
    if (keyed) return keyed;
  }
  const dot = ref.indexOf('.');
  if (dot > 0) {
    const bare = tryType(tables.byDisplay.get(ref.slice(dot + 1)));
    if (bare) return bare;
  }
  return null;
}

/** @param {unknown} entity */
function mainScenario(entity) {
  const data = entity && typeof entity === 'object' ? /** @type {Record<string, unknown>} */ (entity).data : null;
  const scenario = data && typeof data === 'object' ? /** @type {Record<string, unknown>} */ (data).main_scenario : null;
  return Array.isArray(scenario)
    ? scenario.filter((step) => step && typeof step === 'object')
    : [];
}

function label(entity, fallback) {
  return entity && typeof entity.displayId === 'string' ? entity.displayId : fallback;
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function useCaseStepActionOperationDisagrees(model, subject) {
  const tables = index(model);
  const disagreements = [];
  for (const step of mainScenario(subject)) {
    const uiActionRef = step.ui_action;
    const operationRef = step.operation;
    if (typeof uiActionRef !== 'string' || !uiActionRef) continue;
    if (typeof operationRef !== 'string' || !operationRef) continue;
    const action = resolve(uiActionRef, tables, 'UIAction');
    if (!action) continue;
    const stepOp = resolve(operationRef, tables, 'Operation');
    if (!stepOp) continue;
    const triggers = Array.isArray(action.data?.triggers_operations) ? action.data.triggers_operations : [];
    const triggered = new Set();
    for (const ref of triggers) {
      const op = resolve(ref, tables, 'Operation');
      if (op) triggered.add(op.id);
    }
    if (triggered.has(stepOp.id)) continue;
    const actionOps = [...triggered].map((id) => label(tables.byId.get(id), id));
    disagreements.push({
      step: String(step.step ?? '?'),
      action: label(action, uiActionRef),
      step_operation: label(stepOp, operationRef),
      action_operations: actionOps.length > 0 ? actionOps.join(', ') : '(none)',
    });
  }
  if (disagreements.length === 0) return { ok: true };
  const first = disagreements[0];
  return { ok: false, context: first };
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function navViaActionScreenDisagrees(model, subject) {
  const data = subject && typeof subject === 'object' ? /** @type {Record<string, unknown>} */ (subject).data : null;
  const via = data && typeof data.via_action === 'string' ? data.via_action : '';
  if (!via) return { ok: true };
  const fromRef = data && typeof data.from === 'string' ? data.from : '';
  if (!fromRef) return { ok: true };
  const tables = index(model);
  const action = resolve(via, tables, 'UIAction');
  if (!action) return { ok: true };
  const actionScreenRef = typeof action.data?.screen === 'string' ? action.data.screen : '';
  if (!actionScreenRef) return { ok: true };
  const actionScreen = resolve(actionScreenRef, tables, 'Screen');
  const fromScreen = resolve(fromRef, tables, 'Screen');
  if (!actionScreen || !fromScreen) return { ok: true };
  if (actionScreen.id === fromScreen.id) return { ok: true };
  return {
    ok: false,
    context: {
      action: label(action, via),
      action_screen: label(actionScreen, actionScreenRef),
      from: label(fromScreen, fromRef),
    },
  };
}

/**
 * @type {import('@archally/semantic-checker').CustomRuleFunction}
 */
export function useCaseStepActionScreenDisagrees(model, subject) {
  const tables = index(model);
  const disagreements = [];
  for (const step of mainScenario(subject)) {
    const uiActionRef = step.ui_action;
    const screenRef = step.screen;
    if (typeof uiActionRef !== 'string' || !uiActionRef) continue;
    if (typeof screenRef !== 'string' || !screenRef) continue;
    const action = resolve(uiActionRef, tables, 'UIAction');
    if (!action) continue;
    const actionScreenRef = typeof action.data?.screen === 'string' ? action.data.screen : '';
    if (!actionScreenRef) continue;
    const actionScreen = resolve(actionScreenRef, tables, 'Screen');
    const stepScreen = resolve(screenRef, tables, 'Screen');
    if (!actionScreen || !stepScreen) continue;
    if (actionScreen.id === stepScreen.id) continue;
    disagreements.push({
      step: String(step.step ?? '?'),
      action: label(action, uiActionRef),
      action_screen: label(actionScreen, actionScreenRef),
      step_screen: label(stepScreen, screenRef),
    });
  }
  if (disagreements.length === 0) return { ok: true };
  return { ok: false, context: disagreements[0] };
}
