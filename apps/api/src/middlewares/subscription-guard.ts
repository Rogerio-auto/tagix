/**
 * Modo só leitura por assinatura (F71-S06, CONTAS_E_CONVITES §3.4, ameaça T7).
 *
 * Empresa com assinatura `expired` ou `canceled` continua lendo tudo, mas toda escrita de
 * usuário responde `402 { error: 'subscription_inactive' }`. `trial` e `past_due` passam
 * (`past_due` mantém acesso total, com aviso na UI — S08).
 *
 * Onde roda: dentro do `withRLS` (`middlewares/auth.ts`), ou seja, depois do `requireAuth`
 * de TODA rota escopada por empresa, sem tocar o `app.ts`. O status vem do
 * `req.auth.workspace`, que o `requireAuth` acabou de ler do banco neste request — custo
 * zero de consulta e nenhum cache que atrase um pagamento ou uma extensão de trial.
 *
 * Trial vencido conta como `expired` mesmo antes de o worker de cobrança gravar a transição
 * (o tick é de hora em hora): o que decide é `trial_ends_at <= agora`, não a pontualidade
 * do worker. Trial sem `trial_ends_at` (cortesia concedida pelo painel) não vence.
 *
 * Exceções (escrita permitida mesmo inativa) — o mínimo para a pessoa pagar, sair, trocar
 * de empresa, cuidar da própria conta e exercer direitos de titular:
 *  - `/auth/**` (login, logout, aceite de convite);
 *  - `/api/billing/**` (assinar, trocar plano, cancelar);
 *  - `/api/me` e `/api/me/**` (troca de empresa, estado do tour, convites — tudo pessoal);
 *  - preferências e sessão do próprio membro: `PATCH /api/members/me`,
 *    `PATCH /api/members/me/dashboard-layout`, `POST /api/members/me/password`,
 *    `DELETE /api/members/me/sessions/:id` (logout);
 *  - assinatura de Web Push do próprio dispositivo (`/api/push/**`);
 *  - suporte da plataforma (`/api/support/**`): quem está bloqueado precisa falar com a gente;
 *  - `POST /api/conversations/:id/read`: marcar como lida é consequência de ler;
 *  - `POST /api/privacy/exports`: portabilidade (LGPD art. 18, V) é leitura dos próprios dados.
 *
 * As exceções são casadas por método + caminho exatos (sem prefixos largos onde há rotas
 * irmãs com `:id`): `DELETE /api/members/me` NÃO é exceção, porque cairia em
 * `DELETE /api/members/:id`. O caminho é comparado em minúsculas, como o roteador do
 * Express (case-insensitive), sem query string.
 *
 * View-as (impersonation) já é só leitura por outro middleware, que roda antes e recusa
 * escrita com 403 próprio; aqui a guarda sai do caminho para não disputar o código de erro.
 */
import type { NextFunction, Request, Response } from 'express';

/** Status de assinatura que deixam a empresa só leitura. */
export const INACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(['expired', 'canceled']);

/** Métodos que não mudam estado (passam sempre). */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Corpo estável do 402 (o web lê `error`). */
export const SUBSCRIPTION_INACTIVE_ERROR = 'subscription_inactive' as const;

/**
 * Status efetivo da assinatura num instante: `trial` com `trial_ends_at` já passado é
 * `expired`, mesmo que o worker ainda não tenha gravado a transição.
 */
export function effectiveSubscriptionStatus(
  status: string,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): string {
  if (status === 'trial' && trialEndsAt !== null && trialEndsAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return status;
}

/** A empresa está só leitura neste instante? */
export function isSubscriptionInactive(
  status: string,
  trialEndsAt: Date | null,
  now: Date = new Date(),
): boolean {
  return INACTIVE_SUBSCRIPTION_STATUSES.has(effectiveSubscriptionStatus(status, trialEndsAt, now));
}

interface ExemptRule {
  /** `null` = qualquer método. */
  readonly methods: ReadonlySet<string> | null;
  readonly pattern: RegExp;
}

const ANY = null;
const only = (...methods: string[]): ReadonlySet<string> => new Set(methods);
const SEG = '[^/]+';

const EXEMPT_RULES: readonly ExemptRule[] = [
  { methods: ANY, pattern: /^\/auth(?:\/.*)?$/ },
  { methods: ANY, pattern: /^\/api\/billing(?:\/.*)?$/ },
  { methods: ANY, pattern: /^\/api\/me(?:\/.*)?$/ },
  { methods: only('PATCH'), pattern: /^\/api\/members\/me\/?$/ },
  { methods: only('PATCH'), pattern: /^\/api\/members\/me\/dashboard-layout\/?$/ },
  { methods: only('POST'), pattern: /^\/api\/members\/me\/password\/?$/ },
  { methods: only('DELETE'), pattern: new RegExp(`^/api/members/me/sessions/${SEG}/?$`) },
  { methods: ANY, pattern: /^\/api\/push(?:\/.*)?$/ },
  { methods: ANY, pattern: /^\/api\/support(?:\/.*)?$/ },
  { methods: only('POST'), pattern: new RegExp(`^/api/conversations/${SEG}/read/?$`) },
  { methods: only('POST'), pattern: /^\/api\/privacy\/exports\/?$/ },
];

/** Caminho do request sem query, em minúsculas (o roteador do Express ignora caixa). */
function requestPath(req: Request): string {
  const raw = req.originalUrl || req.url;
  const q = raw.indexOf('?');
  return (q === -1 ? raw : raw.slice(0, q)).toLowerCase();
}

/** Esta escrita é permitida mesmo com a assinatura inativa? */
export function isExemptFromSubscriptionGuard(method: string, path: string): boolean {
  const m = method.toUpperCase();
  const p = path.toLowerCase();
  return EXEMPT_RULES.some(
    (rule) => (rule.methods === null || rule.methods.has(m)) && rule.pattern.test(p),
  );
}

/**
 * Guarda de assinatura. Precisa de `req.auth` (rodar depois do `requireAuth`). Sem
 * `req.auth` não decide nada: quem responde 401 é o `requireAuth`/`withRLS`.
 */
export function requireActiveSubscription(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method) || !req.auth || req.impersonation) {
    next();
    return;
  }
  const { subscriptionStatus, trialEndsAt } = req.auth.workspace;
  if (!isSubscriptionInactive(subscriptionStatus, trialEndsAt)) {
    next();
    return;
  }
  if (isExemptFromSubscriptionGuard(req.method, requestPath(req))) {
    next();
    return;
  }
  res.status(402).json({
    error: SUBSCRIPTION_INACTIVE_ERROR,
    message:
      'A assinatura desta empresa não está ativa. Você pode consultar tudo, mas para editar é preciso assinar um plano.',
  });
}
