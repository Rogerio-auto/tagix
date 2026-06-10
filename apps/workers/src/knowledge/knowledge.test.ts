/**
 * Testes do pipeline de ingestao de KB (F3-S03): chunker deterministico,
 * embed-client (502/parse) e o handler (happy path, idempotencia, nack-DLX,
 * doc inexistente). Sem RabbitMQ/DB/HTTP reais; portas/fetch fake.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@hm/logger';
import type { Envelope } from '@hm/shared/mq';
import { chunkDocument, estimateTokens } from './chunker';
import {
  EmbedClientError,
  EmbedUpstreamError,
  HttpEmbedClient,
  EMBEDDING_DIM,
  type EmbedClient,
  type EmbedResult,
} from './embed-client';
import type { EmbeddedChunk, KbDocumentSnapshot, KbIngestStore } from './store';
import { handleKbIngestEnvelope, type KbIngestDeps } from './worker';

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function vec(): number[] {
  return new Array(EMBEDDING_DIM).fill(0.01);
}

function envelope(payload: unknown): Envelope {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    type: 'kb.document.ingest',
    workspaceId: '11111111-1111-1111-1111-111111111111',
    payload,
    ts: Date.now(),
  };
}

describe('chunkDocument', () => {
  it('e deterministico e respeita headings markdown', () => {
    const md = '# Titulo\n\nIntro do doc.\n\n## Secao A\n\nConteudo A.\n\n## Secao B\n\nConteudo B.';
    const a = chunkDocument(md);
    const b = chunkDocument(md);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.map((c) => c.chunkIndex)).toEqual(a.map((_, i) => i));
    const secaoA = a.find((c) => c.content.includes('Conteudo A'));
    expect(secaoA?.metadata.headingPath).toContain('Secao A');
  });

  it('documento vazio nenhum chunk', () => {
    expect(chunkDocument('   \n\n  ')).toEqual([]);
  });

  it('estimateTokens >=1 para conteudo nao-vazio e 0 para vazio', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBeGreaterThanOrEqual(1);
  });
});

describe('HttpEmbedClient', () => {
  const config = { baseUrl: 'http://runtime:8001', token: 'tok' };

  it('502 do runtime -> EmbedUpstreamError', async () => {
    const fakeFetch = vi.fn(async () => new Response('boom', { status: 502 }));
    const client = new HttpEmbedClient(config, fakeFetch as unknown as typeof fetch);
    await expect(client.embed('ws', ['a'])).rejects.toBeInstanceOf(EmbedUpstreamError);
  });

  it('dimensao invalida -> EmbedClientError', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ embeddings: [[0.1, 0.2]], model: 'm', usage: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = new HttpEmbedClient(config, fakeFetch as unknown as typeof fetch);
    await expect(client.embed('ws', ['a'])).rejects.toBeInstanceOf(EmbedClientError);
  });

  it('happy path devolve vetores 1536-dim na ordem', async () => {
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            embeddings: [vec(), vec()],
            model: 'text-embedding-3-small',
            usage: { total_tokens: 6 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const client = new HttpEmbedClient(config, fakeFetch as unknown as typeof fetch);
    const out = await client.embed('ws', ['a', 'b']);
    expect(out.embeddings).toHaveLength(2);
    expect(out.embeddings[0]).toHaveLength(EMBEDDING_DIM);
    expect(out.totalTokens).toBe(6);
  });
});

class FakeStore implements KbIngestStore {
  doc: KbDocumentSnapshot | null;
  replaced: EmbeddedChunk[] | null = null;
  activated = false;
  replaceCalls = 0;

  constructor(doc: KbDocumentSnapshot | null) {
    this.doc = doc;
  }

  async loadDocument(): Promise<KbDocumentSnapshot | null> {
    return this.doc;
  }

  async replaceChunks(_ws: string, _id: string, chunks: EmbeddedChunk[]): Promise<void> {
    this.replaceCalls += 1;
    this.replaced = chunks;
  }

  async markActive(): Promise<void> {
    this.activated = true;
  }
}

function fakeEmbed(impl?: (texts: string[]) => Promise<EmbedResult>): EmbedClient {
  return {
    embed: async (_ws: string, texts: string[]): Promise<EmbedResult> =>
      impl
        ? impl(texts)
        : { embeddings: texts.map(() => vec()), model: 'm', totalTokens: texts.length },
  };
}

const docSnap: KbDocumentSnapshot = {
  id: '22222222-2222-2222-2222-222222222222',
  workspaceId: '11111111-1111-1111-1111-111111111111',
  rawContent: '# Doc\n\nConteudo do documento para indexar.',
};

describe('handleKbIngestEnvelope', () => {
  it('happy path: chunks com embedding + status active', async () => {
    const store = new FakeStore(docSnap);
    const deps: KbIngestDeps = { store, embedClient: fakeEmbed(), logger };
    await handleKbIngestEnvelope(
      envelope({ workspaceId: docSnap.workspaceId, documentId: '22222222-2222-2222-2222-222222222222', reason: 'create' }),
      deps,
    );
    expect(store.activated).toBe(true);
    expect(store.replaced).not.toBeNull();
    expect(store.replaced!.length).toBeGreaterThan(0);
    expect(store.replaced![0]!.embedding).toHaveLength(EMBEDDING_DIM);
  });

  it('idempotente: reprocesso chama replaceChunks', async () => {
    const store = new FakeStore(docSnap);
    const deps: KbIngestDeps = { store, embedClient: fakeEmbed(), logger };
    await handleKbIngestEnvelope(
      envelope({ workspaceId: docSnap.workspaceId, documentId: '22222222-2222-2222-2222-222222222222', reason: 'reprocess' }),
      deps,
    );
    expect(store.replaceCalls).toBe(1);
  });

  it('embed upstream 502 re-lanca', async () => {
    const store = new FakeStore(docSnap);
    const deps: KbIngestDeps = {
      store,
      embedClient: fakeEmbed(async () => {
        throw new EmbedUpstreamError('down');
      }),
      logger,
    };
    await expect(
      handleKbIngestEnvelope(
        envelope({ workspaceId: docSnap.workspaceId, documentId: '22222222-2222-2222-2222-222222222222', reason: 'create' }),
        deps,
      ),
    ).rejects.toBeInstanceOf(EmbedUpstreamError);
    expect(store.activated).toBe(false);
  });

  it('embed 4xx nao-retriavel: doc fica draft, nao lanca', async () => {
    const store = new FakeStore(docSnap);
    const deps: KbIngestDeps = {
      store,
      embedClient: fakeEmbed(async () => {
        throw new EmbedClientError('bad');
      }),
      logger,
    };
    await handleKbIngestEnvelope(
      envelope({ workspaceId: docSnap.workspaceId, documentId: '22222222-2222-2222-2222-222222222222', reason: 'create' }),
      deps,
    );
    expect(store.activated).toBe(false);
  });

  it('documento inexistente: descarta sem lancar', async () => {
    const store = new FakeStore(null);
    const deps: KbIngestDeps = { store, embedClient: fakeEmbed(), logger };
    await handleKbIngestEnvelope(
      envelope({ workspaceId: docSnap.workspaceId, documentId: '33333333-3333-3333-3333-333333333333', reason: 'create' }),
      deps,
    );
    expect(store.activated).toBe(false);
    expect(store.replaceCalls).toBe(0);
  });

  it('payload invalido: descarta sem lancar', async () => {
    const store = new FakeStore(docSnap);
    const deps: KbIngestDeps = { store, embedClient: fakeEmbed(), logger };
    await handleKbIngestEnvelope(envelope({ bogus: true }), deps);
    expect(store.replaceCalls).toBe(0);
  });
});
