/**
 * Translate the small set of Airtable `filterByFormula` strings the codebase
 * actually uses into the structured form grid-api understands. Only
 * `RECORD_ID()='X'` is supported (a by-id fetch); anything else throws, so a
 * silently-wrong filter can never slip through.
 */

const RECORD_ID_RE = /^\s*RECORD_ID\(\)\s*=\s*['"]([^'"]+)['"]\s*$/;

/** Returns the record id if the formula is `RECORD_ID()='X'`, else throws. */
export function recordIdFromFormula(formula: string): string {
  const m = formula.match(RECORD_ID_RE);
  if (m) return m[1]!;
  throw new Error(
    `data-client: unsupported filterByFormula ${JSON.stringify(formula)}; ` +
      `pass a structured \`filter\` instead (only RECORD_ID()='X' is translated).`,
  );
}
