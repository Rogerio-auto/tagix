/**
 * Serialização canônica do payload de backup (F50). Determinística: chaves ordenadas
 * recursivamente, independente da ordem de inserção — base estável para o checksum sha256
 * (calculado na API). Exclui `exportedAt`/`checksum` (variam/dependem do próprio hash).
 */

function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** String canônica de `{ flows, references }` (entrada do sha256). */
export function canonicalize(payload: { flows: unknown; references: unknown }): string {
  return stableStringify({ flows: payload.flows, references: payload.references });
}
