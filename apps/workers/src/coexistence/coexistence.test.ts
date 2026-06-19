/**
 * Testes do worker de coexistência WhatsApp Business (F39-S04).
 *
 * Duas camadas, ambas sem RabbitMQ/DB real:
 *
 * 1. `handleCoexistenceEnvelope` — roteamento por `envelope.type` + validação
 *    Zod, contra um `CoexistencePersistencePort` fake (verifica dispatch e
 *    descarte de payload inválido / type desconhecido).
 *
 * 2. `DbCoexistencePersistence` — idempotência ancorada no id externo, contra um
 *    fake in-memory de `withWorkspace`/tx (mocka `@hm/db` + `drizzle-orm`). Cobre:
 *      - echo → mensagem outbound, reentrega NÃO duplica (dedup por externalId);
 *      - history import rodando 2x NÃO duplica contatos/mensagens;
 *      - app_state → grava em channels.metadata.coexistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Envelope } from '@hm/shared/mq';
import { COEXISTENCE_EVENT_TYPES } from '@hm/shared/mq';
import type {
  CoexistenceAppStatePayload,
  CoexistenceEchoPayload,
  CoexistenceHistoryBatchPayload,
} from '@hm/shared/mq';
import type { CoexistencePersistencePort } from './ports';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

// ─── In-memory fake DB (shared via vi.hoisted, consumido pelos mocks) ──────────
//
// Tabelas mínimas: channels/contacts/conversations/messages, cada "linha" só com
// os campos lidos/escritos pela persistência. O dedup é simulado pelos índices
// únicos via `onConflictDoNothing.target`. O fake é hoisted para que os factories
// de `vi.mock` (avaliados antes dos imports) possam referenciá-lo sem erro.
const db = vi.hoisted(() => {
  type TableRef = 'channels' | 'contacts' | 'conversations' | 'messages';
  type Row = Record<string, unknown>;

  const store: {
    channels: Row[];
    contacts: Row[];
    conversations: Row[];
    messages: Row[];
    seq: number;
  } = { channels: [], contacts: [], conversations: [], messages: [], seq: 0 };

  function reset(): void {
    store.channels = [
      {
        id: 'chan-1',
        workspaceId: 'ws-1',
        provider: 'meta_whatsapp',
        phoneNumberId: 'PN123',
        isActive: true,
        metadata: {},
      },
    ];
    store.contacts = [];
    store.conversations = [];
    store.messages = [];
    store.seq = 0;
  }

  function nextId(prefix: string): string {
    store.seq += 1;
    return `${prefix}-${store.seq}`;
  }

  type Pred = (row: Row) => boolean;

  // Marcador de coluna devolvido pelo schema mock.
  interface ColMarker {
    __col: string;
  }
  function colName(col: unknown): string {
    if (typeof col === 'object' && col !== null && '__col' in col) {
      return (col as ColMarker).__col;
    }
    return String(col);
  }

  const eq =
    (col: unknown, value: unknown): Pred =>
    (row) =>
      row[colName(col)] === value;
  const isNull =
    (col: unknown): Pred =>
    (row) =>
      row[colName(col)] === null || row[colName(col)] === undefined;
  const and =
    (...preds: Pred[]): Pred =>
    (row) =>
      preds.every((p) => p(row));

  function tableProxy(): Record<string, ColMarker> {
    return new Proxy(
      {},
      { get: (_t, prop: string): ColMarker => ({ __col: prop }) },
    ) as Record<string, ColMarker>;
  }

  const schema = {
    channels: tableProxy(),
    contacts: tableProxy(),
    conversations: tableProxy(),
    messages: tableProxy(),
  };
  // Mapeia o objeto-proxy de volta ao nome da tabela (identidade por referência).
  const tableOf = (ref: unknown): TableRef => {
    if (ref === schema.channels) return 'channels';
    if (ref === schema.contacts) return 'contacts';
    if (ref === schema.conversations) return 'conversations';
    if (ref === schema.messages) return 'messages';
    throw new Error('fake-db: tabela desconhecida');
  };

  function makeTx(): unknown {
    const select = (_cols?: Row) => ({
      from(ref: unknown) {
        const table = tableOf(ref);
        let predicate: Pred = () => true;
        const api = {
          where(pred: Pred) {
            predicate = pred;
            return api;
          },
          async limit(n: number) {
            return store[table].filter(predicate).slice(0, n);
          },
        };
        return api;
      },
    });

    const insert = (ref: unknown) => {
      const table = tableOf(ref);
      let values: Row[] = [];
      let conflictKeys: string[] | null = null;
      const api = {
        values(v: Row | Row[]) {
          values = Array.isArray(v) ? v : [v];
          return api;
        },
        onConflictDoNothing(opts?: { target?: ColMarker[] }) {
          conflictKeys = (opts?.target ?? []).map((c) => colName(c));
          return api;
        },
        async returning(_cols?: Row) {
          const rows = store[table];
          const inserted: Row[] = [];
          for (const v of values) {
            if (conflictKeys && conflictKeys.length > 0) {
              const dup = rows.some((existing) =>
                conflictKeys!.every((k) => existing[k] === v[k]),
              );
              if (dup) continue;
            }
            const row: Row = { id: nextId(table), deletedAt: null, metadata: {}, ...v };
            rows.push(row);
            inserted.push(row);
          }
          return inserted;
        },
      };
      return api;
    };

    const update = (ref: unknown) => {
      const table = tableOf(ref);
      let patch: Row = {};
      const api = {
        set(p: Row) {
          patch = p;
          return api;
        },
        async where(pred: Pred) {
          for (const row of store[table]) {
            if (pred(row)) Object.assign(row, patch);
          }
        },
      };
      return api;
    };

    return { select, insert, update };
  }

  const getDb = () => ({
    select: (_cols?: Row) => ({
      from: (ref: unknown) => {
        const table = tableOf(ref);
        let predicate: Pred = () => true;
        const api = {
          where(pred: Pred) {
            predicate = pred;
            return api;
          },
          async limit(n: number) {
            return store[table].filter(predicate).slice(0, n);
          },
        };
        return api;
      },
    }),
  });

  const withWorkspace = async (_ws: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(makeTx());

  return { store, reset, schema, eq, isNull, and, getDb, withWorkspace };
});

vi.mock('@hm/db', () => ({
  schema: db.schema,
  getDb: db.getDb,
  withWorkspace: db.withWorkspace,
}));

vi.mock('drizzle-orm', () => ({
  eq: db.eq,
  isNull: db.isNull,
  and: db.and,
}));

// Importa DEPOIS dos mocks.
const { handleCoexistenceEnvelope } = await import('./worker');
const { DbCoexistencePersistence } = await import('./db-ports');

const store = db.store;

// ─── 1. handleCoexistenceEnvelope — roteamento ────────────────────────────────

function makeFakePort(): CoexistencePersistencePort & {
  echo: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  appState: ReturnType<typeof vi.fn>;
} {
  const echo = vi.fn(async () => ({ resolved: true, inserted: true }));
  const history = vi.fn(async () => ({
    resolved: true,
    contactsInserted: 0,
    messagesInserted: 0,
    messagesDeduped: 0,
  }));
  const appState = vi.fn(async () => ({ resolved: true }));
  return {
    echo,
    history,
    appState,
    persistEcho: echo,
    importHistory: history,
    syncAppState: appState,
  };
}

function envelope(type: string, payload: unknown): Envelope {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    type,
    workspaceId: '00000000-0000-0000-0000-000000000000',
    ts: Date.now(),
    payload,
  };
}

const echoPayload: CoexistenceEchoPayload = {
  phoneNumberId: 'PN123',
  externalId: 'wamid.echo.1',
  to: '5511999',
  type: 'text',
  text: 'enviado pelo app',
  timestamp: 1700000000,
  raw: {},
};

describe('handleCoexistenceEnvelope — roteamento por type', () => {
  it('echo válido → persistEcho', async () => {
    const port = makeFakePort();
    await handleCoexistenceEnvelope(envelope(COEXISTENCE_EVENT_TYPES.echo, echoPayload), {
      deps: { persistence: port },
      logger,
    });
    expect(port.echo).toHaveBeenCalledOnce();
    expect(port.echo.mock.calls[0]?.[0]).toMatchObject({ externalId: 'wamid.echo.1' });
  });

  it('history válido → importHistory', async () => {
    const port = makeFakePort();
    const payload: CoexistenceHistoryBatchPayload = {
      phoneNumberId: 'PN123',
      contacts: [{ waId: '5511999', raw: {} }],
      messages: [{ externalId: 'h.1', from: '5511999', raw: {} }],
      raw: {},
    };
    await handleCoexistenceEnvelope(envelope(COEXISTENCE_EVENT_TYPES.history, payload), {
      deps: { persistence: port },
      logger,
    });
    expect(port.history).toHaveBeenCalledOnce();
  });

  it('app_state válido → syncAppState', async () => {
    const port = makeFakePort();
    const payload: CoexistenceAppStatePayload = {
      phoneNumberId: 'PN123',
      state: 'connected',
      raw: {},
    };
    await handleCoexistenceEnvelope(envelope(COEXISTENCE_EVENT_TYPES.appState, payload), {
      deps: { persistence: port },
      logger,
    });
    expect(port.appState).toHaveBeenCalledOnce();
  });

  it('payload inválido → descarta sem chamar a persistência', async () => {
    const port = makeFakePort();
    await handleCoexistenceEnvelope(envelope(COEXISTENCE_EVENT_TYPES.echo, { nope: true }), {
      deps: { persistence: port },
      logger,
    });
    expect(port.echo).not.toHaveBeenCalled();
  });

  it('type desconhecido → ignora', async () => {
    const port = makeFakePort();
    await handleCoexistenceEnvelope(envelope('coexistence.unknown', echoPayload), {
      deps: { persistence: port },
      logger,
    });
    expect(port.echo).not.toHaveBeenCalled();
    expect(port.history).not.toHaveBeenCalled();
    expect(port.appState).not.toHaveBeenCalled();
  });
});

// ─── 2. DbCoexistencePersistence — idempotência (fake DB) ──────────────────────

describe('DbCoexistencePersistence — echo', () => {
  beforeEach(() => db.reset());

  it('echo vira mensagem outbound origem app; reentrega NÃO duplica', async () => {
    const p = new DbCoexistencePersistence(logger);

    const first = await p.persistEcho(echoPayload);
    expect(first.resolved).toBe(true);
    expect(first.inserted).toBe(true);

    const outbound = store.messages.filter((m) => m['direction'] === 'outbound');
    expect(outbound).toHaveLength(1);
    expect(outbound[0]).toMatchObject({
      externalId: 'wamid.echo.1',
      direction: 'outbound',
      senderType: 'system',
      content: 'enviado pelo app',
    });
    expect(outbound[0]?.['metadata']).toMatchObject({ origin: 'coexistence_echo' });
    expect(store.contacts).toHaveLength(1);
    expect(store.conversations).toHaveLength(1);

    // Reentrega do mesmo echo: dedup por externalId → não insere de novo.
    const second = await p.persistEcho(echoPayload);
    expect(second.inserted).toBe(false);
    expect(store.messages.filter((m) => m['direction'] === 'outbound')).toHaveLength(1);
  });

  it('echo sem canal para phoneNumberId → resolved=false', async () => {
    const p = new DbCoexistencePersistence(logger);
    const result = await p.persistEcho({ ...echoPayload, phoneNumberId: 'PN_ORPHAN' });
    expect(result.resolved).toBe(false);
    expect(result.inserted).toBe(false);
    expect(store.messages).toHaveLength(0);
  });
});

describe('DbCoexistencePersistence — history import idempotente', () => {
  beforeEach(() => db.reset());

  const batch: CoexistenceHistoryBatchPayload = {
    phoneNumberId: 'PN123',
    contacts: [
      { waId: '5511999', name: 'Alice', raw: {} },
      { waId: '5511888', name: 'Bob', raw: {} },
    ],
    messages: [
      { externalId: 'h.in.1', from: '5511999', type: 'text', text: 'oi', fromMe: false, raw: {} },
      { externalId: 'h.out.1', to: '5511999', type: 'text', text: 'ola', fromMe: true, raw: {} },
      { externalId: 'h.in.2', from: '5511888', type: 'text', text: 'eai', fromMe: false, raw: {} },
    ],
    raw: {},
  };

  it('rodar 2x NÃO duplica contatos nem mensagens', async () => {
    const p = new DbCoexistencePersistence(logger);

    const r1 = await p.importHistory(batch);
    expect(r1.resolved).toBe(true);
    expect(r1.contactsInserted).toBe(2);
    expect(r1.messagesInserted).toBe(3);
    expect(r1.messagesDeduped).toBe(0);
    expect(store.contacts).toHaveLength(2);
    expect(store.messages).toHaveLength(3);
    expect(store.conversations).toHaveLength(2);

    const out = store.messages.filter((m) => m['direction'] === 'outbound');
    const inb = store.messages.filter((m) => m['direction'] === 'inbound');
    expect(out.map((m) => m['externalId'])).toEqual(['h.out.1']);
    expect(inb.map((m) => m['externalId']).sort()).toEqual(['h.in.1', 'h.in.2']);

    // Reprocesso: tudo dedup, zero novas linhas.
    const r2 = await p.importHistory(batch);
    expect(r2.contactsInserted).toBe(0);
    expect(r2.messagesInserted).toBe(0);
    expect(r2.messagesDeduped).toBe(3);
    expect(store.contacts).toHaveLength(2);
    expect(store.messages).toHaveLength(3);
    expect(store.conversations).toHaveLength(2);
  });

  it('history sem canal → resolved=false, nada gravado', async () => {
    const p = new DbCoexistencePersistence(logger);
    const result = await p.importHistory({ ...batch, phoneNumberId: 'PN_ORPHAN' });
    expect(result.resolved).toBe(false);
    expect(store.messages).toHaveLength(0);
    expect(store.contacts).toHaveLength(0);
  });
});

describe('DbCoexistencePersistence — app_state', () => {
  beforeEach(() => db.reset());

  it('grava estado em channels.metadata.coexistence', async () => {
    const p = new DbCoexistencePersistence(logger);
    const result = await p.syncAppState({ phoneNumberId: 'PN123', state: 'connected', raw: {} });
    expect(result.resolved).toBe(true);

    const chan = store.channels.find((c) => c['id'] === 'chan-1');
    expect(chan?.['metadata']).toMatchObject({ coexistence: { state: 'connected' } });
  });

  it('app_state sem canal → resolved=false', async () => {
    const p = new DbCoexistencePersistence(logger);
    const result = await p.syncAppState({ phoneNumberId: 'PN_ORPHAN', state: 'connected', raw: {} });
    expect(result.resolved).toBe(false);
  });
});
