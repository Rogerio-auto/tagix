/**
 * Interpolacao de variaveis em strings de flow (FLOW_BUILDER.md §8).
 *
 * Substitui `{{ var.path }}` por `vars[var][path]` (lookup aninhado, dot-path). Token
 * desconhecido fica literal (nao quebra a mensagem). Whitespace interno tolerado.
 */
const TOKEN = /\{\{\s*([\w.-]+)\s*\}\}/g;

function lookup(vars: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => {
    if (obj !== null && typeof obj === 'object' && key in obj) {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, vars);
}

export function interpolate(text: string, vars: Record<string, unknown>): string {
  return text.replace(TOKEN, (full, path: string) => {
    const value = lookup(vars, path);
    if (value === undefined || value === null) return full;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/** Extrai os tokens `{{...}}` referenciados num texto (para validacao de variaveis). */
export function extractVarReferences(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    if (match[1]) refs.push(match[1]);
  }
  return refs;
}
