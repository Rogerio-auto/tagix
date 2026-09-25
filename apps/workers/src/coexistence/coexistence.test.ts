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
import type {
  CoexistenceMessageNewEmit,
  CoexistencePersistencePort,
  CoexistenceSocketPort,
} from './ports';
import type { InboundMediaJob, MediaEnqueuePort } from '../inbound/ports';
import type { InstagramEchoInput } from './instagram-echo';

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
  type TableRef =
    | 'channels'
    | 'contacts'
    | 'conversations'
    | 'messages'
    | 'members'
    | 'tags'
    | 'contactTags';
  type Row = Record<string, unknown>;

  const store: {
    channels: Row[];
    contacts: Row[];
    conversations: Row[];
    messages: Row[];
    members: Row[];
    tags: Row[];
    contactTags: Row[];
    seq: number;
  } = {
    channels: [],
    contacts: [],
    conversations: [],
    messages: [],
    members: [],
    tags: [],
    contactTags: [],
    seq: 0,
  };

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
      {
        id: 'chan-ig',
        workspaceId: 'ws-1',
        provider: 'meta_instagram',
        igUserId: 'IG_ACCOUNT',
        isActive: true,
        metadata: {},
      },
    ];
    // Dois OWNERs ativos (o mais antigo é o dono resolvido), um OWNER inativo mais
    // antigo ainda (não pode ganhar) e um AGENT ativo (apontável por metadata).
    store.members = [
      {
        id: 'm-owner-old-inactive',
        workspaceId: 'ws-1',
        role: 'OWNER',
        status: 'inactive',
        createdAt: new Date('2024-01-01'),
      },
      {
        id: 'm-owner',
        workspaceId: 'ws-1',
        role: 'OWNER',
        status: 'active',
        createdAt: new Date('2025-01-01'),
      },
      {
        id: 'm-owner-2',
        workspaceId: 'ws-1',
        role: 'OWNER',
        status: 'active',
        createdAt: new Date('2025-06-01'),
      },
      {
        id: '11111111-1111-4111-8111-111111111111',
        workspaceId: 'ws-1',
        role: 'AGENT',
        status: 'active',
        createdAt: new Date('2025-03-01'),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        workspaceId: 'ws-2',
        role: 'AGENT',
        status: 'active',
        createdAt: new Date('2025-03-01'),
      },
    ];
    store.tags = [];
    store.contactTags = [];
    store.contacts = [];
    store.conversations = [];
    store.messages = [];
    store.seq = 0;
    locks.length = 0;
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
    return new Proxy({}, { get: (_t, prop: string): ColMarker => ({ __col: prop }) }) as Record<
      string,
      ColMarker
    >;
  }

  const schema = {
    channels: tableProxy(),
    contacts: tableProxy(),
    conversations: tableProxy(),
    messages: tableProxy(),
    members: tableProxy(),
    tags: tableProxy(),
    contactTags: tableProxy(),
  };
  // Mapeia o objeto-proxy de volta ao nome da tabela (identidade por referência).
  const tableOf = (ref: unknown): TableRef => {
    if (ref === schema.channels) return 'channels';
    if (ref === schema.contacts) return 'contacts';
    if (ref === schema.conversations) return 'conversations';
    if (ref === schema.messages) return 'messages';
    if (ref === schema.members) return 'members';
    if (ref === schema.tags) return 'tags';
    if (ref === schema.contactTags) return 'contactTags';
    throw new Error('fake-db: tabela desconhecida');
  };

  // `asc(col)` do mock: marcador de ordenação consumido por `orderBy`.
  interface AscMarker {
    __asc: string;
  }
  const asc = (col: unknown): AscMarker => ({ __asc: colName(col) });
  function compare(a: unknown, b: unknown): number {
    const av = a instanceof Date ? a.getTime() : a;
    const bv = b instanceof Date ? b.getTime() : b;
    if (av === bv) return 0;
    return (av as number | string) < (bv as number | string) ? -1 : 1;
  }

  // Locks pedidos via `.for('update')` (observáveis no teste).
  const locks: string[] = [];

  function makeTx(): unknown {
    const select = (_cols?: Row) => ({
      from(ref: unknown) {
        const table = tableOf(ref);
        let predicate: Pred = () => true;
        let order: AscMarker[] = [];
        const api = {
          where(pred: Pred) {
            predicate = pred;
            return api;
          },
          orderBy(...markers: AscMarker[]) {
            order = markers;
            return api;
          },
          for(strength: string) {
            locks.push(`${table}:${strength}`);
            return api;
          },
          async limit(n: number) {
            const rows = store[table].filter(predicate);
            if (order.length > 0) {
              rows.sort((a, b) => {
                for (const o of order) {
                  const c = compare(a[o.__asc], b[o.__asc]);
                  if (c !== 0) return c;
                }
                return 0;
              });
            }
            return rows.slice(0, n);
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
          // Sem target explícito: o conflito é o da PK (contact_tags = contact+tag).
          if (conflictKeys.length === 0 && table === 'contactTags') {
            conflictKeys = ['contactId', 'tagId'];
          }
          return api;
        },
        // `await tx.insert(...).values(...).onConflictDoNothing()` sem `returning`.
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          api.returning().then(resolve, reject);
        },
        async returning(_cols?: Row) {
          const rows = store[table];
          const inserted: Row[] = [];
          for (const v of values) {
            if (conflictKeys && conflictKeys.length > 0) {
              const dup = rows.some((existing) => conflictKeys!.every((k) => existing[k] === v[k]));
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

  const withWorkspace = async (_ws: string, fn: (tx: unknown) => Promise<unknown>) => fn(makeTx());

  return { store, reset, schema, eq, isNull, and, asc, getDb, withWorkspace, locks };
});

vi.mock('@hm/db', () => ({
  schema: db.schema,
  getDb: db.getDb,
  withWorkspace: db.withWorkspace,
  // F70-S16: a outbox real é coberta em conversation-opened.test.ts (Postgres dev).
  enqueueOutbox: async (_tx: unknown, messages: readonly unknown[]) => messages.length,
}));

vi.mock('drizzle-orm', () => ({
  eq: db.eq,
  isNull: db.isNull,
  and: db.and,
  asc: db.asc,
  // `sql` tagged template: o fake de onConflict ignora o predicado `where` (dedup
  // por target), então um stub que não quebra a chamada basta.
  sql: () => ({}),
}));

// Importa DEPOIS dos mocks.
const { handleCoexistenceEnvelope, handleInstagramEchoes, ownMetaAppIdsFromEnv } =
  await import('./worker');
const { DbCoexistencePersistence, MqCoexistenceSocketEmit } = await import('./db-ports');

const store = db.store;

// ─── 1. handleCoexistenceEnvelope — roteamento ────────────────────────────────

function makeFakePort(): CoexistencePersistencePort & {
  echo: ReturnType<typeof vi.fn>;
  history: ReturnType<typeof vi.fn>;
  appState: ReturnType<typeof vi.fn>;
  igEcho: ReturnType<typeof vi.fn>;
} {
  const echoResult = { resolved: true, inserted: true, aiPaused: false, startedByApp: false };
  const echo = vi.fn(async () => echoResult);
  const igEcho = vi.fn(async () => echoResult);
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
    igEcho,
    persistEcho: echo,
    persistInstagramEcho: igEcho,
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
      senderType: 'member',
      senderMemberId: 'm-owner',
      content: 'enviado pelo app',
    });
    expect(outbound[0]?.['metadata']).toMatchObject({
      origin: 'app',
      echoSource: 'whatsapp_coexistence',
    });
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

// ─── 3. Socket emit (real-time) — echo + history ──────────────────────────────

/** Spy de socket que captura os eventos emitidos pela persistência. */
function makeSocketSpy(): CoexistenceSocketPort & {
  messageNew: CoexistenceMessageNewEmit[];
  updated: Array<{ workspaceId: string; conversationId: string }>;
  aiModeChanged: Array<{ workspaceId: string; conversationId: string; aiMode: string }>;
} {
  const messageNew: CoexistenceMessageNewEmit[] = [];
  const updated: Array<{ workspaceId: string; conversationId: string }> = [];
  const aiModeChanged: Array<{ workspaceId: string; conversationId: string; aiMode: string }> = [];
  return {
    messageNew,
    updated,
    aiModeChanged,
    async emitAiModeChanged(workspaceId, conversationId, aiMode) {
      aiModeChanged.push({ workspaceId, conversationId, aiMode });
    },
    async emitMessageNew(input) {
      messageNew.push(input);
    },
    async emitConversationUpdated(workspaceId, conversationId) {
      updated.push({ workspaceId, conversationId });
    },
  };
}

describe('DbCoexistencePersistence — socket emit', () => {
  beforeEach(() => db.reset());

  it('echo inserido → emite message:new outbound uma vez; dedup NÃO reemite', async () => {
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);

    await p.persistEcho(echoPayload);
    expect(socket.messageNew).toHaveLength(1);
    expect(socket.messageNew[0]).toMatchObject({
      externalId: 'wamid.echo.1',
      direction: 'outbound',
      type: 'text',
      content: 'enviado pelo app',
    });

    // Reentrega: dedup → sem novo message:new (espelha o inbound).
    await p.persistEcho(echoPayload);
    expect(socket.messageNew).toHaveLength(1);
  });

  it('echo órfão (sem canal) → não emite nada', async () => {
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);
    await p.persistEcho({ ...echoPayload, phoneNumberId: 'PN_ORPHAN' });
    expect(socket.messageNew).toHaveLength(0);
  });

  it('history → emite conversation:updated uma vez por conversa afetada (sem flood de message:new)', async () => {
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);

    const batch: CoexistenceHistoryBatchPayload = {
      phoneNumberId: 'PN123',
      contacts: [
        { waId: '5511999', raw: {} },
        { waId: '5511888', raw: {} },
      ],
      messages: [
        { externalId: 'h.1', from: '5511999', type: 'text', text: 'a', fromMe: false, raw: {} },
        { externalId: 'h.2', from: '5511999', type: 'text', text: 'b', fromMe: false, raw: {} },
        { externalId: 'h.3', from: '5511888', type: 'text', text: 'c', fromMe: false, raw: {} },
      ],
      raw: {},
    };

    await p.importHistory(batch);
    // Backfill NÃO empurra bolhas individuais.
    expect(socket.messageNew).toHaveLength(0);
    // Uma sinalização por conversa (2 contrapartes), sem duplicar.
    expect(socket.updated).toHaveLength(2);

    // Reprocesso: tudo dedup → nada novo emitido.
    socket.updated.length = 0;
    await p.importHistory(batch);
    expect(socket.updated).toHaveLength(0);
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

// ─── 4. Download de mídia (echo + history) ────────────────────────────────────

/** Spy de enqueue de mídia: captura os jobs publicados (sem RabbitMQ). */
function makeMediaSpy(): MediaEnqueuePort & { jobs: InboundMediaJob[] } {
  const jobs: InboundMediaJob[] = [];
  return {
    jobs,
    async enqueue(job) {
      jobs.push(job);
    },
  };
}

describe('DbCoexistencePersistence — download de mídia', () => {
  beforeEach(() => db.reset());

  const audioEcho: CoexistenceEchoPayload = {
    phoneNumberId: 'PN123',
    externalId: 'wamid.audio.1',
    to: '5511999',
    type: 'audio',
    timestamp: 1700000000,
    raw: { type: 'audio', audio: { id: 'MEDIA-OGG-1', mime_type: 'audio/ogg', sha256: 'abc' } },
  };

  it('echo de mídia → persiste media_status=pending e enfileira o job de download', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);

    const r = await p.persistEcho(audioEcho);
    expect(r.inserted).toBe(true);

    const [msg] = store.messages.filter((m) => m['direction'] === 'outbound');
    expect(msg).toMatchObject({ type: 'audio', mediaStatus: 'pending' });

    expect(media.jobs).toHaveLength(1);
    expect(media.jobs[0]).toMatchObject({
      provider: 'meta_whatsapp',
      externalId: 'wamid.audio.1',
      mediaRef: { refOrUrl: 'MEDIA-OGG-1', mimeType: 'audio/ogg', sha256: 'abc' },
      routing: { phoneNumberId: 'PN123' },
    });
  });

  it('echo de texto → não marca pending nem enfileira', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);
    await p.persistEcho(echoPayload); // type 'text'
    expect(media.jobs).toHaveLength(0);
    const [msg] = store.messages.filter((m) => m['direction'] === 'outbound');
    expect(msg?.['mediaStatus']).toBeUndefined();
  });

  it('reentrega de echo de mídia → dedup, NÃO reenfileira', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);
    await p.persistEcho(audioEcho);
    await p.persistEcho(audioEcho);
    expect(media.jobs).toHaveLength(1);
  });

  it('echo de mídia sem id no raw → persiste sem pending e não enfileira', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);
    await p.persistEcho({
      ...audioEcho,
      externalId: 'wamid.audio.noid',
      raw: { type: 'audio', audio: { mime_type: 'audio/ogg' } },
    });
    expect(media.jobs).toHaveLength(0);
    const [msg] = store.messages.filter((m) => m['direction'] === 'outbound');
    expect(msg?.['mediaStatus']).toBeUndefined();
  });

  it('history com mídia → marca pending e enfileira só as mensagens inseridas', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);
    const batch: CoexistenceHistoryBatchPayload = {
      phoneNumberId: 'PN123',
      contacts: [{ waId: '5511999', raw: {} }],
      messages: [
        {
          externalId: 'h.img.1',
          from: '5511999',
          type: 'image',
          fromMe: false,
          raw: { type: 'image', image: { id: 'IMG-1', mime_type: 'image/jpeg' } },
        },
        {
          externalId: 'h.txt.1',
          from: '5511999',
          type: 'text',
          text: 'oi',
          fromMe: false,
          raw: {},
        },
      ],
      raw: {},
    };

    await p.importHistory(batch);
    expect(media.jobs).toHaveLength(1);
    expect(media.jobs[0]).toMatchObject({ externalId: 'h.img.1', mediaRef: { refOrUrl: 'IMG-1' } });

    // Reprocesso: tudo dedup → nada reenfileirado.
    media.jobs.length = 0;
    await p.importHistory(batch);
    expect(media.jobs).toHaveLength(0);
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
    const result = await p.syncAppState({
      phoneNumberId: 'PN_ORPHAN',
      state: 'connected',
      raw: {},
    });
    expect(result.resolved).toBe(false);
  });
});

// ─── 5. F70-S04 — eco do app vira mensagem humana e pausa a IA ─────────────────

const ECHO_AT = new Date(echoPayload.timestamp! * 1000);

/** Conversa pré-existente (aberta pelo contato) no canal WA para `5511999`. */
function seedConversation(extra: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 'conv-existing',
    workspaceId: 'ws-1',
    channelId: 'chan-1',
    remoteId: '5511999',
    contactId: null,
    aiMode: 'off',
    aiPausedReason: null,
    firstResponseAt: null,
    aiLastHumanAt: null,
    ...extra,
  };
  store.conversations.push(row);
  return row;
}

describe('F70-S04 — autoria do eco (dono do canal)', () => {
  beforeEach(() => db.reset());

  it('sem apontamento → OWNER ativo mais antigo (ignora OWNER inativo)', async () => {
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    const [msg] = store.messages;
    expect(msg).toMatchObject({ senderType: 'member', senderMemberId: 'm-owner' });
  });

  it('channels.metadata.ownerMemberId aponta um membro ativo do workspace → ele é o autor', async () => {
    const chan = store.channels.find((c) => c['id'] === 'chan-1');
    chan!['metadata'] = { ownerMemberId: '11111111-1111-4111-8111-111111111111' };
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(store.messages[0]?.['senderMemberId']).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('apontamento para membro de OUTRO workspace ou valor não-uuid → cai no OWNER', async () => {
    const chan = store.channels.find((c) => c['id'] === 'chan-1');
    const p = new DbCoexistencePersistence(logger);

    chan!['metadata'] = { ownerMemberId: '22222222-2222-4222-8222-222222222222' };
    await p.persistEcho(echoPayload);
    expect(store.messages[0]?.['senderMemberId']).toBe('m-owner');

    chan!['metadata'] = { ownerMemberId: 'not-a-uuid' };
    await p.persistEcho({ ...echoPayload, externalId: 'wamid.echo.2' });
    expect(store.messages[1]?.['senderMemberId']).toBe('m-owner');
  });

  it('workspace sem OWNER ativo → continua member, sem autor', async () => {
    store.members = store.members.filter((m) => m['role'] !== 'OWNER');
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(store.messages[0]).toMatchObject({ senderType: 'member', senderMemberId: null });
  });

  it('conversation.lastMessageFrom = member', async () => {
    seedConversation({});
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(store.conversations[0]?.['lastMessageFrom']).toBe('member');
  });
});

describe('F70-S04 — pausa da IA (mesma regra da UI)', () => {
  beforeEach(() => db.reset());

  it('ai_mode=on → paused/human_takeover com autor e instante do eco; emite ai_mode_changed', async () => {
    const conv = seedConversation({ aiMode: 'on' });
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);

    const r = await p.persistEcho(echoPayload);

    expect(r).toMatchObject({ inserted: true, aiPaused: true, startedByApp: false });
    expect(conv).toMatchObject({
      aiMode: 'paused',
      aiPausedReason: 'human_takeover',
      aiPausedAt: ECHO_AT,
      aiPausedBy: 'm-owner',
      aiLastHumanAt: ECHO_AT,
    });
    expect(socket.aiModeChanged).toEqual([
      { workspaceId: 'ws-1', conversationId: 'conv-existing', aiMode: 'paused' },
    ]);
    // Estado lido sob lock de linha (serializa ecos concorrentes).
    expect(db.locks).toContain('conversations:update');
    expect(socket.messageNew[0]).toMatchObject({ senderType: 'member', direction: 'outbound' });
  });

  it('reentrega do mesmo eco → não repausa nem reemite', async () => {
    seedConversation({ aiMode: 'on' });
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);
    await p.persistEcho(echoPayload);
    const again = await p.persistEcho(echoPayload);
    expect(again).toMatchObject({ inserted: false, aiPaused: false });
    expect(socket.aiModeChanged).toHaveLength(1);
  });

  it('ai_mode=off → continua off; só registra atividade humana', async () => {
    const conv = seedConversation({ aiMode: 'off' });
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);
    const r = await p.persistEcho(echoPayload);
    expect(r.aiPaused).toBe(false);
    expect(conv).toMatchObject({ aiMode: 'off', aiPausedReason: null, aiLastHumanAt: ECHO_AT });
    expect(conv['aiPausedBy']).toBeUndefined();
    expect(socket.aiModeChanged).toHaveLength(0);
  });

  it('ai_mode=paused (manual) → preserva modo, motivo e autor da pausa', async () => {
    const pausedAt = new Date('2023-01-01');
    const conv = seedConversation({
      aiMode: 'paused',
      aiPausedReason: 'manual',
      aiPausedAt: pausedAt,
      aiPausedBy: 'm-owner-2',
    });
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);
    await p.persistEcho(echoPayload);
    expect(conv).toMatchObject({
      aiMode: 'paused',
      aiPausedReason: 'manual',
      aiPausedAt: pausedAt,
      aiPausedBy: 'm-owner-2',
      aiLastHumanAt: ECHO_AT,
    });
    expect(socket.aiModeChanged).toHaveLength(0);
  });
});

describe('F70-S04 — first_response_at', () => {
  beforeEach(() => db.reset());

  it('conversa aberta pelo contato, sem resposta ainda → grava o instante do eco', async () => {
    const conv = seedConversation({});
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(conv['firstResponseAt']).toEqual(ECHO_AT);
  });

  it('já respondida → não sobrescreve', async () => {
    const first = new Date('2023-06-01T10:00:00Z');
    const conv = seedConversation({ firstResponseAt: first });
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(conv['firstResponseAt']).toBe(first);
  });
});

describe('F70-S04 — conversa iniciada pelo app (prospecção)', () => {
  beforeEach(() => db.reset());

  it('primeira mensagem é eco → nasce off, sem first_response, contato etiquetado origem:prospeccao', async () => {
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);

    const r = await p.persistEcho(echoPayload);

    expect(r).toMatchObject({ inserted: true, startedByApp: true, aiPaused: false });
    const [conv] = store.conversations;
    expect(conv).toMatchObject({
      aiMode: 'off',
      aiLastHumanAt: ECHO_AT,
      lastMessageFrom: 'member',
    });
    expect(conv?.['firstResponseAt']).toBeUndefined();

    expect(store.tags).toHaveLength(1);
    expect(store.tags[0]).toMatchObject({ workspaceId: 'ws-1', name: 'origem:prospeccao' });
    const [contact] = store.contacts;
    expect(store.contactTags).toEqual([
      expect.objectContaining({
        contactId: contact?.['id'],
        tagId: store.tags[0]?.['id'],
        workspaceId: 'ws-1',
        taggedBy: 'm-owner',
      }),
    ]);
    expect(socket.aiModeChanged).toHaveLength(0);
  });

  it('segundo eco na mesma conversa → não é mais "início"; não reetiqueta', async () => {
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    const second = await p.persistEcho({ ...echoPayload, externalId: 'wamid.echo.2' });
    expect(second.startedByApp).toBe(false);
    expect(store.tags).toHaveLength(1);
    expect(store.contactTags).toHaveLength(1);
  });

  it('reusa a etiqueta já existente no workspace', async () => {
    store.tags.push({ id: 'tag-existing', workspaceId: 'ws-1', name: 'origem:prospeccao' });
    const p = new DbCoexistencePersistence(logger);
    await p.persistEcho(echoPayload);
    expect(store.tags).toHaveLength(1);
    expect(store.contactTags[0]?.['tagId']).toBe('tag-existing');
  });

  it('conversa aberta pelo contato NÃO é prospecção (sem etiqueta)', async () => {
    seedConversation({});
    const p = new DbCoexistencePersistence(logger);
    const r = await p.persistEcho(echoPayload);
    expect(r.startedByApp).toBe(false);
    expect(store.contactTags).toHaveLength(0);
  });
});

describe('F70-S04 — eco do Instagram', () => {
  beforeEach(() => db.reset());

  const igEcho: InstagramEchoInput = {
    provider: 'meta_instagram',
    igUserId: 'IG_ACCOUNT',
    contactRemoteId: 'IGSID_1',
    externalId: 'mid.echo.1',
    messageType: 'text',
    content: 'respondi pelo app do IG',
    rawTimestamp: '2026-09-24T12:00:00.000Z',
  };

  it('vira mensagem member do dono, origin=app/instagram_echo; contato source=instagram', async () => {
    const socket = makeSocketSpy();
    const p = new DbCoexistencePersistence(logger, undefined, socket);

    const r = await p.persistInstagramEcho(igEcho);

    expect(r).toMatchObject({ resolved: true, inserted: true, startedByApp: true });
    expect(store.messages[0]).toMatchObject({
      externalId: 'mid.echo.1',
      direction: 'outbound',
      senderType: 'member',
      senderMemberId: 'm-owner',
      content: 'respondi pelo app do IG',
      createdAt: new Date('2026-09-24T12:00:00.000Z'),
      metadata: { origin: 'app', echoSource: 'instagram_echo' },
    });
    expect(store.contacts[0]).toMatchObject({ phone: 'IGSID_1', source: 'instagram' });
    expect(store.conversations[0]).toMatchObject({
      channelId: 'chan-ig',
      remoteId: 'IGSID_1',
      aiMode: 'off',
    });
    expect(socket.messageNew).toHaveLength(1);
  });

  it('pausa a IA de conversa IG com ai_mode=on', async () => {
    store.conversations.push({
      id: 'conv-ig',
      workspaceId: 'ws-1',
      channelId: 'chan-ig',
      remoteId: 'IGSID_1',
      contactId: null,
      aiMode: 'on',
      firstResponseAt: null,
      aiLastHumanAt: null,
    });
    const p = new DbCoexistencePersistence(logger);
    const r = await p.persistInstagramEcho(igEcho);
    expect(r.aiPaused).toBe(true);
    expect(store.conversations[0]).toMatchObject({
      aiMode: 'paused',
      aiPausedReason: 'human_takeover',
      aiPausedBy: 'm-owner',
    });
  });

  it('eco do próprio app (app_id do Leadium) → ignorado, nada gravado', async () => {
    const p = new DbCoexistencePersistence(
      logger,
      undefined,
      undefined,
      undefined,
      new Set(['999']),
    );
    const r = await p.persistInstagramEcho({ ...igEcho, appId: '999' });
    expect(r).toMatchObject({ resolved: true, inserted: false, skipped: 'own_app' });
    expect(store.messages).toHaveLength(0);
    expect(store.conversations).toHaveLength(0);
  });

  it('eco de outro app (ex.: app do Instagram) → persistido normalmente', async () => {
    const p = new DbCoexistencePersistence(
      logger,
      undefined,
      undefined,
      undefined,
      new Set(['999']),
    );
    const r = await p.persistInstagramEcho({ ...igEcho, appId: '124024574287414' });
    expect(r.inserted).toBe(true);
  });

  it('reentrega do mesmo mid → dedup', async () => {
    const p = new DbCoexistencePersistence(logger);
    await p.persistInstagramEcho(igEcho);
    const again = await p.persistInstagramEcho(igEcho);
    expect(again.inserted).toBe(false);
    expect(store.messages).toHaveLength(1);
  });

  it('igUserId sem canal → resolved=false', async () => {
    const p = new DbCoexistencePersistence(logger);
    const r = await p.persistInstagramEcho({ ...igEcho, igUserId: 'IG_ORPHAN' });
    expect(r.resolved).toBe(false);
    expect(store.messages).toHaveLength(0);
  });

  it('eco de mídia → pending + job de download roteado pelo igUserId', async () => {
    const media = makeMediaSpy();
    const p = new DbCoexistencePersistence(logger, undefined, undefined, media);
    await p.persistInstagramEcho({
      ...igEcho,
      externalId: 'mid.img',
      messageType: 'image',
      content: undefined,
      mediaRef: { refOrUrl: 'https://cdn.example/x.jpg' },
    });
    expect(store.messages[0]).toMatchObject({ type: 'image', mediaStatus: 'pending' });
    expect(media.jobs).toEqual([
      {
        provider: 'meta_instagram',
        externalId: 'mid.img',
        mediaRef: { refOrUrl: 'https://cdn.example/x.jpg' },
        routing: { igUserId: 'IG_ACCOUNT' },
      },
    ]);
  });
});

describe('F70-S04 — handleInstagramEchoes (entrada via fila)', () => {
  it('valida cada evento com Zod; inválido é descartado sem derrubar os demais', async () => {
    const port = makeFakePort();
    await handleInstagramEchoes(
      [
        { nope: true },
        {
          provider: 'meta_instagram',
          igUserId: 'IG',
          contactRemoteId: 'C',
          externalId: 'm',
          messageType: 'text',
          content: 'x',
          rawTimestamp: '2026-09-24T12:00:00.000Z',
        },
      ],
      { deps: { persistence: port }, logger },
    );
    expect(port.igEcho).toHaveBeenCalledOnce();
    expect(port.igEcho.mock.calls[0]?.[0]).toMatchObject({ externalId: 'm' });
  });
});

describe('F70-S04 — ownMetaAppIdsFromEnv', () => {
  it('lê META_APP_ID (lista por vírgula, tolera espaços/vazio)', () => {
    expect([...ownMetaAppIdsFromEnv({ META_APP_ID: ' 1 , 2,,' })]).toEqual(['1', '2']);
    expect(ownMetaAppIdsFromEnv({}).size).toBe(0);
  });
});

describe('F70-S04 — MqCoexistenceSocketEmit', () => {
  function fakeChannel(): {
    sent: Array<{ queue: string; body: unknown }>;
    sendToQueue: (q: string, b: Buffer) => boolean;
  } {
    const sent: Array<{ queue: string; body: unknown }> = [];
    return {
      sent,
      sendToQueue(queue: string, body: Buffer) {
        sent.push({ queue, body: JSON.parse(body.toString('utf8')) as unknown });
        return true;
      },
    };
  }

  it('message:new do eco leva senderType=member; ai_mode_changed leva human_takeover', async () => {
    const ch = fakeChannel();
    const emit = new MqCoexistenceSocketEmit(
      ch as unknown as ConstructorParameters<typeof MqCoexistenceSocketEmit>[0],
    );
    await emit.emitMessageNew({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      messageId: 'msg-1',
      externalId: 'e-1',
      type: 'text',
      content: 'oi',
      direction: 'outbound',
      senderType: 'member',
    });
    await emit.emitAiModeChanged('ws-1', 'c-1', 'paused');

    expect(ch.sent).toHaveLength(2);
    expect(ch.sent[0]?.body).toMatchObject({
      payload: {
        event: 'message:new',
        data: { message: { senderType: 'member', origin: 'coexistence' } },
      },
    });
    expect(ch.sent[1]?.body).toMatchObject({
      payload: {
        event: 'conversation:ai_mode_changed',
        target: { conversationId: 'c-1', workspace: true },
        data: { conversationId: 'c-1', aiMode: 'paused', reason: 'human_takeover' },
      },
    });
  });
});
