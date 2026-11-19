import { companionProblems, visitLinkCarriers } from '../validator/core/link-provenance.mjs';

export { companionProblems, documentCompanionProblems, visitLinkCarriers } from '../validator/core/link-provenance.mjs';

export const linkProvenanceCorrespondence = (model, subject) => {
  const paths = [];
  const data = subject?.data;
  const kind = data?._contractType ?? subject?.type ?? '';
  visitLinkCarriers(data, (carrier, path, carrierKind) => {
    paths.push(...companionProblems(carrier, carrierKind, path).map(problem => subject.fileOrigin ? `${subject.fileOrigin}: ${problem}` : problem));
  }, '', kind);
  return paths.length ? { ok: false, context: { paths, subject: data?.id ?? subject?.displayId ?? subject?.id ?? '?' } } : { ok: true };
};
