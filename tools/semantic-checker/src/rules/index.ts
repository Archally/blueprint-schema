import type { RuleDefinition } from '../types.js';
import { orphanEntities } from './orphan-entities.js';
import { missingCausalLinks } from './missing-causal-links.js';
import { aggregateRootSignals } from './aggregate-root-signals.js';
import { untestedRules } from './untested-rules.js';
import { eventsWithProduces } from './events-with-produces.js';
import { unansweredQuestions } from './unanswered-questions.js';

export const builtinRules: RuleDefinition[] = [
  orphanEntities,
  missingCausalLinks,
  aggregateRootSignals,
  untestedRules,
  eventsWithProduces,
  unansweredQuestions,
];
