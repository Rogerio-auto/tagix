/**
 * Cliente HTTP da WAHA API (WhatsApp HTTP API — provider não-oficial).
 *
 * Usa o `fetch` global (Node >= 18) — SEM dependências externas. WAHA expõe
 * uma REST API local/self-hosted; autentica via header `X-Api-Key`. Inclui
 * retry simples com backoff para falhas transitórias (rede, 429, 5xx) e
 * timeout via AbortSignal. Espelha o estilo do `GraphClient` (LIVECHAT.md §2.3).
 */

export interface WahaClientOptions {
  /** Base URL da instância WAHA (ex.: `http://localhost:3000`). Obrigatória. */
  readonly baseUrl: string;
  /** API key da WAHA (header `X-Api-Key`). Opcional se a instância é aberta. */
  readonly apiKey?: string;
  /** Timeout por tentativa, em ms. Default: 15000. */
  readonly timeoutMs?: number;
  /** Tentativas totais (1 = sem retry). Default: 3. */
  readonly maxAttempts?: number;
  /** Backoff base em ms (cresce exponencialmente). Default: 300. */
  readonly backoffBaseMs?: number;
}

/** Corpo JSON arbitrário enviado/recebido (sem `any`). */
export type WahaJsonBody = Record<string, unknown>;

const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffBaseMs: 300,
} as const;

/** Erro normalizado da WAHA API. `httpStatus` 0 = falha de rede / timeout. */
export class WahaError extends Error {
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly raw?: unknown;

  constructor(
    message: string,
    opts: { httpStatus: number; retryable?: boolean; raw?: unknown },
  ) {
    super(message);
    this.name = 'WahaError';
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
    this.raw = opts.raw;
    Object.setPrototypeOf(this, WahaError.prototype);
  }
}

/** 0 (rede) + 429 + 5xx são transitórios. 409/422 NÃO (conflito/validação). */
export function isRetryableStatus(httpStatus: number): boolean {
  return httpStatus === 0 || httpStatus === 429 || httpStatus >= 500;
}

export class WahaClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;

  constructor(opts: WahaClientOptions) {
    // Remove barra final para concatenar paths de forma estável.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  }

  /** POST JSON em um path da WAHA; retorna o JSON da resposta. */
  async post(path: string, body: WahaJsonBody): Promise<unknown> {
    return this.request(path, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** GET JSON em um path da WAHA. */
  async get(path: string): Promise<unknown> {
    return this.request(path, { method: 'GET', headers: this.authHeaders() });
  }

  /** Baixa um binário (mídia) de uma URL absoluta servida pela WAHA. */
  async downloadBinary(url: string): Promise<Buffer> {
    const res = await this.fetchWithRetry(this.resolveUrl(url), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new WahaError(`WAHA download falhou (HTTP ${res.status}).`, {
        httpStatus: res.status,
        retryable: isRetryableStatus(res.status),
        raw: await this.safeJson(res),
      });
    }
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /** Header de auth da WAHA (`X-Api-Key`), omitido se sem key. */
  private authHeaders(): Record<string, string> {
    return this.apiKey !== undefined ? { 'x-api-key': this.apiKey } : {};
  }

  /** Núcleo: monta a URL, executa com retry e parseia o JSON. */
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchWithRetry(this.resolveUrl(path), init);
    const json = await this.safeJson(res);
    if (!res.ok) {
      throw new WahaError(extractMessage(json) ?? `WAHA API error (HTTP ${res.status}).`, {
        httpStatus: res.status,
        retryable: isRetryableStatus(res.status),
        raw: json,
      });
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
    throw new WahaError(`WAHA request falhou após ${this.maxAttempts} tentativas: ${reason}`, {
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

/** Extrai uma mensagem de erro legível do corpo WAHA (`{ message }`). */
function extractMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const message = record['message'];
  return typeof message === 'string' ? message : undefined;
}
