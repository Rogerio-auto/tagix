/**
 * Cliente da RabbitMQ Management HTTP API (F52-S09) — leitura da profundidade das
 * filas para o endpoint de saúde da sincronização.
 *
 * NÃO usa AMQP (não abre canal nem consome): faz um GET HTTP no plugin de
 * management (`rabbitmq:3.13-management-alpine`, porta 15672). Isso evita tocar a
 * topologia (declarar/re-declarar filas pelo lado da API geraria 406) e devolve o
 * snapshot exato que o RabbitMQ já mantém.
 *
 * Credenciais: derivadas do `AMQP_URL` (mesmo usuário/host das filas) ou de um
 * override explícito `RABBITMQ_MANAGEMENT_URL`. Ambos já vivem no `.env` da infra.
 */
import { Buffer } from 'node:buffer';

/** Profundidade de UMA fila, como exposta pela management API. */
export interface QueueDepth {
  readonly name: string;
  readonly vhost: string;
  /** Total = ready + unacked. */
  readonly messages: number;
  readonly ready: number;
  readonly unacked: number;
  readonly consumers: number;
}

/** Porta injetável: busca o snapshot de filas (DI nos testes; default = HTTP real). */
export type FetchQueueDepths = () => Promise<QueueDepth[]>;

interface ResolvedManagement {
  readonly baseUrl: string;
  readonly authHeader: string;
}

/** Shape parcial do item de `/api/queues` que nos interessa (validação defensiva). */
interface RawQueue {
  name?: unknown;
  vhost?: unknown;
  messages?: unknown;
  messages_ready?: unknown;
  messages_unacknowledged?: unknown;
  consumers?: unknown;
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Resolve a URL base + header de auth da management API. Prioriza
 * `RABBITMQ_MANAGEMENT_URL` (com credenciais embutidas, ex.:
 * `http://hm:hm@rabbitmq:15672`); senão deriva do `AMQP_URL` trocando o
 * esquema/porta AMQP (5672) pela HTTP de management (15672), reusando as
 * credenciais. Retorna `null` quando nada está configurado (MQ "não observável").
 */
export function resolveManagementUrl(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedManagement | null {
  const explicit = env['RABBITMQ_MANAGEMENT_URL'];
  const source = explicit && explicit.length > 0 ? explicit : env['AMQP_URL'];
  if (!source || source.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    return null;
  }

  // Quando veio do AMQP_URL, mapeia esquema/porta para a HTTP de management.
  const isAmqp = parsed.protocol === 'amqp:' || parsed.protocol === 'amqps:';
  const scheme = isAmqp ? (parsed.protocol === 'amqps:' ? 'https' : 'http') : parsed.protocol.replace(':', '');
  const port =
    explicit && explicit.length > 0 && parsed.port.length > 0
      ? parsed.port
      : env['RABBITMQ_MANAGEMENT_PORT'] ?? '15672';
  const baseUrl = `${scheme}://${parsed.hostname}:${port}`;

  const user = parsed.username.length > 0 ? decodeURIComponent(parsed.username) : 'guest';
  const pass = parsed.password.length > 0 ? decodeURIComponent(parsed.password) : 'guest';
  const authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  return { baseUrl, authHeader };
}

/**
 * Busca todas as filas via management API. Timeout curto (não pode pendurar o
 * endpoint de saúde). Lança em erro de rede/HTTP — o handler decide degradar.
 */
export function createQueueDepthFetcher(
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 4000,
): FetchQueueDepths {
  return async (): Promise<QueueDepth[]> => {
    const mgmt = resolveManagementUrl(env);
    if (!mgmt) {
      throw new Error('RabbitMQ management API não configurada (AMQP_URL/RABBITMQ_MANAGEMENT_URL ausentes).');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${mgmt.baseUrl}/api/queues`, {
        headers: { authorization: mgmt.authHeader, accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`management API respondeu ${res.status}`);
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) return [];
      return body.map((raw): QueueDepth => {
        const q = raw as RawQueue;
        const ready = asNumber(q.messages_ready);
        const unacked = asNumber(q.messages_unacknowledged);
        const total = asNumber(q.messages);
        return {
          name: asString(q.name),
          vhost: asString(q.vhost),
          messages: total > 0 ? total : ready + unacked,
          ready,
          unacked,
          consumers: asNumber(q.consumers),
        };
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
