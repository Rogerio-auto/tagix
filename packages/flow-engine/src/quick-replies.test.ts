/**
 * F70-S34 — respostas rápidas da cadência.
 *
 *  - puro: normalização, casamento por payload/texto, clique x texto digitado;
 *  - banco (Postgres dev, RLS real): "o contato recusou?" é a ÚLTIMA mensagem dele, e o
 *    port que liga a IA recusa `contact_declined` — a trava de origem continua valendo e
 *    tem precedência no motivo. Pula sem `DATABASE_URL`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import {
  classifyQuickReply,
  hasContactDeclined,
  matchQuickReply,
  normalizeQuickReplyText,
} from './quick-replies';
import { createOutboundPort } from './ports/outbound.port';

describe('normalizeQuickReplyText', () => {
  it.each([
    ['Agora não', 'agora nao'],
    ['  AGORA   NÃO  ', 'agora nao'],
    ['Agora não.', 'agora nao'],
    ['agora nao!!', 'agora nao'],
    ['Quero a prévia 🙏', 'quero a previa'],
    ['"Quero seguir"', 'quero seguir'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeQuickReplyText(raw)).toBe(expected);
  });
});

describe('matchQuickReply', () => {
  it.each([
    ['Quero seguir', 'reopen'],
    ['Quero retomar', 'reopen'],
    ['Quero a prévia', 'reopen'],
    ['quero a previa', 'reopen'],
    ['Agora não', 'decline'],
    ['AGORA NAO', 'decline'],
  ])('texto %j → %s', (text, intent) => {
    expect(matchQuickReply({ text })).toEqual({ intent, via: 'text' });
  });

  it.each(['agora não posso, me chama amanhã', 'quero', 'não', 'quero seguir sim', 'SAIR'])(
    'nunca por "contém": %j',
    (text) => {
      expect(matchQuickReply({ text })).toBeNull();
    },
  );

  it('payload conhecido decide (mesmo com texto de outro botão)', () => {
    expect(matchQuickReply({ payload: 'cadence.decline', text: 'Quero seguir' })).toEqual({
      intent: 'decline',
      via: 'payload',
    });
    // A Meta devolve o texto do botão como payload quando o envio não define um.
    expect(matchQuickReply({ payload: 'Agora não', text: 'Agora não' })).toEqual({
      intent: 'decline',
      via: 'payload',
    });
  });

  it('payload desconhecido cai para o texto', () => {
    expect(matchQuickReply({ payload: 'promo_123', text: 'Agora não' })).toEqual({
      intent: 'decline',
      via: 'text',
    });
    expect(matchQuickReply({ payload: 'promo_123', text: 'Ver ofertas' })).toBeNull();
  });
});

describe('classifyQuickReply', () => {
  it('clique conta sem olhar o banco', async () => {
    const repliesToTemplate = vi.fn(async () => false);
    await expect(
      classifyQuickReply({
        click: { source: 'button', text: 'Quero retomar', payload: 'Quero retomar' },
        text: 'Quero retomar',
        repliesToTemplate,
      }),
    ).resolves.toEqual({
      source: 'button',
      text: 'Quero retomar',
      payload: 'Quero retomar',
      intent: 'reopen',
      via: 'payload',
    });
    expect(repliesToTemplate).not.toHaveBeenCalled();
  });

  it('clique de outro botão: sem significado aqui', async () => {
    await expect(
      classifyQuickReply({
        click: { source: 'interactive', text: 'Sim', payload: 'btn_yes' },
        text: 'Sim',
        repliesToTemplate: async () => true,
      }),
    ).resolves.toBeNull();
  });

  it('texto digitado igual ao botão conta só em resposta a um modelo', async () => {
    const asTemplateReply = await classifyQuickReply({
      click: undefined,
      text: 'agora nao',
      repliesToTemplate: async () => true,
    });
    expect(asTemplateReply).toEqual({
      source: 'typed',
      text: 'agora nao',
      intent: 'decline',
      via: 'text',
    });
    await expect(
      classifyQuickReply({
        click: undefined,
        text: 'agora nao',
        repliesToTemplate: async () => false,
      }),
    ).resolves.toBeNull();
  });

  it('texto que não casa nem consulta o banco', async () => {
    const repliesToTemplate = vi.fn(async () => true);
    await expect(
      classifyQuickReply({ click: undefined, text: 'oi, tudo bem?', repliesToTemplate }),
    ).resolves.toBeNull();
    expect(repliesToTemplate).not.toHaveBeenCalled();
  });

  it('metadata de clique inválido é ignorado (cai para o texto)', async () => {
    await expect(
      classifyQuickReply({
        click: { source: 'hack', intent: 'reopen' },
        text: 'bom dia',
        repliesToTemplate: async () => true,
      }),
    ).resolves.toBeNull();
  });
});

// ─── Banco ───────────────────────────────────────────────────────────────────

const ready = Boolean(process.env['DATABASE_URL']);

describe.skipIf(!ready)('"o contato recusou?" e o port que liga a IA (Postgres dev)', () => {
  const WS = randomUUID();
  const CHANNEL = randomUUID();
  const AGENT = randomUUID();
  const outbound = createOutboundPort();
  let seq = 0;
  // Relógio fixo: minutos iguais = mesmo instante (empate de propósito).
  const BASE = Date.now();

  async function conversation(origin: string | null): Promise<string> {
    const id = randomUUID();
    const contactId = randomUUID();
    await getDb()
      .insert(schema.contacts)
      .values({
        id: contactId,
        workspaceId: WS,
        phone: `+5511${String(Date.now()).slice(-8)}${seq}`,
      });
    await getDb()
      .insert(schema.conversations)
      .values({
        id,
        workspaceId: WS,
        channelId: CHANNEL,
        contactId,
        remoteId: `r-${id.slice(0, 8)}`,
        status: 'open',
        ...(origin !== null ? { origin: origin as 'origem:anuncio' } : {}),
      });
    return id;
  }

  /** Mensagem do contato, `minutesAgo` no passado (ordem da timeline). */
  async function contactSays(
    conversationId: string,
    content: string,
    minutesAgo: number,
    intent?: 'reopen' | 'decline',
  ): Promise<void> {
    seq += 1;
    const at = new Date(BASE - minutesAgo * 60_000);
    await getDb()
      .insert(schema.messages)
      .values({
        workspaceId: WS,
        conversationId,
        externalId: `wamid.qr.${seq}.${conversationId.slice(0, 6)}`,
        direction: 'inbound',
        senderType: 'contact',
        type: 'text',
        content,
        createdAt: at,
        providerTimestamp: at,
        ...(intent !== undefined
          ? { metadata: { quickReply: { source: 'button', text: content, intent, via: 'text' } } }
          : {}),
      });
  }

  const declined = (conversationId: string) =>
    withWorkspace(WS, (tx) => hasContactDeclined(tx, conversationId));

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(schema.workspaces)
      .values({ id: WS, name: 'F70-S34 qr', slug: `f70s34-qr-${WS.slice(0, 8)}` });
    await db.insert(schema.channels).values({
      id: CHANNEL,
      workspaceId: WS,
      provider: 'waha',
      name: 'Canal F70-S34',
      wahaSessionId: `s34-${CHANNEL.slice(0, 8)}`,
    });
    await db
      .insert(schema.agents)
      .values({ id: AGENT, workspaceId: WS, name: 'Agente F70-S34', systemPrompt: 'x' });
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(schema.messages).where(eq(schema.messages.workspaceId, WS));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
    await closeDb();
  });

  it('só a ÚLTIMA mensagem do contato decide; voltar a escrever desfaz', async () => {
    const conv = await conversation('origem:anuncio');
    expect(await declined(conv)).toBe(false); // sem mensagem nenhuma

    await contactSays(conv, 'oi', 30);
    expect(await declined(conv)).toBe(false);

    await contactSays(conv, 'Agora não', 20, 'decline');
    expect(await declined(conv)).toBe(true);
    // Idempotente: a mesma recusa de novo, mesmo estado.
    await contactSays(conv, 'Agora não', 15, 'decline');
    expect(await declined(conv)).toBe(true);

    // Mensagem do sistema/IA depois da recusa não desfaz — só o contato.
    await getDb().insert(schema.messages).values({
      workspaceId: WS,
      conversationId: conv,
      direction: 'outbound',
      senderType: 'system',
      type: 'template',
      content: 'arcada_lembrete_dia_7',
    });
    expect(await declined(conv)).toBe(true);

    await contactSays(conv, 'mudei de ideia', 1);
    expect(await declined(conv)).toBe(false);
  });

  it('empate no mesmo instante: a recusa só vale se todas as mensagens forem recusa', async () => {
    const conv = await conversation('origem:anuncio');
    await contactSays(conv, 'Agora não', 3, 'decline');
    await contactSays(conv, 'Agora não', 3, 'decline');
    expect(await declined(conv)).toBe(true);
    await contactSays(conv, 'na verdade, me conta mais', 3);
    expect(await declined(conv)).toBe(false);
  });

  it('port: depois de "Agora não" nenhuma automação liga a IA (contact_declined)', async () => {
    const conv = await conversation('origem:anuncio');
    await contactSays(conv, 'Agora não', 5, 'decline');

    await expect(
      outbound.setConversationAi(WS, { conversationId: conv, aiMode: 'on', agentId: AGENT }),
    ).resolves.toEqual({ applied: false, reason: 'contact_declined' });
    const [row] = await getDb()
      .select({ aiMode: schema.conversations.aiMode })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conv));
    expect(row?.aiMode).toBe('off');

    // Desligar continua sempre permitido.
    await expect(
      outbound.setConversationAi(WS, { conversationId: conv, aiMode: 'off' }),
    ).resolves.toEqual({ applied: true });

    // O contato volta a escrever: a automação pode ligar de novo.
    await contactSays(conv, 'oi, voltei', 0);
    await expect(
      outbound.setConversationAi(WS, { conversationId: conv, aiMode: 'on', agentId: AGENT }),
    ).resolves.toEqual({ applied: true });
  });

  it('port: sem origem comprovada o motivo continua sendo a trava de origem', async () => {
    const conv = await conversation('sem-origem');
    await contactSays(conv, 'Agora não', 5, 'decline');
    await expect(
      outbound.setConversationAi(WS, { conversationId: conv, aiMode: 'on', agentId: AGENT }),
    ).resolves.toEqual({ applied: false, reason: 'origin_not_eligible' });
  });
});
