/** Inspect the raw required field, independently of display fallbacks. */
export function hotspotStatementEmpty(model, subject) {
  if (!['Inquiry', 'Risk', 'Finding'].includes(subject?.type)) {
    return { ok: true };
  }
  const statement = subject?.data?.statement;
  if (typeof statement !== 'string') {
    return { ok: true };
  }
  return { ok: statement.trim().length > 0 };
}
