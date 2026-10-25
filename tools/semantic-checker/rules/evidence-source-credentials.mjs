/**
 * Report locations only: neither a URL nor a URL parser's error may enter a finding.
 * Evidence is flat on governance entities and nested under provenance on design entities
 * (including test cases). Inspect those two fields without searching unrelated source fields.
 */
export const evidenceSourceCredentials = (model, subject) => {
  const paths = [];
  for (const [path, evidence] of [
    ['evidence', subject?.data?.evidence],
    ['provenance.evidence', subject?.data?.provenance?.evidence],
  ]) {
    if (!Array.isArray(evidence)) continue;
    evidence.forEach((item, index) => {
      if (typeof item?.source !== 'string') return;
      try {
        // No base: relative references and plain document names are not absolute URLs.
        const url = new URL(item.source);
        if (url.username || url.password) paths.push(`${path}[${index}].source`);
      } catch {
        // Invalid URL text is permitted by the evidence schema and is outside this warning.
      }
    });
  }
  if (paths.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      subject: subject?.data?.id ?? subject?.displayId ?? subject?.id ?? '?',
      paths,
    },
  };
};
