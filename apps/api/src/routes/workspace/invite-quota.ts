/**
 * Cota de envio de email de convite (F71-S05, T8 — email bombing e cota de SMTP).
 *
 * Contadores no Redis, consumidos ANTES do envio por um script Lua (checa todos os tetos e
 * só então incrementa todos — atômico: dois requests simultâneos nunca furam o teto, e um
 * envio recusado não gasta cota de ninguém). Janela fixa por chave.
 *
 * | chave                     | teto | janela | por quê |
 * |---------------------------|------|--------|---------|
 * | empresa                   | 30   | 1 h    | spam a partir de uma empresa (conta comprometida, admin hostil) |
 * | destinatário (sha256)     | 10   | 24 h   | bombing de UMA caixa somando várias empresas; revogar + recriar não zera |
 * | convite, link público     | 1    | 60 s   | cooldown do "me mande o email" da página do convite |
 * | convite, link público     | 5    | 7 dias | teto do convite pela rota pública (vida do link) |
 *
 * 10/dia por destinatário: um convite legítimo gasta 1 envio e no máximo 6 (1 + 5
 * reenvios); quem é convidado por duas ou três empresas no mesmo dia ainda cabe com folga.
 * Acima disso o padrão é abuso, e o custo de errar (a pessoa espera até amanhã ou o admin
 * copia o link) é baixo perto de deixar uma caixa ser inundada a partir de várias empresas.
 * O endereço entra só como sha256 na chave (nada de email em claro no Redis).
 *
 * Falha do Redis: LANÇA `InviteQuotaUnavailableError` (fail-closed). Quem chama decide a
 * degradação: o convite novo fica criado sem email (o admin copia o link); reenvio e envio
 * público respondem 503. Ao contrário do rate-limit de login, aqui não há usuário legítimo
 * trancado: o link copiável continua funcionando.
 */
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { loadConfig } from '../../config';

export const INVITE_SENDS_PER_WORKSPACE_HOUR = 30;
export const INVITE_SENDS_PER_RECIPIENT_DAY = 10;
export const PUBLIC_SEND_COOLDOWN_SEC = 60;
export const PUBLIC_SENDS_PER_INVITE = 5;

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const PUBLIC_WINDOW_SEC = 7 * DAY;

let redis: Redis | null = null;
function client(): Redis {
  redis ??= new Redis(loadConfig().redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return redis;
}

/** Fecha a conexão (teardown de teste; paridade com `closeRateLimit`). */
export async function closeInviteQuota(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

export class InviteQuotaUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Cota de envio de convite indisponível (Redis).', options);
    this.name = 'InviteQuotaUnavailableError';
  }
}

export type InviteQuotaReason =
  | 'workspace_hourly'
  | 'recipient_daily'
  | 'invite_cooldown'
  | 'invite_public_cap';

export type InviteQuotaResult =
  | {
      readonly ok: true;
      /** Devolve a cota quando nada foi enviado (ex.: o reenvio perdeu a corrida no banco). */
      release(): Promise<void>;
    }
  | { readonly ok: false; readonly reason: InviteQuotaReason; readonly retryAfterSec: number };

export interface InviteQuotaLimits {
  readonly workspacePerHour: number;
  readonly recipientPerDay: number;
  readonly publicCooldownSec: number;
  readonly publicPerInvite: number;
}

export interface InviteQuotaOptions {
  /** Prefixo das chaves (testes isolam por execução). */
  readonly prefix?: string;
  readonly limits?: Partial<InviteQuotaLimits>;
}

export interface ConsumeInput {
  readonly workspaceId: string;
  readonly email: string;
  /** Envio pedido pela página pública do convite: soma o cooldown e o teto do convite. */
  readonly publicInviteId?: string;
}

export interface InviteSendQuota {
  consume(input: ConsumeInput): Promise<InviteQuotaResult>;
}

/**
 * KEYS = contadores…, [cooldown]. ARGV = n, (max, ttl)×n, cooldownTtl (0 = sem cooldown).
 * Retorno: {0, 0} consumiu; {-1, pttl} em cooldown; {i, pttl} o contador i (1-based) estourou.
 */
const CONSUME_LUA = `
local n = tonumber(ARGV[1])
local cd = tonumber(ARGV[2 + 2 * n])
if cd > 0 and redis.call('EXISTS', KEYS[n + 1]) == 1 then
  return {-1, redis.call('PTTL', KEYS[n + 1])}
end
for i = 1, n do
  local cur = tonumber(redis.call('GET', KEYS[i]) or '0')
  if cur >= tonumber(ARGV[2 * i]) then
    return {i, redis.call('PTTL', KEYS[i])}
  end
end
for i = 1, n do
  local v = redis.call('INCR', KEYS[i])
  if v == 1 or redis.call('PTTL', KEYS[i]) < 0 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[2 * i + 1]))
  end
end
if cd > 0 then
  redis.call('SET', KEYS[n + 1], '1', 'EX', cd)
end
return {0, 0}
`;

/** KEYS = contadores…, [cooldown]. ARGV = n. Decrementa (sem passar de zero) e solta o cooldown. */
const RELEASE_LUA = `
local n = tonumber(ARGV[1])
for i = 1, n do
  local cur = tonumber(redis.call('GET', KEYS[i]) or '0')
  if cur > 0 then redis.call('DECR', KEYS[i]) end
end
if #KEYS > n then redis.call('DEL', KEYS[n + 1]) end
return 1
`;

const evalResultSchema = z.tuple([z.number(), z.number()]);

function recipientKeyPart(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

export function createInviteSendQuota(options: InviteQuotaOptions = {}): InviteSendQuota {
  const prefix = options.prefix ?? 'invq';
  const limits: InviteQuotaLimits = {
    workspacePerHour: INVITE_SENDS_PER_WORKSPACE_HOUR,
    recipientPerDay: INVITE_SENDS_PER_RECIPIENT_DAY,
    publicCooldownSec: PUBLIC_SEND_COOLDOWN_SEC,
    publicPerInvite: PUBLIC_SENDS_PER_INVITE,
    ...options.limits,
  };

  return {
    async consume(input: ConsumeInput): Promise<InviteQuotaResult> {
      const counters: Array<{ key: string; max: number; ttl: number; reason: InviteQuotaReason }> = [
        {
          key: `${prefix}:ws:${input.workspaceId}`,
          max: limits.workspacePerHour,
          ttl: HOUR,
          reason: 'workspace_hourly',
        },
        {
          key: `${prefix}:to:${recipientKeyPart(input.email)}`,
          max: limits.recipientPerDay,
          ttl: DAY,
          reason: 'recipient_daily',
        },
      ];
      let cooldownKey: string | null = null;
      if (input.publicInviteId) {
        counters.push({
          key: `${prefix}:pub:${input.publicInviteId}`,
          max: limits.publicPerInvite,
          ttl: PUBLIC_WINDOW_SEC,
          reason: 'invite_public_cap',
        });
        cooldownKey = `${prefix}:pubcd:${input.publicInviteId}`;
      }
      const keys = counters.map((c) => c.key);
      if (cooldownKey) keys.push(cooldownKey);
      const args: Array<string | number> = [counters.length];
      for (const c of counters) args.push(c.max, c.ttl);
      args.push(cooldownKey ? limits.publicCooldownSec : 0);

      let raw: unknown;
      try {
        raw = await client().eval(CONSUME_LUA, keys.length, ...keys, ...args);
      } catch (err: unknown) {
        throw new InviteQuotaUnavailableError({ cause: err });
      }
      const parsed = evalResultSchema.safeParse(raw);
      if (!parsed.success) throw new InviteQuotaUnavailableError();
      const [code, pttl] = parsed.data;
      const retryAfterSec = Math.max(1, Math.ceil(pttl / 1000));
      if (code === -1) return { ok: false, reason: 'invite_cooldown', retryAfterSec };
      const denied = code > 0 ? counters[code - 1] : undefined;
      if (denied) return { ok: false, reason: denied.reason, retryAfterSec };

      return {
        ok: true,
        async release(): Promise<void> {
          try {
            await client().eval(RELEASE_LUA, keys.length, ...keys, counters.length);
          } catch {
            // Best-effort: no pior caso a cota fica um envio mais curta até a janela virar.
          }
        },
      };
    },
  };
}
