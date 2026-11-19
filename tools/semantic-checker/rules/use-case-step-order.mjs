import { statSync } from 'node:fs';

// Same source helper in the monorepo and the ported public tools layout.
const candidates = [
  new URL('../model-builder/dist/model/useCaseStepOrder.js', import.meta.url),
  new URL('../../model-builder/dist/model/useCaseStepOrder.js', import.meta.url),
];
const helper = candidates.find(url => statSync(url, { throwIfNoEntry: false })?.isFile());
if (!helper) {
  throw new Error('Build model-builder before checking use-case-step-order. Tried: ' + candidates.map(url => url.href).join(', '));
}
const { normalizeUseCaseStepOrder } = await import(helper.href);

export function useCaseStepOrder(model, subject) {
  const scenario = subject.data?.main_scenario;
  if (!Array.isArray(scenario)) {
    return { ok: true };
  }
  const order = normalizeUseCaseStepOrder(subject.displayId ?? subject.id, scenario);
  return {
    ok: order.status === 'valid',
    context: { findings: order.diagnostics.map(diagnostic => diagnostic.message).join('; ') },
  };
}
