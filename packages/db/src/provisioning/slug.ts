/**
 * Derivação determinística de slug de workspace a partir do nome.
 * ASCII, kebab-case, sem acentos. `workspaces.slug` é UNIQUE — a colisão é
 * resolvida pelo caller com sufixo incremental (-2, -3, ...).
 */

/** Normaliza um nome em slug base (sem dedupe). Sempre não-vazio. */
export function slugifyWorkspaceName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // remove diacriticos (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // não-alfanumérico → hífen
    .replace(/^-+|-+$/g, '') // tira hífens das pontas
    .replace(/-{2,}/g, '-') // colapsa hífens repetidos
    .slice(0, 48);
  return base || 'workspace';
}

/** Gera o candidato de slug para a n-ésima tentativa (0-based → base; 1+ → sufixo). */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const suffix = `-${attempt + 1}`;
  return `${base.slice(0, 48 - suffix.length)}${suffix}`;
}
