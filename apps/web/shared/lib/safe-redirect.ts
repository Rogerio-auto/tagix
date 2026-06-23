/**
 * Guard contra open-redirect (F44-S07, T11). Um ?next= controlado pelo usuario
 * so pode apontar para um caminho INTERNO same-origin. Absolutos, protocol-relative
 * //host, esquemas (javascript:) e backslash-tricks sao rejeitados para um fallback.
 */

const DEFAULT_PATH = '/';

/** Normaliza um destino de retorno em um caminho interno seguro (fallback / se inseguro). */
export function safeNextPath(next: string | null | undefined, fallback = DEFAULT_PATH): string {
  if (typeof next !== 'string' || next.length === 0) return fallback;
  if (next[0] !== '/') return fallback;
  if (next[1] === '/' || next[1] === '\\') return fallback;
  if (next.includes('\\')) return fallback;
  // Caracteres de controle (newline/tab/etc. usados em bypasses).
  // eslint-disable-next-line no-control-regex -- intencional: bloqueia bytes de controle em bypass
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const base = 'https://leadium.internal';
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
