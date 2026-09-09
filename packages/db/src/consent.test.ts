/**
 * F59-S03 — consentimento e supressão por canal.
 *
 * Cobre o que o portão de envio (F59-S04) vai depender: granularidade por canal e
 * finalidade, prova preservada, supressão de empresa vencendo canal, idempotência
 * da migração de dado e isolamento por RLS.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { consentRepo } from './repos/consent';
import { withWorkspace } from './rls';
import { contactConsents, contactSuppressions, contacts, workspaces } from './schema';

let wsA = '';
let wsB = '';
let suffix = '';

/**
 * O Drizzle envolve o erro do driver, e o `withWorkspace` pode envolver de novo.
 * O que interessa (código SQLSTATE, nome da constraint) vive na cadeia de `cause`.
 * Asserir na mensagem de topo daria falso verde no dia em que a rejeição viesse de
 * outra causa.
 */
function causaPg(erro: unknown): { code?: string; constraint_name?: string; message?: string } {
  let atual: unknown = erro;
  for (let i = 0; i < 5 && atual !== null && atual !== undefined; i += 1) {
    const c = atual as { code?: string; constraint_name?: string; message?: string; cause?: unknown };
    if (typeof c.code === 'string') return c;
    atual = c.cause;
  }
  return {};
}

async function novoContato(workspaceId: string, nome: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(contacts)
    .values({ workspaceId, displayName: `${nome} ${suffix}` })
    .returning();
  if (!row) throw new Error('Falha ao criar contato.');
  return row.id;
}

beforeAll(async () => {
  const db = getDb();
  suffix = randomUUID().slice(0, 8);
  const [a] = await db
    .insert(workspaces)
    .values({ name: `Consent A ${suffix}`, slug: `consent-a-${suffix}`, market: 'US' })
    .returning();
  const [b] = await db
    .insert(workspaces)
    .values({ name: `Consent B ${suffix}`, slug: `consent-b-${suffix}` })
    .returning();
  if (!a || !b) throw new Error('Falha ao criar workspaces de consentimento.');
  wsA = a.id;
  wsB = b.id;
});

afterAll(async () => {
  const db = getDb();
  for (const id of [wsA, wsB]) {
    if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  await closeDb();
});

describe('granularidade por canal e finalidade', () => {
  it('consentir WhatsApp não consente SMS — o ponto inteiro do slot', async () => {
    const contato = await novoContato(wsA, 'Granular');

    await withWorkspace(wsA, async (tx) => {
      await consentRepo.grant(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
        source: 'webchat',
        proof: { displayedText: 'Aceito receber novidades por WhatsApp', url: 'https://x/y' },
        market: 'US',
      });
    });

    const [whats, sms] = await withWorkspace(wsA, async (tx) => [
      await consentRepo.getSnapshot(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
      }),
      await consentRepo.getSnapshot(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
      }),
    ]);

    expect(whats.marketingStatus).toBe('granted');
    expect(sms.marketingStatus).toBe('never');
  });

  it('marketing e transacional são consentimentos distintos', async () => {
    const contato = await novoContato(wsA, 'Finalidade');
    await withWorkspace(wsA, async (tx) => {
      await consentRepo.grant(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'transactional',
        source: 'form',
        proof: { displayedText: 'Aceito receber confirmações' },
        market: 'US',
      });
    });

    const snap = await withWorkspace(wsA, (tx) =>
      consentRepo.getSnapshot(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
      }),
    );
    expect(snap.marketingStatus).toBe('never');
  });

  it('guarda o texto exibido como prova, não um id de versão', async () => {
    const contato = await novoContato(wsA, 'Prova');
    const texto = 'Concordo em receber mensagens de texto sobre meu orçamento.';
    await withWorkspace(wsA, async (tx) => {
      await consentRepo.grant(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
        source: 'webchat',
        proof: { displayedText: texto, url: 'https://cliente/orcamento', ip: '203.0.113.10' },
        market: 'US',
      });
    });

    const rows = await withWorkspace(wsA, (tx) =>
      tx
        .select()
        .from(contactConsents)
        .where(and(eq(contactConsents.contactId, contato), eq(contactConsents.channel, 'sms'))),
    );
    expect(rows[0]?.proof.displayedText).toBe(texto);
    expect(rows[0]?.grantedAt).toBeInstanceOf(Date);
  });

  it('reconsentir depois de revogar reaproveita a linha, sem órfã', async () => {
    const contato = await novoContato(wsA, 'Recons');
    const grant = async () =>
      withWorkspace(wsA, (tx) =>
        consentRepo.grant(tx, {
          workspaceId: wsA,
          contactId: contato,
          channel: 'email',
          purpose: 'marketing',
          source: 'form',
          proof: { displayedText: 'ok' },
          market: 'US',
        }),
      );

    await grant();
    await withWorkspace(wsA, (tx) =>
      consentRepo.revoke(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'email',
        reason: 'keyword',
      }),
    );
    await grant();

    const rows = await withWorkspace(wsA, (tx) =>
      tx
        .select()
        .from(contactConsents)
        .where(and(eq(contactConsents.contactId, contato), eq(contactConsents.channel, 'email'))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('granted');
    expect(rows[0]?.revokedAt).toBeNull();
  });
});

describe('supressão', () => {
  it('revogação de empresa (channel null) vence consentimento de canal', async () => {
    const contato = await novoContato(wsA, 'Global');
    await withWorkspace(wsA, async (tx) => {
      await consentRepo.grant(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
        source: 'webchat',
        proof: { displayedText: 'aceito' },
        market: 'US',
      });
      await consentRepo.revoke(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: null,
        reason: 'natural_language',
        evidence: { original: 'não quero mais nada de vocês', confidence: 0.93 },
      });
    });

    const snap = await withWorkspace(wsA, (tx) =>
      consentRepo.getSnapshot(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'meta_whatsapp',
        purpose: 'marketing',
      }),
    );
    expect(snap.suppressedGlobally).toBe(true);
    expect(snap.marketingStatus).toBe('revoked');
  });

  it('supressão de canal não vaza para outro canal', async () => {
    const contato = await novoContato(wsA, 'Canal');
    await withWorkspace(wsA, (tx) =>
      consentRepo.revoke(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        reason: 'keyword',
      }),
    );

    const [porSms, porEmail] = await withWorkspace(wsA, async (tx) => [
      await consentRepo.isSuppressed(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
      }),
      await consentRepo.isSuppressed(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'email',
      }),
    ]);
    expect(porSms).toBe(true);
    expect(porEmail).toBe(false);
  });

  it('supressão global é única — revogar duas vezes não duplica linha', async () => {
    const contato = await novoContato(wsA, 'Duplo');
    for (let i = 0; i < 3; i += 1) {
      await withWorkspace(wsA, (tx) =>
        consentRepo.revoke(tx, {
          workspaceId: wsA,
          contactId: contato,
          channel: null,
          reason: 'keyword',
        }),
      );
    }
    const rows = await withWorkspace(wsA, (tx) =>
      tx.select().from(contactSuppressions).where(eq(contactSuppressions.contactId, contato)),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('migração do booleano antigo', () => {
  it('é idempotente: reexecutar o backfill não duplica consentimento', async () => {
    const db = getDb();
    const [contato] = await db
      .insert(contacts)
      .values({
        workspaceId: wsB,
        displayName: `Legado ${suffix}`,
        marketingOptIn: true,
        optInMethod: 'website',
        optInSource: 'landing',
        optInAt: new Date('2026-01-15T12:00:00Z'),
      })
      .returning();
    if (!contato) throw new Error('Falha ao criar contato legado.');

    // Mesmo SQL da migration 0070, reexecutado.
    const backfill = sql`
      INSERT INTO contact_consents
        (workspace_id, contact_id, channel, purpose, status, source, proof, market, granted_at)
      SELECT c.workspace_id, c.id, 'meta_whatsapp', 'marketing', 'granted',
             COALESCE(c.opt_in_method, 'migration'),
             jsonb_build_object('migratedFrom', 'contacts.marketing_opt_in'),
             COALESCE(w.market, 'BR'),
             COALESCE(c.opt_in_at, c.created_at)
      FROM contacts c JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.marketing_opt_in = true AND c.deleted_at IS NULL AND c.id = ${contato.id}
      ON CONFLICT DO NOTHING`;

    await db.execute(backfill);
    await db.execute(backfill);
    await db.execute(backfill);

    const rows = await withWorkspace(wsB, (tx) =>
      tx.select().from(contactConsents).where(eq(contactConsents.contactId, contato.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('granted');
    expect(rows[0]?.source).toBe('website');
    expect(rows[0]?.proof.migratedFrom).toBe('contacts.marketing_opt_in');
  });
});

describe('RLS', () => {
  it('workspace não lê consentimento nem supressão de outro', async () => {
    const contato = await novoContato(wsA, 'Isolado');
    await withWorkspace(wsA, async (tx) => {
      await consentRepo.grant(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
        source: 'form',
        proof: { displayedText: 'ok' },
        market: 'US',
      });
      await consentRepo.revoke(tx, {
        workspaceId: wsA,
        contactId: contato,
        channel: 'email',
        reason: 'manual',
      });
    });

    const vistosDeB = await withWorkspace(wsB, async (tx) => ({
      consents: await tx
        .select()
        .from(contactConsents)
        .where(eq(contactConsents.contactId, contato)),
      suppressions: await tx
        .select()
        .from(contactSuppressions)
        .where(eq(contactSuppressions.contactId, contato)),
    }));

    expect(vistosDeB.consents).toHaveLength(0);
    expect(vistosDeB.suppressions).toHaveLength(0);
  });

  it('escrita cross-workspace é barrada pelo WITH CHECK', async () => {
    const contato = await novoContato(wsA, 'Cross');
    // A violação aborta a TRANSAÇÃO, então o erro sobe pelo `withWorkspace`:
    // capturar por dentro deixaria o rollback estourar depois.
    const erro = await withWorkspace(wsB, (tx) =>
      tx.insert(contactConsents).values({
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
        status: 'granted',
        source: 'api',
        proof: {},
        market: 'US',
        grantedAt: new Date(),
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).not.toBeNull();
    // 42501 = insufficient_privilege, que é como o Postgres reporta violação de RLS.
    const causa = causaPg(erro);
    expect(`${causa.code} ${causa.message}`).toMatch(/42501|row-level security/i);
  });
});

describe('integridade', () => {
  it('CHECK impede linha granted sem carimbo de quando', async () => {
    const contato = await novoContato(wsA, 'SemData');
    const erro = await withWorkspace(wsA, (tx) =>
      tx.insert(contactConsents).values({
        workspaceId: wsA,
        contactId: contato,
        channel: 'sms',
        purpose: 'marketing',
        status: 'granted',
        source: 'api',
        proof: {},
        market: 'US',
        grantedAt: null,
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).not.toBeNull();
    const causa = causaPg(erro);
    expect(causa.code).toBe('23514'); // check_violation
    expect(causa.constraint_name).toBe('contact_consents_granted_at_chk');
  });
});
