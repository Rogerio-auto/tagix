/**
 * Testes do servico registerConversion (F38-S16).
 *
 * Foco: o dedup same-day NAO pode envenenar a transacao RLS. O fix usa
 * ON CONFLICT DO NOTHING no INSERT (indice parcial uq_conv_events_dedup), entao
 * uma 2a conversao identica no mesmo dia resolve o conflito no Postgres e
 * retorna { kind: 'deduped' } SEM erro — a transacao continua viva (statements
 * seguintes nao viram 500/25P02).
 *
 * `@hm/db` e mockado: nada de Postgres real. Um `tx` fake encena a resolucao do
 * tipo (select) e o INSERT...ON CONFLICT (retorna [] no conflito, 1 linha no
 * caminho feliz). Verificamos que o builder chamou `onConflictDoNothing` (o
 * guard SQL-level esta cabeado, nao dependemos do catch defensivo).
 */
import { describe, it, expect, vi } from 'vitest';

// Stub de colunas usado nos `target`/`targetWhere` do onConflictDoNothing.
vi.mock('@hm/db', () => ({
  schema: {
    conversionTypes: {
      id: 'id',
      workspaceId: 'workspace_id',
      key: 'key',
    },
    conversionEvents: {
      workspaceId: 'workspace_id',
      contactId: 'contact_id',
      conversionTypeId: 'conversion_type_id',
      occurredAt: 'occurred_at',
      cancelledAt: 'cancelled_at',
    },
  },
}));

const { registerConversion } = await import('./register');
import type { DbTx } from '@hm/db';

const TYPE_ROW = {
  id: 'type-1',
  workspaceId: 'ws-1',
  key: 'venda',
  currency: 'BRL',
  valueRequired: false,
};

/**
 * tx fake. `insertResult` define o que `.returning()` devolve:
 *   - []  -> conflito resolvido (deduped)
 *   - [row] -> linha criada
 * `onConflictSpy` registra que o caminho SQL-level foi usado.
 */
function makeTx(opts: {
  typeRow?: typeof TYPE_ROW | null;
  insertResult: unknown[];
  onConflictSpy: ReturnType<typeof vi.fn>;
}): DbTx {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (opts.typeRow === null ? [] : [opts.typeRow ?? TYPE_ROW]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: (args: unknown) => {
          opts.onConflictSpy(args);
          return {
            returning: async () => opts.insertResult,
          };
        },
      }),
    }),
  };
  return tx as unknown as DbTx;
}

const baseInput = {
  workspaceId: 'ws-1',
  conversionTypeKey: 'venda',
  contactId: 'contact-1',
  source: 'manual' as const,
};

describe('registerConversion — dedup idempotente (F38-S16)', () => {
  it('conversao nova -> kind:created', async () => {
    const onConflictSpy = vi.fn();
    const tx = makeTx({ insertResult: [{ id: 'ev-1' }], onConflictSpy });
    const r = await registerConversion(tx, baseInput);
    expect(r.kind).toBe('created');
    if (r.kind === 'created') expect(r.event).toEqual({ id: 'ev-1' });
  });

  it('duplicata same-day -> kind:deduped SEM throw (ON CONFLICT resolveu)', async () => {
    const onConflictSpy = vi.fn();
    const tx = makeTx({ insertResult: [], onConflictSpy });
    // Nao deve lancar: o conflito e absorvido pelo Postgres, nao por um catch.
    const r = await registerConversion(tx, baseInput);
    expect(r.kind).toBe('deduped');
  });

  it('usa ON CONFLICT DO NOTHING no INSERT (guard SQL-level, nao o catch)', async () => {
    const onConflictSpy = vi.fn();
    const tx = makeTx({ insertResult: [], onConflictSpy });
    await registerConversion(tx, baseInput);
    // O builder passou por onConflictDoNothing(): o conflito e resolvido pelo
    // Postgres, jamais por uma excecao que abortaria a transacao RLS.
    expect(onConflictSpy).toHaveBeenCalledTimes(1);
  });

  it('tipo inexistente -> type_not_found (nao chega ao insert)', async () => {
    const onConflictSpy = vi.fn();
    const tx = makeTx({ typeRow: null, insertResult: [], onConflictSpy });
    const r = await registerConversion(tx, baseInput);
    expect(r.kind).toBe('type_not_found');
    expect(onConflictSpy).not.toHaveBeenCalled();
  });
});
