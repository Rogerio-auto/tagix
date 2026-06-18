/**
 * Sanitizacao de URL para links/imagens renderizados a partir de Markdown
 * (F38-S04/S05). Politica de allowlist de esquemas — TUDO que nao casar e
 * descartado (vira `#`, inerte).
 *
 * Aceita: http(s), mailto, tel, e caminhos relativos/internos (`/...`, `#...`,
 * `./`, `../`). REJEITA: `javascript:`, `data:`, `vbscript:`, `file:` e qualquer
 * outro esquema — os vetores classicos de XSS via href/src.
 *
 * Esta e a UNICA fonte de verdade da politica de URL; o render
 * (`Markdown`/`renderInline`) nunca constroi href/src sem passar por aqui.
 */
const SAFE_SCHEME = /^(https?|mailto|tel):/i;
// Esquema explicito = letras/digitos/+/-/. antes de ":" (sem "/" no caminho).
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function sanitizeUrl(raw: string): string {
  const url = raw.trim();
  if (url === '') return '#';
  // Caminho relativo/ancora/protocolo-relativo controlado: sem esquema -> seguro.
  if (!HAS_SCHEME.test(url)) {
    // bloqueia "//evil.com" (protocol-relative) deixando passar "/", "#", "./", "../"
    if (url.startsWith('//')) return '#';
    return url;
  }
  return SAFE_SCHEME.test(url) ? url : '#';
}
