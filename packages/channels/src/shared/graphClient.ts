/**
 * Cliente HTTP compartilhado para a Graph API (graph.facebook.com/v23.0).
 *
 * Usa o `fetch` global (Node >= 18) — SEM dependências externas. Inclui retry
 * simples com backoff para falhas transitórias e timeout via AbortSignal.
 * Comum a WhatsApp e Instagram (LIVECHAT.md §2.2).
 */

import { MetaError, isRetryableStatus } from './errors';

export const GRAPH_API_VERSION = 'v23.0' as const;
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}` as const;

export interface GraphClientOptions {
  /** Base override (testes). Default: graph.facebook.com/v23.0. */
  readonly baseUrl?: string;
  /** Timeout por tentativa, em ms. Default: 15000. */
  readonly timeoutMs?: number;
  /** Tentativas totais (1 = sem retry). Default: 3. */
  readonly maxAttempts?: number;
  /** Backoff base em ms (cresce exponencialmente). Default: 300. */
  readonly backoffBaseMs?: number;
}

/** Corpo JSON arbitrário enviado/recebido (sem `any`). */
export type JsonBody = Record<string, unknown>;

const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffBaseMs: 300,
} as const;

export class GraphClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;

  constructor(opts: GraphClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? GRAPH_API_BASE;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  }

  /** POST JSON em um path do Graph; retorna o JSON da resposta. */
  async post(path: string, body: JsonBody, accessToken: string): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  /** GET JSON em um path do Graph. */
  async get(path: string, accessToken: string): Promise<unknown> {
    return this.request(path, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  /** DELETE em um path do Graph. */
  async delete(path: string, accessToken: string): Promise<unknown> {
    return this.request(path, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  /** Baixa um binário (ex.: mídia com URL temporária IG). */
  async downloadBinary(url: string, accessToken?: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;

    const res = await this.fetchWithRetry(this.resolveUrl(url), { method: 'GET', headers });
    if (!res.ok) {
      throw MetaError.fromResponse(res.status, await this.safeJson(res));
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /** Núcleo: monta a URL, executa com retry e parseia o JSON. */
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchWithRetry(this.resolveUrl(path), init);
    const json = await this.safeJson(res);
    if (!res.ok) {
      throw MetaError.fromResponse(res.status, json);
    }
    return json;
  }

  /** Concatena base + path (aceita URL absoluta). */
  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
    const sep = pathOrUrl.startsWith('/') ? '' : '/';
    return `${this.baseUrl}${sep}${pathOrUrl}`;
  }

  /** fetch com timeout + retry para falhas transitórias (rede, 429, 5xx). */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        // 429/5xx são transitórios — tenta de novo se ainda há tentativas.
        if (isRetryableStatus(res.status) && attempt < this.maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
        return res;
      } catch (err: unknown) {
        // Erro de rede / abort por timeout: retenta se possível.
        lastError = err;
        if (attempt < this.maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // Esgotou tentativas em erro de rede/timeout.
    const reason = lastError instanceof Error ? lastError.message : 'network error';
    throw new MetaError(`Graph request failed after ${this.maxAttempts} attempts: ${reason}`, {
      httpStatus: 0,
      retryable: true,
      raw: lastError,
    });
  }

  /** Backoff exponencial simples (300ms, 600ms, 1200ms, ...). */
  private backoff(attempt: number): Promise<void> {
    const delay = this.backoffBaseMs * 2 ** (attempt - 1);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** Lê o corpo como JSON sem lançar se não for JSON (ex.: erro HTML). */
  private async safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }
}
