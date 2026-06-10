/**
 * Cliente HTTP do endpoint interno de embeddings (F3-S03 -> F3-S02).
 *
 * Chama `POST {AGENT_RUNTIME_URL}/internal/embed` com Bearer `AGENT_RUNTIME_TOKEN`
 * (mesmo esquema do worker de agentes), em batches, e devolve os vetores 1536-dim
 * na ordem dos textos. Erros são tipados: `EmbedUpstreamError` para 502/5xx (o
 * worker decide retry/DLQ), `EmbedClientError` para 4xx/contrato inválido.
 *
 * Sem dep de `fetch` polyfill: Node 22 traz `fetch` global.
 */

/** Dimensão fixa do embedding (contrato com `kb_chunks.embedding vector(1536)`). */
export const EMBEDDING_DIM = 1536;
/** Máximo de textos por request ao runtime (alinha com o batching de lá). */
const MAX_BATCH = 128;

export interface EmbedConfig {
  readonly baseUrl: string;
  readonly token: string;
}

export interface EmbedResult {
  readonly embeddings: number[][];
  readonly model: string;
  readonly totalTokens: number;
}

/** Falha transitória upstream (502/5xx/timeout) — elegível a retry/DLQ. */
export class EmbedUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedUpstreamError';
  }
}

/** Falha de contrato/cliente (4xx, resposta malformada) — não retriável. */
export class EmbedClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbedClientError';
  }
}

/** Porta injetável (testável sem HTTP real). */
export interface EmbedClient {
  embed(workspaceId: string, texts: string[]): Promise<EmbedResult>;
}

/** Lê a config do runtime do ambiente. Lança cedo se faltar. */
export function embedConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbedConfig {
  const baseUrl = env['AGENT_RUNTIME_URL'];
  const token = env['AGENT_RUNTIME_TOKEN'];
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('embed-client: AGENT_RUNTIME_URL ausente no ambiente.');
  }
  if (token === undefined || token.length === 0) {
    throw new Error('embed-client: AGENT_RUNTIME_TOKEN ausente no ambiente.');
  }
  return { baseUrl, token };
}

/** Implementação HTTP do `EmbedClient` (fetch). */
export class HttpEmbedClient implements EmbedClient {
  constructor(
    private readonly config: EmbedConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(workspaceId: string, texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return { embeddings: [], model: '', totalTokens: 0 };
    }

    const allVectors: number[][] = [];
    let model = '';
    let totalTokens = 0;

    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const { embeddings, model: m, totalTokens: t } = await this.embedBatch(workspaceId, batch);
      allVectors.push(...embeddings);
      model = m;
      totalTokens += t;
    }
    return { embeddings: allVectors, model, totalTokens };
  }

  private async embedBatch(workspaceId: string, texts: string[]): Promise<EmbedResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/internal/embed`;
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({ workspace_id: workspaceId, texts }),
      });
    } catch (err) {
      throw new EmbedUpstreamError(
        `falha de conexão com o runtime: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (resp.status >= 500) {
      throw new EmbedUpstreamError(`runtime indisponível (status ${resp.status})`);
    }
    if (!resp.ok) {
      throw new EmbedClientError(`runtime rejeitou o request (status ${resp.status})`);
    }

    const body: unknown = await resp.json();
    return this.parseBody(body, texts.length);
  }

  private parseBody(body: unknown, expectedCount: number): EmbedResult {
    if (typeof body !== 'object' || body === null) {
      throw new EmbedClientError('resposta do runtime em formato inesperado');
    }
    const obj = body as Record<string, unknown>;
    const embeddings = obj['embeddings'];
    if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) {
      throw new EmbedClientError('resposta do runtime sem embeddings esperados');
    }
    for (const vec of embeddings) {
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
        throw new EmbedClientError(`embedding com dimensão inválida (esperado ${EMBEDDING_DIM})`);
      }
    }
    const usage = (obj['usage'] ?? {}) as Record<string, unknown>;
    return {
      embeddings: embeddings as number[][],
      model: typeof obj['model'] === 'string' ? obj['model'] : '',
      totalTokens: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : 0,
    };
  }
}
