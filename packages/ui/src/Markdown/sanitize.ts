/**
 * Sanitizacao de URL para links renderizados a partir de Markdown (F38-S04/S05).
 * Politica de allowlist de esquemas — tudo que nao casar vira `#` (inerte).
 *
 * Aceita: http(s), mailto, tel e caminhos relativos (/, #, ./, ../).
 * REJEITA: javascript:, data:, vbscript:, file: e qualquer outro esquema.
 * Unica fonte de verdade da politica de URL do render de Markdown.
 */
const SAFE_SCHEME = /^(https?|mailto|tel):/i;
// Esquema explicito = letra inicial + [a-z0-9+.-] ate ':' (sem '/').
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// Chars de controle que o browser ignora ao parsear o esquema (tab/newline/etc).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export function sanitizeUrl(raw: string): string {
  // Defense-in-depth: tira chars de controle para impedir obfuscacao tipo
  // 'java<TAB>script:'. A gramatica de link do parser ja rejeita whitespace na
  // URL; isto blinda o util para reuso fora do parser.
  const url = raw.replace(CONTROL_CHARS, '').trim();
  if (url === '') return '#';
  // Sem esquema -> relativo/ancora (seguro); bloqueia protocol-relative '//'.
  if (!HAS_SCHEME.test(url)) {
    if (url.startsWith('//')) return '#';
    return url;
  }
  return SAFE_SCHEME.test(url) ? url : '#';
}
