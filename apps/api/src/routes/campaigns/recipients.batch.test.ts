/**
 * F58-S08 — importação do público em lote, contra Postgres de verdade.
 *
 * O que este arquivo protege:
 *
 * 1. **Que mil linhas não virem dois mil round-trips.** A versão anterior fazia um
 *    SELECT e um INSERT por linha, dentro de uma transação. Numa lista real isso
 *    não é lentidão: é timeout — e timeout no meio da importação deixa o público
 *    pela metade sem ninguém saber quais faltaram.
 *
 * 2. **Que reimportar não apague ninguém.** É a operação que o cliente faz quando
 *    acha que deu errado, e é exatamente a hora em que ele não pode perder metade
 *    do público.
 *
 * 3. **Que consentimento sem origem não seja registrado.** Marcar mil pessoas como
 *    "aceitaram receber" sem dizer onde é uma afirmação sem prova.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, schema, withWorkspace } from '@hm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRecipients } from './recipients';

let workspaceId = '';
let campaignId = '';
let channelId = '';
let suffix = '';

/** Telefone E.164 determinístico e único por execução. */
function fone(i: number): string {
  return `+55669${String(i).padStart(8, '0')}`;
}

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);

  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: `Pub ${suffix}`, slug: `pub-${suffix}` })
    .returning();
  workspaceId = ws!.id;

  const [ch] = await db
    .insert(schema.channels)
    .values({
      workspaceId,
      provider: 'meta_whatsapp',
      name: `WA ${suffix}`,
      phoneNumberId: `pn-${suffix}`,
      wabaId: `waba-${suffix}`,
    })
    .returning();
  channelId = ch!.id;

  const [c] = await db
    .insert(schema.campaigns)
    .values({
      workspaceId,
      channelId,
      name: `Campanha ${suffix}`,
      type: 'broadcast',
      status: 'draft',
    })
    .returning();
  campaignId = c!.id;
});

afterAll(async () => {
  const db = getDb();
  if (workspaceId) {
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  }
  await closeDb();
});

describe('1.001 linhas', () => {
  it('importa tudo e devolve resumo do arquivo INTEIRO', async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => ({ phone: fone(i), name: `C${i}` }));

    const t0 = Date.now();
    const r = await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, { workspaceId, campaignId, rows, optInOnImport: false }),
    );
    const ms = Date.now() - t0;

    expect(r.total).toBe(1_001);
    expect(r.contactsCreated).toBe(1_001);
    expect(r.recipientsAdded).toBe(1_001);
    expect(r.invalid).toBe(0);

    // O relatório é limitado, mas o RESUMO cobre o arquivo todo — senão o cliente
    // veria "1000 importados" para um arquivo de 1001.
    expect(r.report.length).toBeLessThanOrEqual(1_000);

    // Não é benchmark: é o piso que separa "em lote" de "linha a linha". Com
    // 2.000+ round-trips este número passaria de dezenas de segundos.
    expect(ms).toBeLessThan(20_000);
  }, 60_000);

  it('reimportar o MESMO arquivo não duplica nem remove ninguém', async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => ({ phone: fone(i) }));
    const r = await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, { workspaceId, campaignId, rows, optInOnImport: false }),
    );

    expect(r.contactsCreated).toBe(0);
    expect(r.contactsReused).toBe(1_001);
    // Nenhum vínculo NOVO: todos já estavam.
    expect(r.recipientsAdded).toBe(0);

    const total = await withWorkspace(workspaceId, (tx) =>
      tx
        .select({ id: schema.campaignRecipients.id })
        .from(schema.campaignRecipients)
        .where(eq(schema.campaignRecipients.campaignId, campaignId)),
    );
    expect(total).toHaveLength(1_001);
  }, 60_000);
});

describe('o que o arquivo do cliente traz de errado', () => {
  it('telefone fora do E.164 é recusado com motivo, não silenciado', async () => {
    const r = await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, {
        workspaceId,
        campaignId,
        rows: [{ phone: '66 99934-2444' }, { phone: 'sem numero' }, { phone: '' }],
        optInOnImport: false,
      }),
    );
    expect(r.invalid).toBe(3);
    expect(r.contactsCreated).toBe(0);
    expect(r.report.every((l) => l.status === 'skipped' && l.reason === 'phone_nao_e_E164')).toBe(
      true,
    );
  });

  it('mesmo telefone repetido NO ARQUIVO conta como duplicado, não como importado', async () => {
    // Contar como importado inflaria o tamanho do público que o cliente vê antes
    // de apertar enviar.
    const repetido = fone(90_001);
    const r = await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, {
        workspaceId,
        campaignId,
        rows: [{ phone: repetido }, { phone: repetido }, { phone: repetido }],
        optInOnImport: false,
      }),
    );
    expect(r.duplicated).toBe(2);
    expect(r.contactsCreated).toBe(1);
    expect(r.recipientsAdded).toBe(1);
  });

  it('arquivo só com lixo não quebra e não cria nada', async () => {
    const r = await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, {
        workspaceId,
        campaignId,
        rows: [{ phone: 'x' }],
        optInOnImport: false,
      }),
    );
    expect(r.contactsCreated).toBe(0);
    expect(r.recipientsAdded).toBe(0);
  });
});

describe('consentimento', () => {
  it('registra opt-in com a origem em TODOS os contatos do lote', async () => {
    const rows = [{ phone: fone(80_001) }, { phone: fone(80_002) }];
    await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, {
        workspaceId,
        campaignId,
        rows,
        optInOnImport: true,
        source: 'formulário do site',
      }),
    );

    const linhas = await withWorkspace(workspaceId, (tx) =>
      tx
        .select({
          phone: schema.contacts.phone,
          optIn: schema.contacts.marketingOptIn,
          source: schema.contacts.optInSource,
          method: schema.contacts.optInMethod,
        })
        .from(schema.contacts)
        .where(eq(schema.contacts.workspaceId, workspaceId)),
    );

    const alvo = linhas.filter((l) => l.phone === fone(80_001) || l.phone === fone(80_002));
    expect(alvo).toHaveLength(2);
    for (const l of alvo) {
      expect(l.optIn).toBe(true);
      // A origem é o que sustenta a defesa se alguém contestar.
      expect(l.source).toBe('formulário do site');
      expect(l.method).toBe('import');
    }
  });

  it('sem opt-in, o contato nasce SEM consentimento — nunca por omissão', async () => {
    await withWorkspace(workspaceId, (tx) =>
      importRecipients(tx, {
        workspaceId,
        campaignId,
        rows: [{ phone: fone(70_001) }],
        optInOnImport: false,
      }),
    );
    const [linha] = await withWorkspace(workspaceId, (tx) =>
      tx
        .select({ optIn: schema.contacts.marketingOptIn, source: schema.contacts.optInSource })
        .from(schema.contacts)
        .where(eq(schema.contacts.phone, fone(70_001))),
    );
    expect(linha?.optIn).toBe(false);
    expect(linha?.source).toBeNull();
  });
});
