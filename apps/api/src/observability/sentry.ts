import * as Sentry from '@sentry/node';
import type { Breadcrumb, Event } from '@sentry/node';

/**
 * Sentry **opt-in** para a API. No-op completo sem `SENTRY_DSN_API`: nenhuma
 * conexão, nenhuma exceção, nenhum overhead. Mesmo padrão de `@hm/logger` OTel
 * (nada liga sem env). Idempotente — chamadas repetidas são ignoradas.
 *
 * O orchestrator chama `initSentry()` no topo do bootstrap (antes de criar o
 * app), e monta `sentryErrorHandler()` como ÚLTIMO middleware antes do error
 * handler central (em F10, o wire em app.ts é do orchestrator).
 */
let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env['SENTRY_DSN_API'];
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['HM_RELEASE'],
    // Tracing opt-in: 0 por default (sem custo); ajustável por env.
    tracesSampleRate: sampleRate('SENTRY_TRACES_SAMPLE_RATE'),
    // Não enviar PII por padrão (telefones/e-mails de contatos não vazam).
    sendDefaultPii: false,
    // Segredos de uso único (convite, prova de email) nunca saem para o Sentry.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  initialized = true;
  return true;
}

// ─── Mascaramento de segredos (F71-S05, B3) ────────────────────────────────────

const MASK = '[redacted]';

/**
 * `/auth/invite/<x>` e `/convite/<x>` (o token do convite), também url-encoded. As rotas
 * literais da API (`/auth/invite/{preview,accept,send-email}`) ficam legíveis.
 */
const SECRET_PATH_RES: readonly RegExp[] = [
  /(\/auth\/invite\/)(?!(?:preview|accept|send-email)(?:[/?#"'\s]|$))[^/?#\s"'&]+/gi,
  /(\/convite\/)[^/?#\s"'&]+/gi,
  /(%2F(?:auth%2Finvite|convite)%2F)[^%?#\s"'&]+/gi,
];
/**
 * `token_hash`, `redirect_to` (leva o link do convite) e `token` em query string ou no
 * fragmento (`#token_hash=…`: o link do email leva a prova ali; runbook §4.3/§4.4).
 */
const SECRET_QUERY_RE = /([?&#]|^)(token_hash|redirect_to|token)=[^&#\s"']*/gi;
/** Chaves de objeto cujo valor nunca sai (corpo do aceite/preview/reset, headers). */
const SECRET_KEY_RE = /token|password|secret|hash|authorization|cookie|emailproof|redirect_to/i;
const MAX_DEPTH = 8;

/**
 * Mascara o token do convite no caminho e os parâmetros de prova (`token_hash`,
 * `redirect_to`, `token`) numa string qualquer (URL, mensagem, referer).
 */
export function scrubInviteSecrets(value: string): string {
  let out = value;
  for (const re of SECRET_PATH_RES) out = out.replace(re, `$1${MASK}`);
  return out.replace(SECRET_QUERY_RE, `$1$2=${MASK}`);
}

/** Mascara strings e redige chaves sensíveis, em profundidade limitada. Não muta a entrada. */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubInviteSecrets(value);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? MASK : scrubDeep(inner, depth + 1);
  }
  return out;
}

function scrubString(value: string | undefined): string | undefined {
  return value === undefined ? undefined : scrubInviteSecrets(value);
}

/**
 * `beforeSend`/`beforeSendTransaction`: URL, query, headers, corpo, transação, mensagem,
 * exceções e breadcrumbs já anexados ao evento. Cookies saem inteiros (a sessão é cookie
 * httpOnly; `sendDefaultPii: false` já os omite — isto é defesa em profundidade contra uma
 * integração que os anexe). Nunca derruba o evento.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.request) {
    const request = { ...event.request };
    delete request.cookies;
    request.url = scrubString(request.url);
    if (request.query_string !== undefined) {
      request.query_string =
        typeof request.query_string === 'string'
          ? scrubInviteSecrets(request.query_string)
          : (scrubDeep(request.query_string) as typeof request.query_string);
    }
    if (request.headers) {
      const headers: Record<string, string> = {};
      for (const [key, inner] of Object.entries(request.headers)) {
        headers[key] = /^(authorization|cookie)$/i.test(key) ? MASK : scrubInviteSecrets(inner);
      }
      request.headers = headers;
    }
    if (request.data !== undefined) {
      if (typeof request.data === 'string') {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(request.data);
        } catch {
          parsed = null;
        }
        request.data =
          parsed !== null && typeof parsed === 'object'
            ? JSON.stringify(scrubDeep(parsed))
            : scrubInviteSecrets(request.data);
      } else {
        request.data = scrubDeep(request.data);
      }
    }
    event.request = request;
  }
  event.transaction = scrubString(event.transaction);
  event.message = scrubString(event.message);
  for (const exception of event.exception?.values ?? []) {
    exception.value = scrubString(exception.value);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => scrubBreadcrumb(breadcrumb));
  }
  return event;
}

/** `beforeBreadcrumb`: mensagem e dados (url/from/to de http e navegação). */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...breadcrumb, message: scrubString(breadcrumb.message) };
  if (breadcrumb.data) out.data = scrubDeep(breadcrumb.data) as Record<string, unknown>;
  return out;
}

function sampleRate(envKey: string): number {
  const raw = process.env[envKey];
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

/** True quando o Sentry foi efetivamente inicializado (DSN presente). */
export function isSentryEnabled(): boolean {
  return initialized;
}

/** Contexto opcional anexado ao evento (tags de correlação, ex.: `ref`, `workspaceId`). */
export interface CaptureContext {
  /** Tags indexáveis/pesquisáveis no Sentry. Valores não-string são ignorados. */
  readonly tags?: Readonly<Record<string, string | undefined>>;
}

/**
 * Captura uma exceção manualmente (no-op se desabilitado). Útil em catch-blocks
 * que tratam o erro mas ainda querem reportá-lo. As `tags` viram dimensões
 * pesquisáveis no Sentry sem contaminar o escopo global (usa `withScope`).
 *
 * Cuidado com PII: passe apenas identificadores de correlação (ref, workspaceId),
 * nunca telefone/e-mail/conteúdo de mensagem.
 */
export function captureException(error: unknown, context?: CaptureContext): void {
  if (!initialized) return;
  const tags = context?.tags;
  if (!tags) {
    Sentry.captureException(error);
    return;
  }
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(tags)) {
      if (typeof value === 'string' && value.length > 0) scope.setTag(key, value);
    }
    Sentry.captureException(error);
  });
}

/**
 * Error handler Express do Sentry (4-args). No-op seguro quando desabilitado —
 * apenas repassa ao próximo handler. Deve preceder o `errorHandler` central.
 */
export function sentryErrorHandler(): ReturnType<typeof Sentry.expressErrorHandler> {
  return Sentry.expressErrorHandler();
}

export { Sentry };
