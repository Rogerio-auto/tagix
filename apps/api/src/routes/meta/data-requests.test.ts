/**
 * F69-S01 — os callbacks que a Meta chama sem sessão.
 *
 * O que este arquivo protege: que ninguém sem o App Secret consiga pedir a
 * exclusão dos dados de outra pessoa, que um pedido repetido não vire dois, e que
 * a página pública de acompanhamento nunca revele quem pediu.
 */
import { createHmac } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { MetaDataRequest } from '@hm/db';
import { createMetaDataRequestsRouter, type DataRequestStore } from './data-requests';

const SEGREDO = 'segredo-de-teste';
const semLimite: RequestHandler = (_req, _res, next) => next();

function assinar(payload: unknown, segredo = SEGREDO): string {
  const codificado = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${createHmac('sha256', segredo).update(codificado).digest('base64url')}.${codificado}`;
}

/** Store em memória com a mesma semântica da tabela. */
function memoria(): DataRequestStore & { linhas: MetaDataRequest[] } {
  const linhas: MetaDataRequest[] = [];
  return {
    linhas,
    async findLatest(kind, metaUserId) {
      const achados = linhas.filter((l) => l.kind === kind && l.metaUserId === metaUserId);
      return achados[achados.length - 1] ?? null;
    },
    async create(input) {
      const linha: MetaDataRequest = {
        id: `id-${linhas.length + 1}`,
        kind: input.kind,
        metaUserId: input.metaUserId,
        confirmationCode: input.confirmationCode,
        status: 'received',
        itemsRemoved: 0,
        requestedAt: new Date('2026-09-14T12:00:00Z'),
        completedAt: null,
      };
      linhas.push(linha);
      return linha;
    },
    async finish(id, status, itemsRemoved, at) {
      const l = linhas.find((x) => x.id === id);
      if (l) Object.assign(l, { status, itemsRemoved, completedAt: at });
    },
    async findByCode(code) {
      return linhas.find((l) => l.confirmationCode === code) ?? null;
    },
  };
}

function montar(over: Partial<Parameters<typeof createMetaDataRequestsRouter>[0]> = {}) {
  const store = memoria();
  const app = express();
  app.use(
    createMetaDataRequestsRouter({
      appSecret: () => SEGREDO,
      publicAppUrl: () => 'https://app.leadium.com.br/',
      store,
      limiter: semLimite,
      ...over,
    }),
  );
  return { app, store };
}

const pedido = { algorithm: 'HMAC-SHA256', user_id: 'asid-123', issued_at: 1_790_000_000 };

describe('POST /meta/data-deletion', () => {
  it('responde url de acompanhamento e código de confirmação, como a Meta exige', async () => {
    const { app } = montar();
    const res = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });

    expect(res.status).toBe(200);
    expect(res.body.confirmation_code).toMatch(/^[A-Za-z0-9_-]{24}$/);
    // Barra final da base não vira barra dupla na URL.
    expect(res.body.url).toBe(
      `https://app.leadium.com.br/exclusao-de-dados/${res.body.confirmation_code}`,
    );
  });

  it('assinatura forjada é recusada e nada é registrado', async () => {
    const { app, store } = montar();
    const res = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido, 'segredo-do-atacante') });
    expect(res.status).toBe(403);
    expect(store.linhas).toHaveLength(0);
  });

  it('sem App Secret configurado, recusa — nunca aceita por omissão', async () => {
    const { app, store } = montar({ appSecret: () => undefined });
    const res = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(res.status).toBe(503);
    expect(store.linhas).toHaveLength(0);
  });

  it('sem signed_request devolve 400', async () => {
    const { app } = montar();
    const res = await request(app).post('/meta/data-deletion').type('form').send({});
    expect(res.status).toBe(400);
  });

  it('pedido repetido devolve o MESMO código e não registra de novo', async () => {
    const { app, store } = montar();
    const a = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    const b = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(b.body.confirmation_code).toBe(a.body.confirmation_code);
    expect(store.linhas).toHaveLength(1);
  });

  it('sem nada ligado ao usuário, o estado é no_data — não finge que apagou', async () => {
    const { app, store } = montar();
    await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(store.linhas[0]?.status).toBe('no_data');
  });

  it('com itens removidos, o estado é completed com a contagem', async () => {
    const { app, store } = montar({ deleteForMetaUser: () => Promise.resolve(3) });
    await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(store.linhas[0]).toMatchObject({ status: 'completed', itemsRemoved: 3 });
  });

  it('falha na remoção fica registrada como failed e a resposta ainda sai', async () => {
    // Pedido de exclusão não pode sumir: ele precisa ficar visível para retentar.
    const { app, store } = montar({ deleteForMetaUser: () => Promise.reject(new Error('db')) });
    const res = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(res.status).toBe(200);
    expect(store.linhas[0]?.status).toBe('failed');
  });
});

describe('POST /meta/deauthorize', () => {
  it('revoga os tokens do usuário e responde 200', async () => {
    let revogadoPara = '';
    const { app, store } = montar({
      revokeForMetaUser: (id) => {
        revogadoPara = id;
        return Promise.resolve(2);
      },
    });
    const res = await request(app)
      .post('/meta/deauthorize')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    expect(res.status).toBe(200);
    expect(revogadoPara).toBe('asid-123');
    expect(store.linhas[0]).toMatchObject({ kind: 'deauthorize', status: 'completed' });
  });

  it('assinatura forjada não revoga nada', async () => {
    let chamado = false;
    const { app } = montar({
      revokeForMetaUser: () => {
        chamado = true;
        return Promise.resolve(1);
      },
    });
    const res = await request(app)
      .post('/meta/deauthorize')
      .type('form')
      .send({ signed_request: assinar(pedido, 'forjado') });
    expect(res.status).toBe(403);
    expect(chamado).toBe(false);
  });
});

describe('GET /api/meta/data-deletion/:code', () => {
  it('mostra o estado sem revelar quem pediu', async () => {
    const { app } = montar();
    const criado = await request(app)
      .post('/meta/data-deletion')
      .type('form')
      .send({ signed_request: assinar(pedido) });

    const res = await request(app).get(`/api/meta/data-deletion/${criado.body.confirmation_code}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'no_data' });
    expect(JSON.stringify(res.body)).not.toContain('asid-123');
  });

  it('código desconhecido ou fora do formato devolve 404', async () => {
    const { app } = montar();
    expect((await request(app).get('/api/meta/data-deletion/codigoquenaoexiste1234')).status).toBe(
      404,
    );
    expect((await request(app).get('/api/meta/data-deletion/x')).status).toBe(404);
  });

  it('código de desautorização não abre a página de exclusão', async () => {
    const { app, store } = montar();
    await request(app)
      .post('/meta/deauthorize')
      .type('form')
      .send({ signed_request: assinar(pedido) });
    const codigo = store.linhas[0]?.confirmationCode ?? '';
    expect((await request(app).get(`/api/meta/data-deletion/${codigo}`)).status).toBe(404);
  });
});
