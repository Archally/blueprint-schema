import { visitLinkCarriers } from './link-provenance.mjs';

/** Findings contain locations only, never credential values or URL parser errors. */
export const evidenceSourceCredentials = (model, subject) => {
  const paths = [];
  const inspect = (path, evidence) => {
    if (!Array.isArray(evidence)) return;
    evidence.forEach((item, index) => {
      if (typeof item?.source !== 'string') return;
      try {
        const url = new URL(item.source);
        if (url.username || url.password) paths.push(`${path}[${index}].source`);
      } catch {
        // Malformed URLs and plain document names remain outside this warning.
      }
    });
  };
  inspect('evidence', subject?.data?.evidence);
  visitLinkCarriers(subject?.data, (carrier, path) => {
    const prefix = path ? `${path}.` : '';
    inspect(`${prefix}provenance.evidence`, carrier.provenance?.evidence);
    for (const [field, entries] of Object.entries(carrier.link_provenance ?? {})) {
      for (const [target, provenance] of Object.entries(entries ?? {})) {
        inspect(`${prefix}link_provenance.${field}[${JSON.stringify(target)}].evidence`, provenance?.evidence);
      }
    }
  });
  if (paths.length === 0) return { ok: true };
  return {
    ok: false,
    context: {
      subject: subject?.data?.id ?? subject?.displayId ?? subject?.id ?? '?',
      paths,
    },
  };
};
