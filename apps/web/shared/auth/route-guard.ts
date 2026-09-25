/**
 * Guarda de rota do servidor (F70-S28) — a lógica que o `middleware.ts` executa.
 *
 * Mora aqui, e não no middleware, por um motivo: **é a parte que precisa de teste**.
 * O middleware vira um adaptador de 10 linhas entre o `NextRequest` e esta função.
 *
 * ## O bug que isto fecha
 *
 * O middleware antigo só olhava a PRESENÇA de `hm_session`. Um cookie morto (sessão
 * expirada ou revogada) passava, o layout do app (stub de sessão) passava de novo, e
 * o shell abria vazio sem nunca levar ao login. No PWA, sem barra de endereço, não
 * havia caminho até o formulário.
 *
 * ## O desenho
 *
 * - **Sem cookie** → redirect para `/login?next=…` (como antes), sem chamada de rede.
 * - **Com cookie, navegação de documento** → pergunta à API (`GET /api/me`) se a
 *   sessão vale. `401` → redirect com o motivo e o cookie morto APAGADO na mesma
 *   resposta. É um redirect de servidor: a tela do app nunca chega a piscar.
 * - **API fora do ar / lenta / 5xx** → deixa passar (fail-open). A API continua
 *   barrando cada chamada de dado; aqui só decidimos se vale a pena abrir o shell.
 *   Mandar todo mundo ao login porque a API engasgou 2s seria pior que o bug.
 * - **Pedidos RSC e prefetch** não são checados: a sessão já foi validada na carga
 *   do documento, e um 401 no meio do uso é o handler central do cliente que pega.
 *   Checar aqui dobraria as chamadas a cada clique.
 *
 * Edge-safe: só `fetch`, `URL` e `Headers`.
 */
import { safeNextPath } from '@/shared/lib/safe-redirect';
import { isPublicPath } from '@/shared/lib/public-routes';

/** Valor de `?motivo=` que faz o login explicar por que a pessoa está ali. */
export const SESSION_EXPIRED_REASON = 'sessao-expirada';

/** Resultado da checagem de sessão na API. `unknown` = não deu para saber (fail-open). */
export type SessionCheck = 'valid' | 'invalid' | 'unknown';

/**
 * URL do login com o destino de volta (`next`) e, quando a sessão morreu, o motivo.
 *
 * `next` passa pelo `safeNextPath` (só caminho interno) e é descartado quando é a
 * raiz ou outra tela pública — voltar ao `/login` depois de logar seria um laço.
 */
export function loginUrl(intended: string | null, expired: boolean): string {
  const params = new URLSearchParams();
  const next = intended === null ? '/' : safeNextPath(intended);
  const nextPath = next.split(/[?#]/, 1)[0] ?? '/';
  if (next !== '/' && !isPublicPath(nextPath)) params.set('next', next);
  if (expired) params.set('motivo', SESSION_EXPIRED_REASON);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

/**
 * Para onde ir depois do login. Mesmo filtro do `loginUrl`, aplicado de novo na
 * leitura: o `?next=` chega pela URL e pode ter sido escrito por qualquer um.
 */
export function postLoginPath(rawNext: string | null): string {
  const next = safeNextPath(rawNext);
  const nextPath = next.split(/[?#]/, 1)[0] ?? '/';
  return isPublicPath(nextPath) ? '/' : next;
}

/**
 * `true` para a carga de um documento HTML (digitar a URL, abrir o PWA, recarregar).
 * `false` para pedidos RSC (`RSC: 1`) e prefetch do Next, que acontecem a cada
 * clique e não precisam de nova checagem.
 */
export function isDocumentRequest(headers: Headers): boolean {
  const prefetch = ['next-router-prefetch', 'purpose', 'sec-purpose'].some((h) => headers.has(h));
  if (headers.has('rsc') || prefetch) return false;
  const dest = headers.get('sec-fetch-dest');
  if (dest !== null) return dest === 'document';
  // Safari < 16.4 não manda Sec-Fetch-*: cai no Accept.
  return (headers.get('accept') ?? '').includes('text/html');
}

export interface CheckSessionOptions {
  /** Base da API alcançável pelo servidor web (ex.: `http://api:3001`). */
  readonly apiBase: string;
  readonly fetchImpl?: typeof fetch;
  /** Teto da espera; passou disso, `unknown` (fail-open). */
  readonly timeoutMs?: number;
}

/**
 * Pergunta à API se o token vale. Só `401` é `invalid` — qualquer outra falha
 * (rede, timeout, 5xx, 503 de provider indisponível) é `unknown`.
 */
export async function checkSession(
  token: string,
  { apiBase, fetchImpl = fetch, timeoutMs = 2_500 }: CheckSessionOptions,
): Promise<SessionCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${apiBase}/api/me`, {
      headers: { cookie: `hm_session=${encodeURIComponent(token)}`, accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.ok) return 'valid';
    return res.status === 401 ? 'invalid' : 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export interface RouteRequest {
  readonly pathname: string;
  readonly search: string;
  readonly sessionToken: string | null;
  readonly headers: Headers;
}

export type RouteDecision =
  | { readonly kind: 'next' }
  | { readonly kind: 'redirect'; readonly location: string; readonly clearSession: boolean };

/** Decide o que o middleware faz com a requisição. */
export async function decideRoute(
  req: RouteRequest,
  check: (token: string) => Promise<SessionCheck>,
): Promise<RouteDecision> {
  if (isPublicPath(req.pathname)) return { kind: 'next' };

  const intended = req.pathname + req.search;
  if (!req.sessionToken) {
    return { kind: 'redirect', location: loginUrl(intended, false), clearSession: false };
  }

  if (!isDocumentRequest(req.headers)) return { kind: 'next' };

  const status = await check(req.sessionToken);
  if (status === 'invalid') {
    return { kind: 'redirect', location: loginUrl(intended, true), clearSession: true };
  }
  return { kind: 'next' };
}
