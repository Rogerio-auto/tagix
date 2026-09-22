/**
 * Decisão de cache do service worker (F61-S01).
 *
 * Vive separado do `sw.js` por um motivo só: **é a parte que precisa de teste**.
 * Um service worker roda num contexto que o Vitest não tem (sem `self`, sem
 * `caches`, sem ciclo install/activate), então a regra que decide o que pode e o
 * que não pode ser cacheado fica aqui, como função pura, e o worker só a executa.
 *
 * É um módulo ESM carregado por um service worker de tipo `module` (Safari 15.4+,
 * Chrome 91+). Onde o navegador não suportar, o registro simplesmente falha e o
 * app continua funcionando sem service worker — que é exatamente o comportamento
 * de hoje.
 *
 * ## A regra que não se negocia
 *
 * **Dado de negócio não entra em cache.** "12 leads esperando" servido do cache de
 * ontem é pior que um erro honesto: o erro faz o dono tentar de novo, o número
 * velho faz ele ir dormir tranquilo. Leitura offline é outro slot (F61-S06) e
 * exige carimbo de "visto às 14:32" — que ainda não existe.
 *
 * @typedef {'cache-first'|'network-first'|'stale-while-revalidate'|'network-only'} Strategy
 */

/**
 * Caminhos que NUNCA podem ser servidos do cache, com o motivo.
 *
 * `/api` é dado de negócio. `/auth` e `/socket.io` são sessão e tempo real:
 * responder do cache produziria um usuário "logado" que não está, ou um socket
 * que não conecta.
 */
const NUNCA_CACHE = ['/api/', '/auth/', '/socket.io'];

/**
 * Escolhe a estratégia para uma requisição.
 *
 * Assinatura deliberadamente sem `Request`: recebe os dados já extraídos para
 * poder ser testada sem DOM e sem mocks.
 *
 * @param {{ url: string, method: string, mode?: string, destination?: string, sameOrigin?: boolean }} req
 * @returns {Strategy}
 */
export function chooseStrategy(req) {
  // 1. Só GET tem cache. Um POST cacheado seria uma ação repetida sem o usuário
  //    pedir — a categoria de bug mais cara que existe num CRM.
  if (req.method !== 'GET') return 'network-only';

  // 2. Origem externa (R2, Google Fonts, CDN): passa direto. Cachear mídia
  //    assinada guardaria uma URL que expira em 7 dias e volta 403 depois.
  if (req.sameOrigin === false) return 'network-only';

  let caminho;
  try {
    caminho = new URL(req.url, 'https://placeholder.invalid').pathname;
  } catch {
    // URL que não parseia não é problema do cache: manda para a rede.
    return 'network-only';
  }

  // 3. Dado de negócio, sessão e tempo real: rede pura, sempre.
  if (NUNCA_CACHE.some((p) => caminho.startsWith(p))) return 'network-only';

  // 4. Build output com hash no nome: o path É a versão, então nunca muda de
  //    conteúdo. Cache-first aqui é o que paga o slot inteiro em 4G.
  if (caminho.startsWith('/_next/static/')) return 'cache-first';

  // 5. Navegação (o documento HTML). Network-first: o dono prefere esperar
  //    300ms a abrir a tela de ontem. O cache é rede de segurança para quando
  //    a rede não responde, não atalho de velocidade.
  if (req.mode === 'navigate' || req.destination === 'document') return 'network-first';

  // 6. Ícones e fontes: mudam pouco e não mentem sobre o negócio. Serve rápido
  //    do cache e atualiza atrás.
  if (
    caminho.startsWith('/icons/') ||
    req.destination === 'font' ||
    req.destination === 'style' ||
    req.destination === 'image'
  ) {
    return 'stale-while-revalidate';
  }

  // 7. Default: rede. Um SW que cacheia o que não conhece é um SW que vai
  //    mentir sobre alguma coisa que ainda não foi inventada.
  return 'network-only';
}

/**
 * Extrai de um `Request` real o formato que `chooseStrategy` entende.
 *
 * @param {Request} request
 * @param {string} origin
 */
export function describeRequest(request, origin) {
  return {
    url: request.url,
    method: request.method,
    mode: request.mode,
    destination: request.destination,
    sameOrigin: request.url.startsWith(origin),
  };
}
