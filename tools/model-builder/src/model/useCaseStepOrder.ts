/** Scenario-local precedence. Numeric step labels never identify an occurrence. */
export interface UseCaseStepContract {
  id?: string;
  after?: string[];
  optional?: boolean;
  repeat?: boolean;
  rule?: string;
}

export interface UseCaseStepOccurrence extends UseCaseStepContract {
  sourceIndex: number;
  occurrenceKey: string;
  predecessors: string[];
}

export interface UseCaseStepOrderDiagnostic {
  code: 'duplicate-id' | 'unknown-predecessor' | 'self-predecessor' | 'cycle' | 'invalid-after';
  useCase: string;
  sourceIndex: number;
  path: string;
  ids: string[];
  message: string;
}

export interface UseCaseStepOrder {
  status: 'valid' | 'invalid';
  useCase: string;
  steps: UseCaseStepOccurrence[];
  diagnostics: UseCaseStepOrderDiagnostic[];
}

/** Copy only declared fields, preserving false, [] and absence through JSON transports. */
export function useCaseStepContract(source: UseCaseStepContract | Record<string, unknown>): UseCaseStepContract {
  const result: UseCaseStepContract = {};
  if (typeof source.id === 'string') {
    result.id = source.id;
  }
  if (Array.isArray(source.after)) {
    result.after = source.after.filter((value): value is string => typeof value === 'string');
  }
  if (typeof source.optional === 'boolean') {
    result.optional = source.optional;
  }
  if (typeof source.repeat === 'boolean') {
    result.repeat = source.repeat;
  }
  if (typeof source.rule === 'string') {
    result.rule = source.rule;
  }
  return result;
}

/** Normalize the complete source scenario before any operation or presentation filtering. */
export function normalizeUseCaseStepOrder(useCase: string, scenario: readonly Record<string, unknown>[]): UseCaseStepOrder {
  const diagnostics: UseCaseStepOrderDiagnostic[] = [];
  const steps: UseCaseStepOccurrence[] = scenario.map((source, sourceIndex) => ({
    ...useCaseStepContract(source),
    sourceIndex,
    occurrenceKey: `${useCase}#main_scenario/${sourceIndex}`,
    predecessors: [],
  }));
  const report = (code: UseCaseStepOrderDiagnostic['code'], index: number, field: string, ids: string[], detail: string) => {
    const path = `/main_scenario/${index}/${field}`;
    diagnostics.push({ code, useCase, sourceIndex: index, path, ids, message: `${useCase} ${path}: ${detail}` });
  };
  const byId = new Map<string, UseCaseStepOccurrence>();
  const duplicateIds = new Set<string>();
  for (const step of steps) {
    if (step.id === undefined) {
      continue;
    }
    if (byId.has(step.id)) {
      duplicateIds.add(step.id);
      report('duplicate-id', step.sourceIndex, 'id', [step.id], `duplicate scenario-local id ${step.id}; first occurrence /main_scenario/${byId.get(step.id)!.sourceIndex}/id`);
      continue;
    }
    byId.set(step.id, step);
  }
  // Do not resolve an ambiguous id to whichever duplicate happened to be visited first.
  if (duplicateIds.size > 0) {
    return { status: 'invalid', useCase, steps, diagnostics };
  }
  for (const step of steps) {
    const source = scenario[step.sourceIndex]!;
    if (!Object.hasOwn(source, 'after')) {
      const previous = steps[step.sourceIndex - 1];
      if (previous !== undefined) {
        step.predecessors.push(previous.occurrenceKey);
      }
      continue;
    }
    if (!Array.isArray(source.after)) {
      report('invalid-after', step.sourceIndex, 'after', [], 'after must be an array of scenario-local step ids');
      continue;
    }
    for (const [index, id] of source.after.entries()) {
      if (typeof id !== 'string') {
        report('invalid-after', step.sourceIndex, `after/${index}`, [], 'predecessor must be a scenario-local step id');
        continue;
      }
      const predecessor = byId.get(id);
      if (predecessor === undefined) {
        report('unknown-predecessor', step.sourceIndex, `after/${index}`, [id], `unknown scenario-local predecessor ${id}`);
        continue;
      }
      if (predecessor === step) {
        report('self-predecessor', step.sourceIndex, `after/${index}`, [id], `step ${id} names itself as predecessor`);
        continue;
      }
      step.predecessors.push(predecessor.occurrenceKey);
    }
  }
  // Iterative DFS keeps large scenarios off the JS call stack. Include implicit and forward edges.
  const byKey = new Map(steps.map(step => [step.occurrenceKey, step]));
  const finished = new Set<string>();
  for (const root of steps) {
    const path: UseCaseStepOccurrence[] = [];
    const active = new Map<string, number>();
    const stack = [{ step: root, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const key = frame.step.occurrenceKey;
      if (finished.has(key)) {
        stack.pop();
        continue;
      }
      if (!active.has(key)) {
        active.set(key, path.length);
        path.push(frame.step);
      }
      const predecessorKey = frame.step.predecessors[frame.next++];
      if (predecessorKey === undefined) {
        finished.add(key);
        active.delete(key);
        path.pop();
        stack.pop();
        continue;
      }
      const cycleStart = active.get(predecessorKey);
      if (cycleStart !== undefined) {
        const ring = path.slice(cycleStart);
        const ids = ring.map(step => step.id ?? step.occurrenceKey);
        report('cycle', frame.step.sourceIndex, 'after', ids, `precedence cycle ${[...ids, ids[0]].join(' -> ')} (includes listed predecessors where after is omitted)`);
        continue;
      }
      stack.push({ step: byKey.get(predecessorKey)!, next: 0 });
    }
  }
  return { status: diagnostics.length === 0 ? 'valid' : 'invalid', useCase, steps, diagnostics };
}
