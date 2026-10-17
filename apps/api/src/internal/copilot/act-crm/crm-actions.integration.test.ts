/**
 * F73-S08 · as demais ações de CRM do Copiloto de ponta a ponta no Postgres de dev:
 * tags, editar contato, trocar responsável, nota interna e compromisso interno.
 *
 * Para cada executor: prévia; execução; conflito por versão; desfazer; desfazer com conflito;
 * escopo do AGENT; entre empresas. Um alvo só é nível 2 (executa na hora); para ter o intervalo
 * entre propor e confirmar com um alvo, o turno é marcado contaminado (nível 3).
 *
 * Nota e compromisso não têm "conflito por versão" na execução: somar uma nota ou criar um
 * compromisso não sobrescreve nada (o alvo da nota é a conversa; o do compromisso é novo).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { argsJsonSchema } from '../core/registry';
import { tools } from './index';
import { addNoteExecutor } from './add-note';
import { assignDealsExecutor } from './assign-deals';
import { createEventExecutor } from './create-event';
import { tagContactsExecutor } from './tag-contacts';
import { updateContactExecutor } from './update-contact';
import { assignDealOwner } from '../../../services/deals/owner';
import {
  confirmAndRun,
  memberOf,
  previewOf,
  propose,
  rowOf,
  seedCrmWorld,
  seedDeal,
  undo,
  type CrmWorld,
} from './test-fixtures';

let world: CrmWorld;

beforeAll(async () => {
  world = await seedCrmWorld('CrmActions');
});

afterAll(async () => {
  await world?.cleanup();
  await closeDb();
});

const ws = (): string => world.ws.workspaceId;
const owner = (): string => memberOf(world, 'OWNER');

async function tagsOf(contactId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ tagId: schema.contactTags.tagId })
    .from(schema.contactTags)
    .where(eq(schema.contactTags.contactId, contactId));
  return rows.map((r) => r.tagId).sort();
}

describe('registro: as 6 ferramentas propose_* geram JSON Schema', () => {
  it('chaves e schemas', () => {
    expect(tools.map((t) => t.key)).toEqual([
      'propose_tag_contacts',
      'propose_update_contact',
      'propose_assign_deals',
      'propose_move_deals',
      'propose_add_note',
      'propose_create_event',
    ]);
    for (const t of tools) {
      const schemaJson = argsJsonSchema(t.key, t.args);
      expect(schemaJson['type']).toBe('object');
    }
  });
});

describe('contact.tag (propose_tag_contacts)', () => {
  it('prévia, execução, desfazer; quem já tem a tag fica de fora', async () => {
    await getDb()
      .insert(schema.contactTags)
      .values({ contactId: world.contact.ana, tagId: world.tag.vip, workspaceId: ws() });
    const outcome = await propose(world, owner(), tagContactsExecutor, {
      contact_ids: [world.contact.maria, world.contact.joao, world.contact.ana],
      tag: 'VIP',
      op: 'add',
    });
    expect(outcome.kind).toBe('proposed');
    const row = rowOf(outcome);
    expect(row.riskLevel).toBe(3);
    expect(row.summary).toBe('Adicionar a tag vip a 2 contatos');
    if (outcome.kind !== 'proposed') return;
    expect(outcome.proposal.items.data.map((i) => [i.label, i.before, i.after]).sort()).toEqual([
      ['João Lima', '—', 'vip'],
      ['Maria Souza', '—', 'vip'],
    ]);
    const done = await confirmAndRun(world, owner(), row.id);
    expect(done.proposal.status).toBe('completed');
    expect(await tagsOf(world.contact.maria)).toEqual([world.tag.vip]);
    const undone = await undo(world, owner(), row.id);
    expect(undone.ok && undone.row.status).toBe('undone');
    expect(await tagsOf(world.contact.maria)).toEqual([]);
    expect(await tagsOf(world.contact.ana)).toEqual([world.tag.vip]);
  });

  it('conflito: a Paula marca um contato entre propor e confirmar → skipped_conflict com o nome', async () => {
    const row = rowOf(
      await propose(world, owner(), tagContactsExecutor, {
        contact_ids: [world.contact.maria, world.contact.joao],
        tag: world.tag.frio,
        op: 'add',
      }),
    );
    await getDb()
      .insert(schema.contactTags)
      .values({
        contactId: world.contact.joao,
        tagId: world.tag.frio,
        workspaceId: ws(),
        taggedBy: world.paula,
      });
    const done = await confirmAndRun(world, owner(), row.id);
    expect(done.proposal.status).toBe('partially_completed');
    const skipped = done.items.find((i) => i.status === 'skipped_conflict');
    expect(skipped?.targetId).toBe(world.contact.joao);
    expect(skipped?.after?.['conflict_by']).toBe('Paula Gestora');
    await undo(world, owner(), row.id);
    expect(await tagsOf(world.contact.joao)).toEqual([world.tag.frio]);
    await getDb()
      .delete(schema.contactTags)
      .where(eq(schema.contactTags.contactId, world.contact.joao));
  });

  it('desfazer com conflito: alguém já tirou a tag → undo_conflict', async () => {
    const outcome = await propose(world, owner(), tagContactsExecutor, {
      contact_ids: [world.contact.maria],
      tag: 'vip',
      op: 'add',
    });
    expect(outcome.kind).toBe('executed');
    await getDb()
      .delete(schema.contactTags)
      .where(eq(schema.contactTags.contactId, world.contact.maria));
    const undone = await undo(world, owner(), rowOf(outcome).id);
    expect(undone.ok && undone.row.status).toBe('partially_undone');
  });

  it('busca do search_contacts + AGENT (contatos são do workspace) + entre empresas', async () => {
    const byQuery = await propose(world, memberOf(world, 'AGENT'), tagContactsExecutor, {
      filter: { query: 'Prado' },
      tag: 'frio',
      op: 'add',
    });
    expect(byQuery.kind).toBe('executed');
    expect(await tagsOf(world.contact.ana)).toContain(world.tag.frio);
    const cross = await propose(world, owner(), tagContactsExecutor, {
      contact_ids: [world.otherIds.contact],
      tag: 'vip',
      op: 'add',
    });
    expect(cross.kind).toBe('blocked');
    if (cross.kind === 'blocked')
      expect(cross.dropped).toEqual([{ id: world.otherIds.contact, reason: 'not_found' }]);
    // Tag inexistente: nada a fazer, sem criar tag.
    const missing = await propose(world, owner(), tagContactsExecutor, {
      contact_ids: [world.contact.maria],
      tag: 'nao-existe',
      op: 'add',
    });
    expect(missing.kind).toBe('blocked');
  });
});

describe('contact.update (propose_update_contact)', () => {
  it('prévia campo a campo, execução e desfazer', async () => {
    const outcome = await propose(world, owner(), updateContactExecutor, {
      contact_id: world.contact.joao,
      fields: { display_name: 'João P. Lima', language: 'es', custom_fields: { cidade: 'Recife' } },
    });
    expect(outcome.kind).toBe('executed');
    const row = rowOf(outcome);
    expect(row.summary).toBe('Editar 1 contato (nome, idioma, campo cidade)');
    expect(previewOf(row).before_after).toEqual([
      { label: 'Nome', before: 'João Lima', after: 'João P. Lima', count: 1 },
      { label: 'Idioma', before: 'pt-BR', after: 'es', count: 1 },
      { label: 'Campo cidade', before: '—', after: 'Recife', count: 1 },
    ]);
    const [after] = await getDb()
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, world.contact.joao));
    expect(after?.displayName).toBe('João P. Lima');
    expect(after?.customFields).toEqual({ cidade: 'Recife' });
    const undone = await undo(world, owner(), row.id);
    expect(undone.ok && undone.row.status).toBe('undone');
    const [back] = await getDb()
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, world.contact.joao));
    expect(back?.displayName).toBe('João Lima');
    expect(back?.language).toBe('pt-BR');
    expect(back?.customFields).toEqual({});
  });

  it('conflito por versão (turno contaminado = nível 3) e desfazer com conflito', async () => {
    const row = rowOf(
      await propose(
        world,
        owner(),
        updateContactExecutor,
        { contact_id: world.contact.maria, fields: { timezone: 'America/Recife' } },
        { turnTainted: true },
      ),
    );
    expect(row.riskLevel).toBe(3);
    await getDb()
      .update(schema.contacts)
      .set({ notes: 'editado', updatedAt: new Date() })
      .where(eq(schema.contacts.id, world.contact.maria));
    const done = await confirmAndRun(world, owner(), row.id);
    expect(done.items[0]?.status).toBe('skipped_conflict');

    const exec = rowOf(
      await propose(world, owner(), updateContactExecutor, {
        contact_id: world.contact.maria,
        fields: { display_name: 'Maria S.' },
      }),
    );
    await getDb()
      .update(schema.contacts)
      .set({ displayName: 'Maria Souza Lima' })
      .where(eq(schema.contacts.id, world.contact.maria));
    const undone = await undo(world, owner(), exec.id);
    expect(undone.ok && undone.row.status).toBe('partially_undone');
    const [m] = await getDb()
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, world.contact.maria));
    expect(m?.displayName).toBe('Maria Souza Lima');
    await getDb()
      .update(schema.contacts)
      .set({ displayName: 'Maria Souza' })
      .where(eq(schema.contacts.id, world.contact.maria));
  });

  it('allowlist: campo fora dela é argumento inválido; AGENT edita; outra empresa = not_found', async () => {
    const bad = await propose(world, owner(), updateContactExecutor, {
      contact_id: world.contact.maria,
      fields: { phone: '+5511999990000' },
    });
    expect(bad.kind).toBe('invalid_args');
    const agent = await propose(world, memberOf(world, 'AGENT'), updateContactExecutor, {
      contact_id: world.contact.ana,
      fields: { language: 'en' },
    });
    expect(agent.kind).toBe('executed');
    const cross = await propose(world, owner(), updateContactExecutor, {
      contact_id: world.otherIds.contact,
      fields: { language: 'en' },
    });
    expect(cross.kind).toBe('blocked');
    const [other] = await getDb()
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, world.otherIds.contact));
    expect(other?.language).toBe('pt-BR');
  });
});

describe('deal.assign_owner (propose_assign_deals)', () => {
  it('prévia, execução com deal_history owner_changed, conflito com o nome e desfazer', async () => {
    const a = await seedDeal(world, { title: 'Resp A', stage: world.stage.orcamento });
    const b = await seedDeal(world, { title: 'Resp B', stage: world.stage.orcamento });
    const c = await seedDeal(world, {
      title: 'Resp C',
      stage: world.stage.orcamento,
      owner: world.agentB,
    });
    const outcome = await propose(world, owner(), assignDealsExecutor, {
      deal_ids: [a, b, c],
      owner_id: world.agentB,
    });
    const row = rowOf(outcome);
    // C já é do Bruno: fora da lista.
    expect(row.summary).toBe('Passar 2 negócios para Bruno Atendente');
    expect(row.riskLevel).toBe(3);
    await withWorkspace(ws(), (tx) =>
      assignDealOwner(tx, {
        workspaceId: ws(),
        dealId: b,
        ownerId: world.paula,
        actor: { type: 'member', memberId: world.paula },
      }),
    );
    const done = await confirmAndRun(world, owner(), row.id);
    expect(done.proposal.status).toBe('partially_completed');
    const conflict = done.items.find((i) => i.targetId === b);
    expect(conflict?.status).toBe('skipped_conflict');
    expect(conflict?.after?.['conflict_by']).toBe('Paula Gestora');
    const [hist] = await getDb()
      .select({
        from: schema.dealHistory.fromValue,
        to: schema.dealHistory.toValue,
        metadata: schema.dealHistory.metadata,
      })
      .from(schema.dealHistory)
      .where(
        and(eq(schema.dealHistory.dealId, a), eq(schema.dealHistory.eventType, 'owner_changed')),
      );
    expect(hist).toEqual({
      from: { ownerId: owner() },
      to: { ownerId: world.agentB },
      metadata: { via: 'copilot', proposal_id: row.id },
    });
    expect(
      world.dealEvents.some(
        (e) => e.event === 'deal:updated' && (e.data['deal'] as { id?: string }).id === a,
      ),
    ).toBe(true);
    const undone = await undo(world, owner(), row.id);
    expect(undone.ok && undone.row.status).toBe('undone');
    const [back] = await getDb()
      .select({ ownerId: schema.deals.ownerId })
      .from(schema.deals)
      .where(eq(schema.deals.id, a));
    expect(back?.ownerId).toBe(owner());
  });

  it('desfazer com conflito; AGENT só os que vê; outra empresa = not_found', async () => {
    const d = await seedDeal(world, { title: 'Resp D', stage: world.stage.orcamento });
    const exec = rowOf(
      await propose(world, owner(), assignDealsExecutor, { deal_ids: [d], owner_id: world.paula }),
    );
    expect(exec.status).toBe('completed');
    await getDb().update(schema.deals).set({ ownerId: world.agentB }).where(eq(schema.deals.id, d));
    const undone = await undo(world, owner(), exec.id);
    expect(undone.ok && undone.row.status).toBe('partially_undone');

    const agent = memberOf(world, 'AGENT');
    const mine = await seedDeal(world, {
      title: 'Do agente',
      stage: world.stage.orcamento,
      owner: agent,
    });
    const peer = await seedDeal(world, {
      title: 'Do colega',
      stage: world.stage.orcamento,
      owner: world.agentB,
    });
    const out = await propose(world, agent, assignDealsExecutor, {
      deal_ids: [mine, peer],
      owner_id: world.paula,
    });
    expect(out.kind).toBe('executed');
    if (out.kind === 'executed') expect(out.dropped).toEqual([{ id: peer, reason: 'not_found' }]);

    const cross = await propose(world, owner(), assignDealsExecutor, {
      deal_ids: [world.otherIds.deal],
      owner_id: 'me',
    });
    expect(cross.kind).toBe('blocked');
  });
});

describe('conversation.note (propose_add_note)', () => {
  it('prévia, execução, desfazer apaga; editada depois → undo_conflict', async () => {
    const outcome = await propose(world, owner(), addNoteExecutor, {
      conversation_id: world.conv.agent,
      body: 'Cliente pediu retorno na sexta.',
    });
    expect(outcome.kind).toBe('executed');
    const row = rowOf(outcome);
    expect(row.summary).toBe('Escrever 1 nota interna numa conversa');
    expect(previewOf(row).before_after[0]?.after).toBe('Cliente pediu retorno na sexta.');
    const [item] = await withWorkspace(ws(), (tx) =>
      tx
        .select()
        .from(schema.copilotActionItems)
        .where(eq(schema.copilotActionItems.proposalId, row.id)),
    );
    const noteId = String(item?.undoPayload?.['note_id']);
    const [note] = await getDb()
      .select()
      .from(schema.conversationNotes)
      .where(eq(schema.conversationNotes.id, noteId));
    expect(note?.authorMemberId).toBe(owner());
    const undone = await undo(world, owner(), row.id);
    expect(undone.ok && undone.row.status).toBe('undone');
    expect(
      await getDb()
        .select()
        .from(schema.conversationNotes)
        .where(eq(schema.conversationNotes.id, noteId)),
    ).toHaveLength(0);

    const again = rowOf(
      await propose(world, owner(), addNoteExecutor, {
        conversation_id: world.conv.agent,
        body: 'Outra nota.',
      }),
    );
    await getDb()
      .update(schema.conversationNotes)
      .set({ body: 'Outra nota, editada.', updatedAt: new Date() })
      .where(eq(schema.conversationNotes.conversationId, world.conv.agent));
    const conflict = await undo(world, owner(), again.id);
    expect(conflict.ok && conflict.row.status).toBe('partially_undone');
  });

  it('AGENT: conversa de colega (time privado) = not_found; outra empresa idem', async () => {
    const agent = memberOf(world, 'AGENT');
    const own = await propose(world, agent, addNoteExecutor, {
      conversation_id: world.conv.agent,
      body: 'Minha nota.',
    });
    expect(own.kind).toBe('executed');
    const peer = await propose(world, agent, addNoteExecutor, {
      conversation_id: world.conv.agentB,
      body: 'x',
    });
    expect(peer.kind).toBe('blocked');
    if (peer.kind === 'blocked') expect(peer.reason).toBe('scope');
    const cross = await propose(world, owner(), addNoteExecutor, {
      conversation_id: world.otherIds.conv,
      body: 'x',
    });
    expect(cross.kind).toBe('blocked');
  });
});

describe('event.create_internal (propose_create_event)', () => {
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(13, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);

  it('cria sem contato na coluna (sem lembrete ao cliente), desfazer cancela; remarcado → conflito', async () => {
    const deal = await seedDeal(world, { title: 'Com reunião', stage: world.stage.orcamento });
    const outcome = await propose(world, owner(), createEventExecutor, {
      calendar_id: world.calendar.workspace,
      title: 'Revisar proposta',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      contact_id: world.contact.maria,
      deal_id: deal,
    });
    expect(outcome.kind).toBe('executed');
    const row = rowOf(outcome);
    expect(row.summary.startsWith('Criar 1 compromisso interno em Empresa (')).toBe(true);
    expect(previewOf(row).before_after).toContainEqual({
      label: 'Aviso ao cliente',
      before: '—',
      after: 'Nenhum',
      count: 1,
    });
    const [ev] = await getDb()
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.workspaceId, ws()), eq(schema.events.title, 'Revisar proposta')));
    expect(ev?.contactId).toBeNull();
    expect(ev?.dealId).toBe(deal);
    expect(ev?.createdBy).toBe(owner());
    expect(ev?.metadata).toMatchObject({
      via: 'copilot',
      proposal_id: row.id,
      internal: true,
      related_contact_id: world.contact.maria,
    });
    const undone = await undo(world, owner(), row.id);
    expect(undone.ok && undone.row.status).toBe('undone');
    const [cancelled] = await getDb()
      .select({ status: schema.events.status })
      .from(schema.events)
      .where(eq(schema.events.id, ev!.id));
    expect(cancelled?.status).toBe('cancelled');

    const again = rowOf(
      await propose(world, owner(), createEventExecutor, {
        calendar_id: world.calendar.workspace,
        title: 'Ligar de volta',
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      }),
    );
    await getDb()
      .update(schema.events)
      .set({
        startAt: new Date(start.getTime() + 86_400_000),
        endAt: new Date(end.getTime() + 86_400_000),
      })
      .where(eq(schema.events.title, 'Ligar de volta'));
    const conflict = await undo(world, owner(), again.id);
    expect(conflict.ok && conflict.row.status).toBe('partially_undone');
  });

  it('AGENT: agenda pessoal de outra pessoa = not_found; outra empresa idem; fim antes do início = inválido', async () => {
    const agent = memberOf(world, 'AGENT');
    const peer = await propose(world, agent, createEventExecutor, {
      calendar_id: world.calendar.paulaPersonal,
      title: 'Na agenda da Paula',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    });
    expect(peer.kind).toBe('blocked');
    const ok = await propose(world, agent, createEventExecutor, {
      calendar_id: world.calendar.workspace,
      title: 'Na agenda da empresa',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    });
    expect(ok.kind).toBe('executed');
    const cross = await propose(world, owner(), createEventExecutor, {
      calendar_id: world.otherIds.calendar,
      title: 'x',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    });
    expect(cross.kind).toBe('blocked');
    const bad = await propose(world, owner(), createEventExecutor, {
      calendar_id: world.calendar.workspace,
      title: 'x',
      starts_at: end.toISOString(),
      ends_at: start.toISOString(),
    });
    expect(bad.kind).toBe('invalid_args');
  });
});
