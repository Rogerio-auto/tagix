/**
 * F2-S22 — `Date` como parâmetro de `sql` cru, contra Postgres de verdade.
 *
 * O que este arquivo protege:
 *
 * 1. **`Date` em SQL cru funciona.** O driver `drizzle-orm/postgres-js` troca o serializador
 *    dos tipos de data por um repasse; sem a correção em `client.ts`, o postgres.js tenta
 *    escrever o objeto `Date` no protocolo e lança `TypeError`. Foi assim que o rollup de
 *    métricas e a recorrência PIX falharam em todo tick de produção — com o teste do rollup
 *    verde, porque ele mockava o banco.
 * 2. **Colunas tipadas e texto não mudam.** A correção só converte `Date`; texto passa intacto,
 *    preservando microssegundos que um `Date` perderia.
 *
 * As formas testadas são as que o código usa: comparação, `between` e aritmética com
 * `make_interval`. Um upgrade do Drizzle que mude a ordem de inicialização quebra aqui, não
 * em produção.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import { workspaces } from './schema';

afterAll(async () => {
  await closeDb();
});

const inicio = new Date('2026-09-01T00:00:00.000Z');
const fim = new Date('2026-09-30T00:00:00.000Z');
const meio = new Date('2026-09-15T12:34:56.789Z');

describe('Date em sql cru', () => {
  it('comparação com >= e <', async () => {
    const [linha] = await getDb().execute<{ dentro: boolean }>(
      sql`select (${meio}::timestamptz >= ${inicio} and ${meio}::timestamptz < ${fim}) as dentro`,
    );
    expect(linha?.dentro).toBe(true);
  });

  it('between, como na recorrência de cobrança', async () => {
    const [linha] = await getDb().execute<{ dentro: boolean }>(
      sql`select ('2026-09-15T00:00:00Z'::timestamptz between ${inicio} and ${fim}) as dentro`,
    );
    expect(linha?.dentro).toBe(true);
  });

  it('aritmética com make_interval, como no follow-up e no reengajamento', async () => {
    const [linha] = await getDb().execute<{ limite: string }>(
      sql`select to_char((${meio} - make_interval(secs => 60)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') as limite`,
    );
    expect(linha?.limite).toBe('2026-09-15T12:33:56.789');
  });

  it('o instante chega exato, sem deslocamento de fuso', async () => {
    const [linha] = await getDb().execute<{ epoch_ms: string }>(
      sql`select (extract(epoch from ${meio}::timestamptz) * 1000)::bigint::text as epoch_ms`,
    );
    expect(linha?.epoch_ms).toBe(String(meio.getTime()));
  });
});

describe('o que já funcionava continua igual', () => {
  it('texto ISO com cast explícito preserva microssegundos', async () => {
    const [linha] = await getDb().execute<{ t: string }>(
      sql`select to_char(${'2026-09-15 12:34:56.123456+00'}::timestamptz at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as t`,
    );
    expect(linha?.t).toBe('2026-09-15 12:34:56.123456');
  });

  it('coluna timestamptz tipada grava e lê o mesmo instante', async () => {
    const db = getDb();
    const criadoEm = new Date('2026-09-15T08:09:10.111Z');
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'F2S22', slug: `f2s22-${randomUUID().slice(0, 8)}`, planId: null, createdAt: criadoEm })
      .returning();
    try {
      const [lido] = await db.select({ createdAt: workspaces.createdAt }).from(workspaces).where(eq(workspaces.id, ws!.id));
      expect(lido?.createdAt.getTime()).toBe(criadoEm.getTime());
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws!.id));
    }
  });
});
