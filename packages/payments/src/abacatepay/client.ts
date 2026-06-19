/**
 * Cliente HTTP tipado da AbacatePay v2.
 *
 * Usa o `fetch` global (Node >= 18) — sem dependências externas. Inclui retry
 * com backoff para falhas transitórias (rede, 429, 5xx), timeout via
 * AbortSignal e parse do envelope `{ data, success, error }` com Zod. Erros
 * sempre saem como `PaymentProviderError`.
 *
 * SEGURANÇA: a API key vive só em memória e só viaja no header `Authorization`.
 * NUNCA é colocada em mensagens de erro, `raw`, ou qualquer log.
 *
 * Base `https://api.abacatepay.com/v2` e endpoints confirmados contra a doc
 * oficial (ver `ENDPOINTS` em `provider.ts`).
 */

import type { z } from 'zod';
import { PaymentProviderError, isRetryableStatus } from '../errors';
import { envelopeSchema } from './schemas';

export const ABACATEPAY_API_BASE = 'https://api.abacatepay.com/v2' as const;

export interface AbacatePayClientOptions {
  /** API key de plataforma (`ABACATEPAY_API_KEY`). Segredo — nunca logar. */
  readonly apiKey: string;
  /** Base override (testes/sandbox). Default: api.abacatepay.com/v2. */
  readonly baseUrl?: string;
  /** Timeout por tentativa, em ms. Default: 15000. */
  readonly timeoutMs?: number;
  /** Tentativas totais (1 = sem retry). Default: 3. */
  readonly maxAttempts?: number;
  /** Backoff base em ms (cresce exponencialmente). Default: 300. */
  readonly backoffBaseMs?: number;
  /**
   * `fetch` injetável (testes). Default: o `fetch` global. Tipado como o
   * `fetch` global para não introduzir `any`.
   */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffBaseMs: 300,
} as const;

/** Corpo JSON arbitrário (sem `any`). */
export type JsonBody = Record<string, unknown>;

export class AbacatePayClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AbacatePayClientOptions) {
    if (!opts.apiKey) {
      throw new PaymentProviderError('AbacatePay API key ausente', {
        httpStatus: 0,
        kind: 'auth',
      });
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? ABACATEPAY_API_BASE;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * POST JSON e valida `data` do envelope contra `dataSchema`.
   * Retorna o `data` já parseado (tipado).
   */
  async post<T extends z.ZodTypeAny>(
    path: string,
    body: JsonBody,
    dataSchema: T,
  ): Promise<z.infer<T>> {
    const raw = await this.request(path, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    return this.parseEnvelope(raw, dataSchema);
  }

  /** GET JSON e valida `data` do envelope contra `dataSchema`. */
  async get<T extends z.ZodTypeAny>(path: string, dataSchema: T): Promise<z.infer<T>> {
    const raw = await this.request(path, { method: 'GET', headers: this.authHeaders() });
    return this.parseEnvelope(raw, dataSchema);
  }

  /** DELETE; não exige corpo de resposta tipado. */
  async delete(path: string): Promise<void> {
    await this.request(path, { method: 'DELETE', headers: this.authHeaders() });
  }

  // --- internos ---------------------------------------------------------

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.apiKey}` };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'content-type': 'application/json', accept: 'application/json' };
  }

  /** Executa com retry, checa status e devolve o JSON bruto. */
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchWithRetry(this.resolveUrl(path), init);
    const json = await this.safeJson(res);
    if (!res.ok) {
      throw PaymentProviderError.fromResponse(res.status, json);
    }
    return json;
  }

  /** Valida o envelope `{ data, success, error }` e devolve `data` tipado. */
  private parseEnvelope<T extends z.ZodTypeAny>(raw: unknown, dataSchema: T): z.infer<T> {
    const envelope = envelopeSchema(dataSchema);
    const parsed = envelope.safeParse(raw);
    if (!parsed.success) {
      throw new PaymentProviderError('Resposta do gateway com shape inesperado', {
        httpStatus: 200,
        kind: 'invalid_response',
        // `raw` é a resposta do gateway (sem credenciais); útil para diagnóstico.
        raw: { issues: parsed.error.issues },
      });
    }
    // `success: false` num 2xx ainda é falha de negócio.
    if (parsed.data.success === false || parsed.data.error != null) {
      throw PaymentProviderError.fromResponse(200, raw, 'Operação rejeitada pelo gateway');
    }
    if (parsed.data.data == null) {
      throw new PaymentProviderError('Resposta do gateway sem `data`', {
        httpStatus: 200,
        kind: 'invalid_response',
      });
    }
    return parsed.data.data as z.infer<T>;
  }

  private resolveUrl(pathOrUrl: string): string {
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return pathOrUrl;
    const sep = pathOrUrl.startsWith('/') ? '' : '/';
    return `${this.baseUrl}${sep}${pathOrUrl}`;
  }

  /** fetch com timeout + retry para falhas transitórias. */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { ...init, signal: controller.signal });
        if (isRetryableStatus(res.status) && attempt < this.maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
        return res;
      } catch (err: unknown) {
        lastError = err;
        if (attempt < this.maxAttempts) {
          await this.backoff(attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    const reason = lastError instanceof Error ? lastError.message : 'network error';
    throw new PaymentProviderError(`Falha de rede após ${this.maxAttempts} tentativas: ${reason}`, {
      httpStatus: 0,
      kind: 'network',
      retryable: true,
    });
  }

  private backoff(attempt: number): Promise<void> {
    const delay = this.backoffBaseMs * 2 ** (attempt - 1);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** Lê o corpo como JSON sem lançar se não for JSON. */
  private async safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return undefined;
    }
  }
}
