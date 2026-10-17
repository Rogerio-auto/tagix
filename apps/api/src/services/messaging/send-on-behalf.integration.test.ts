/**
 * F73-S09 — `enqueueMemberMessage`: envio em nome do membro pelo MESMO núcleo do composer do
 * LiveChat (Postgres dev, RLS real). O limite do teste é a outbox: nenhuma mensagem real sai.
 *
 * - commit: mensagem `pending` do membro (`sender_member_id`, `metadata.via`) + UM job em
 *   `hm.q.outbound` no shape do worker, com a `purpose` que o portão do worker vai usar;
 * - consentimento revogado (supressão) → recusa sem efeito;
 * - texto livre com a janela de 24 h fechada → recusa; modelo aprovado → job `template`;
 * - agendamento pedido → recusa (não existe agendamento de mensagem individual);
 * - mesma chave de idempotência → `replay`, nenhum job novo;
 * - conversa de outro workspace → `not_found`.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, consentRepo, getDb, schema, withWorkspace } from '@hm/db';
import type { Role } from '@hm/shared';
import {
  addRecipient,
  outboxPayloadsFor,
  seedExternalWorkspace,
  type ExternalSeed,
} from '../../internal/copilot/act-external/test-seed';
import { enqueueMemberMessage, type EnqueueMemberMessageInput } from './send-on-behalf';

let seed: ExternalSeed;
let other: ExternalSeed;

beforeAll(async () => {
  seed = await seedExternalWorkspace({ label: 'S09Send' });
  other = await seedExternalWorkspace({ label: 'S09SendB' });
});

afterAll(async () => {
  await seed?.cleanup();
  await other?.cleanup();
  await closeDb();
});

function actor(role: Role = 'OWNER', s: ExternalSeed = seed) {
  return { workspaceId: s.workspaceId, memberId: s.ws.members[role].id, role };
}

function send(
  input: Omit<EnqueueMemberMessageInput, 'actor'> & { actor?: ReturnType<typeof actor> },
) {
  return withWorkspace(seed.workspaceId, (tx) =>
    enqueueMemberMessage(tx, { actor: input.actor ?? actor(), ...input }),
  );
}

describe('enqueueMemberMessage', () => {
  it('commit: mensagem do membro com via=copilot e UM job de envio na outbox com a purpose', async () => {
    const r = await addRecipient(seed, {
      name: 'Paula Lima',
      assignedTo: seed.ws.members.SUPERVISOR.id,
    });
    const proposalId = randomUUID();
    const out = await send({
      actor: actor('SUPERVISOR'),
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Olá, Paula! Tudo certo para amanhã?' },
      purpose: 'transactional',
      idempotencyKey: `copilot:${randomUUID()}`,
      metadata: { via: 'copilot', proposal_id: proposalId },
    });
    if (out.kind !== 'queued') throw new Error(`send: ${JSON.stringify(out)}`);
    const [msg] = await getDb()
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.id, out.messageId));
    expect(msg).toMatchObject({
      direction: 'outbound',
      senderType: 'member',
      senderMemberId: seed.ws.members.SUPERVISOR.id,
      viewStatus: 'pending',
      type: 'text',
      content: 'Olá, Paula! Tudo certo para amanhã?',
      metadata: { via: 'copilot', proposal_id: proposalId },
    });
    const jobs = await outboxPayloadsFor(seed.workspaceId, [out.messageId]);
    expect(jobs).toEqual([
      {
        kind: 'text',
        channelId: seed.channelId,
        conversationId: r.conversationId,
        messageId: out.messageId,
        chatId: expect.any(String) as string,
        purpose: 'transactional',
        text: 'Olá, Paula! Tudo certo para amanhã?',
      },
    ]);
  });

  it('contato que revogou (supressão) não recebe: recusa sem mensagem nem job', async () => {
    const r = await addRecipient(seed, { name: 'Sem Consentimento' });
    await withWorkspace(seed.workspaceId, (tx) =>
      consentRepo.revoke(tx, {
        workspaceId: seed.workspaceId,
        contactId: r.contactId,
        channel: null,
        reason: 'test_stop',
      }),
    );
    const out = await send({
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Oi' },
      purpose: 'transactional',
    });
    expect(out).toEqual({ kind: 'refused', reason: 'suppressed' });
    const msgs = await getDb()
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, r.conversationId));
    expect(msgs).toHaveLength(1); // só a inbound do seed
  });

  it('janela de 24 h fechada: texto livre recusa; modelo aprovado vira job template', async () => {
    const r = await addRecipient(seed, { name: 'Fechada', lastInboundMinutesAgo: 26 * 60 });
    const text = await send({
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Oi' },
      purpose: 'transactional',
    });
    expect(text).toEqual({ kind: 'refused', reason: 'window_closed' });

    const tpl = await send({
      target: { contactId: r.contactId },
      content: {
        kind: 'template',
        renderedText: 'Olá, Fechada!',
        template: {
          templateName: 'lembrete',
          languageCode: 'pt_BR',
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Fechada' }] }],
        },
      },
      purpose: 'transactional',
    });
    if (tpl.kind !== 'queued') throw new Error(`template: ${JSON.stringify(tpl)}`);
    const jobs = await outboxPayloadsFor(seed.workspaceId, [tpl.messageId]);
    expect(jobs[0]).toMatchObject({
      kind: 'template',
      templateName: 'lembrete',
      languageCode: 'pt_BR',
      purpose: 'transactional',
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'Fechada' }] }],
    });
  });

  it('agendamento pedido: recusa (não existe agendamento de mensagem individual)', async () => {
    const r = await addRecipient(seed, { name: 'Agenda' });
    const out = await send({
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Amanhã' },
      purpose: 'transactional',
      scheduledFor: new Date(Date.now() + 86_400_000),
    });
    expect(out).toEqual({ kind: 'refused', reason: 'scheduling_unavailable' });
  });

  it('mesma chave de idempotência: replay sem job novo', async () => {
    const r = await addRecipient(seed, { name: 'Idem' });
    const key = `copilot:${randomUUID()}`;
    const input = {
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Uma vez só' },
      purpose: 'transactional',
      idempotencyKey: key,
    } as const;
    const first = await send(input);
    const again = await send(input);
    if (first.kind !== 'queued') throw new Error('primeiro envio');
    expect(again).toEqual({
      kind: 'replay',
      messageId: first.messageId,
      conversationId: r.conversationId,
    });
    expect(await outboxPayloadsFor(seed.workspaceId, [first.messageId])).toHaveLength(1);
  });

  it('conversa que o membro não vê (SUPERVISOR fora do depto, não responsável) é not_found', async () => {
    const r = await addRecipient(seed, { name: 'De outro time' });
    const out = await send({
      actor: actor('SUPERVISOR'),
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Oi' },
      purpose: 'transactional',
    });
    expect(out).toEqual({ kind: 'refused', reason: 'not_found' });
    const byContact = await send({
      actor: actor('SUPERVISOR'),
      target: { contactId: r.contactId },
      content: { kind: 'text', text: 'Oi' },
      purpose: 'transactional',
    });
    expect(byContact).toEqual({ kind: 'refused', reason: 'no_conversation' });
  });

  it('conversa de outro workspace é not_found (RLS + visibilidade)', async () => {
    const r = await addRecipient(other, { name: 'Alheio' });
    const out = await send({
      target: { conversationId: r.conversationId },
      content: { kind: 'text', text: 'Oi' },
      purpose: 'transactional',
    });
    expect(out).toEqual({ kind: 'refused', reason: 'not_found' });
  });
});
