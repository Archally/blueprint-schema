/** A list states analysis only when it contains a nonblank string. */
const hasAnalysis = (value) => Array.isArray(value)
  && value.some(item => typeof item === 'string' && item.trim().length > 0);

const hasReplacement = (value) => typeof value === 'string'
  ? value.trim().length > 0
  : hasAnalysis(value);

/** Option letters follow model order: A through Z, then AA, AB. */
function optionLetter(position) {
  let ordinal = position + 1;
  let letter = '';
  while (ordinal > 0) {
    ordinal -= 1;
    letter = String.fromCharCode(65 + ordinal % 26) + letter;
    ordinal = Math.floor(ordinal / 26);
  }
  return letter;
}

/**
 * One warning per current decision with incomplete option analysis.
 * Retired decisions are skipped before their rationale is inspected.
 * The rule file selects the Decision entities this function checks.
 */
export function decisionOptionWithoutProsCons(model, subject) {
  const decision = subject?.data;
  if (!decision) {
    return { ok: true };
  }
  if (decision.status === 'deprecated' || decision.status === 'superseded') {
    return { ok: true };
  }
  if (hasReplacement(decision.links?.superseded_by)) {
    return { ok: true };
  }
  const options = decision.rationale?.options;
  if (!Array.isArray(options) || options.length === 0) {
    return { ok: true };
  }

  const incompleteOptions = [];
  for (const [position, option] of options.entries()) {
    if (typeof option === 'object' && option !== null && hasAnalysis(option.pros) && hasAnalysis(option.cons)) {
      continue;
    }
    const name = typeof option === 'string' ? option : option?.name;
    const label = typeof name === 'string' && name.trim().length > 0 ? JSON.stringify(name) : '(unnamed option)';
    incompleteOptions.push(`${optionLetter(position)} ${label}`);
  }
  if (incompleteOptions.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    context: {
      subject: decision.id ?? subject.displayId ?? subject.id ?? '?',
      subject_name: decision.name ?? subject.name ?? subject.displayId ?? '(unnamed decision)',
      incomplete_options: incompleteOptions.join(', '),
    },
  };
}
