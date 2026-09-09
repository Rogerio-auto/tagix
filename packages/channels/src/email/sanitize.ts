/**
 * Sanitização de HTML de e-mail recebido (F60-S08 — CANAIS_PLAN §4).
 *
 * E-mail é o vetor clássico de XSS armazenado: o corpo vem de um desconhecido,
 * é guardado, e depois renderizado na inbox de um atendente que está logado. Um
 * `<script>` que sobrevive até ali roda com a sessão dele.
 *
 * A estratégia é **lista de permissão**, não de bloqueio. Lista de bloqueio
 * sempre perde: `<script>` é óbvio, `<svg onload=>` menos, `<math><style>` menos
 * ainda, e a próxima que ninguém previu é a que passa. Aqui só sobrevive o que
 * está explicitamente permitido — o resto é removido, mesmo que seja inofensivo.
 *
 * O repo já leva isso a sério em `uploads.ts`, que bloqueia SVG pelo mesmo motivo.
 *
 * **Escopo:** este módulo é a primeira barreira, não a única. A renderização na
 * UI deve continuar tratando o resultado como não-confiável (iframe isolado ou
 * `srcdoc` com CSP), porque um sanitizador é código e código tem defeito.
 */

/** Tags que podem existir no corpo de um e-mail sem virar vetor. */
const TAGS_PERMITIDAS = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

/**
 * Tags cujo CONTEÚDO também morre, não só a marcação.
 *
 * Remover só a tag de `<script>alert(1)</script>` deixaria `alert(1)` como texto
 * visível — feio e confuso. Em `<style>` o conteúdo pode carregar
 * `expression()` e `url(javascript:)` em navegador antigo.
 */
const TAGS_COM_CONTEUDO_REMOVIDO = new Set(['script', 'style', 'head', 'title', 'noscript']);

/** Atributos permitidos, por tag. Qualquer outro é removido. */
const ATRIBUTOS_PERMITIDOS: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

/**
 * Esquemas de URL aceitos.
 *
 * `javascript:` e `data:` ficam de fora: o primeiro executa, o segundo permite
 * embutir HTML inteiro num `href`. `cid:` é referência a anexo embutido e é
 * resolvido depois, quando o anexo já estiver no nosso storage.
 */
const ESQUEMAS_PERMITIDOS = ['http:', 'https:', 'mailto:', 'tel:', 'cid:'];

/** Comentário HTML pode esconder marcação condicional que alguns clientes executam. */
const COMENTARIOS = /<!--[\s\S]*?-->/g;

function urlSegura(valor: string): boolean {
  const limpo = valor
    .trim()
    // Entidades e caracteres de controle são usados para disfarçar `javascript:`
    // (`java&#115;cript:`, `java\tscript:`). Normalizar antes de decidir.
    .replace(/&#(\d+);?/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    // Remove caracteres de controle sem coloca-los literalmente numa regex:
    // `no-control-regex` reclama com razao, e filtrar por codigo e mais legivel.
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');

  // URL relativa é segura: não carrega esquema.
  if (/^[^a-z]/i.test(limpo) || !limpo.includes(':')) return true;

  const esquema = limpo.slice(0, limpo.indexOf(':') + 1).toLowerCase();
  return ESQUEMAS_PERMITIDOS.includes(esquema);
}

/** Remove atributos não permitidos e URLs com esquema perigoso. */
function limparAtributos(tag: string, bruto: string): string {
  const permitidos = ATRIBUTOS_PERMITIDOS[tag] ?? [];
  if (permitidos.length === 0) return '';

  const saida: string[] = [];
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(bruto)) !== null) {
    const nome = (m[1] ?? '').toLowerCase();
    if (!permitidos.includes(nome)) continue;

    const valor = m[3] ?? m[4] ?? m[5] ?? '';
    if ((nome === 'href' || nome === 'src') && !urlSegura(valor)) continue;

    saida.push(`${nome}="${valor.replace(/"/g, '&quot;')}"`);
  }
  return saida.length > 0 ? ` ${saida.join(' ')}` : '';
}

/**
 * HTML seguro para guardar e exibir.
 *
 * Devolve string vazia para entrada vazia — quem chama decide se mostra o texto
 * puro no lugar.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return '';

  let out = html.replace(COMENTARIOS, '');

  // 1) Tags cujo conteúdo também sai. Feito antes de tudo, e em laço, porque
  //    `<scr<script>ipt>` reconstrói a tag depois de uma passada só.
  for (let i = 0; i < 5; i += 1) {
    const antes = out;
    for (const tag of TAGS_COM_CONTEUDO_REMOVIDO) {
      out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
      // Tag aberta e nunca fechada: o resto do documento vai junto.
      out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*$`, 'gi'), '');
    }
    if (out === antes) break;
  }

  // 2) Toda tag restante passa pela lista de permissão.
  //
  //    O nome da tag precisa COLAR no `<`, sem espaço — é o que o navegador faz.
  //    Aceitar `< b` como tag transformaria o texto legítimo "se a < b" numa tag
  //    `<b>` e deixaria o resto do parágrafo em negrito. Ser mais permissivo que
  //    o navegador não é ser mais seguro: é corromper conteúdo.
  out = out.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g,
    (_full, barra: string, nomeBruto: string, atributos: string) => {
      const nome = nomeBruto.toLowerCase();
      if (!TAGS_PERMITIDAS.has(nome)) return '';
      if (barra === '/') return `</${nome}>`;
      return `<${nome}${limparAtributos(nome, atributos)}>`;
    },
  );

  // 3) O que sobrou de `<` solto vira entidade: sem isso, texto como "a < b"
  //    pode ser reinterpretado como início de tag na renderização.
  out = out.replace(/<(?![a-zA-Z/])/g, '&lt;');

  return out.trim();
}

/** Texto puro a partir do HTML, para prévia na lista de conversas e para busca. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return sanitizeEmailHtml(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
