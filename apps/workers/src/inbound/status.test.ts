/**
 * Testes de status (F1-S20 + F52-S04): progressão monotônica pura, buffer de
 * status órfão (callback antes do external_id) e wiring do handler.
 *
 * Sem DB/RabbitMQ: `handleStatusEvent` é testado com portas fake; `nextViewStatus`
 * é pura. A reconciliação do órfão (drain no worker outbound) é coberta em
 * `outbound/outbound.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  handleStatusEvent,
  nextViewStatus,
  type InboundStatusEvent,
  type StatusDeps,
} from './status';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(function (this: unknown) {
    return logger;
  }),
};

function statusEvent(
  status: InboundStatusEvent['status'],
  externalId = 'wamid.X',
): InboundStatusEvent {
  return { type: 'status', provider: 'meta_whatsapp', externalId, status, rawTimestamp: '2026-06-27T12:00:00.000Z' };
}

function makeDeps(over: Partial<StatusDeps> = {}): StatusDeps {
  return {
    channels: { resolve: vi.fn(async () => ({ workspaceId: 'ws1' })) },
    persistence: { applyStatus: vi.fn(async () => ({ outcome: 'not_found' as const })) },
    socket: { emitStatusChanged: vi.fn(async () => undefined) },
    orphan: { record: vi.fn(async () => undefined), drain: vi.fn(async () => null) },
    ...over,
  };
}

describe('nextViewStatus — progressão monotônica', () => {
  it('avança pending → sent → delivered → read', () => {
    expect(nextViewStatus('pending', 'sent')).toBe('sent');
    expect(nextViewStatus('sent', 'delivered')).toBe('delivered');
    expect(nextViewStatus('delivered', 'read')).toBe('read');
  });

  it('NÃO regride: read antes de delivered fica em read (fora de ordem)', () => {
    // read já aplicado; chega delivered (rank menor) → no-op.
    expect(nextViewStatus('read', 'delivered')).toBeNull();
  });

  it('idempotente: mesmo status não reaplica', () => {
    expect(nextViewStatus('sent', 'sent')).toBeNull();
  });

  it('failed vence (terminal) sobre qualquer status anterior', () => {
    expect(nextViewStatus('read', 'failed')).toBe('failed');
    expect(nextViewStatus('pending', 'failed')).toBe('failed');
  });

  it('`sending` é tratado como pending (qualquer ack avança)', () => {
    expect(nextViewStatus('sending', 'sent')).toBe('sent');
  });

  it('mensagem deletada nunca ressuscita', () => {
    expect(nextViewStatus('deleted', 'read')).toBeNull();
    expect(nextViewStatus('desconhecido', 'sent')).toBeNull();
  });
});

describe('handleStatusEvent — buffer de órfão (F52-S04)', () => {
  it('callback antes do external_id → bufferiza o órfão (não descarta)', async () => {
    const deps = makeDeps({
      persistence: { applyStatus: vi.fn(async () => ({ outcome: 'not_found' as const })) },
    });

    const res = await handleStatusEvent(
      { provider: 'meta_whatsapp', routing: { phoneNumberId: 'pn1' }, event: statusEvent('delivered') },
      deps,
      logger,
    );

    expect(res.outcome).toBe('buffered');
    expect(deps.orphan.record).toHaveBeenCalledOnce();
    expect(deps.orphan.record).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'wamid.X', status: 'delivered' }),
    );
    // Sem mensagem ainda → nada a emitir no socket.
    expect(deps.socket.emitStatusChanged).not.toHaveBeenCalled();
  });

  it('avanço normal → atualiza + emite socket, sem bufferizar', async () => {
    const deps = makeDeps({
      persistence: {
        applyStatus: vi.fn(async () => ({
          outcome: 'applied' as const,
          target: { messageId: 'm1', conversationId: 'cv1', previousStatus: 'sent' },
        })),
      },
    });

    const res = await handleStatusEvent(
      { provider: 'meta_whatsapp', routing: { phoneNumberId: 'pn1' }, event: statusEvent('read') },
      deps,
      logger,
    );

    expect(res.outcome).toBe('updated');
    expect(deps.socket.emitStatusChanged).toHaveBeenCalledOnce();
    expect(deps.socket.emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'cv1', messageId: 'm1', status: 'read' }),
    );
    expect(deps.orphan.record).not.toHaveBeenCalled();
  });

  it('sem avanço (monotônico) → skip, sem bufferizar nem emitir', async () => {
    const deps = makeDeps({
      persistence: { applyStatus: vi.fn(async () => ({ outcome: 'no_advance' as const })) },
    });

    const res = await handleStatusEvent(
      { provider: 'meta_whatsapp', routing: { phoneNumberId: 'pn1' }, event: statusEvent('delivered') },
      deps,
      logger,
    );

    expect(res.outcome).toBe('skipped');
    expect(deps.orphan.record).not.toHaveBeenCalled();
    expect(deps.socket.emitStatusChanged).not.toHaveBeenCalled();
  });

  it('canal não resolvido → skip (não bufferiza)', async () => {
    const deps = makeDeps({ channels: { resolve: vi.fn(async () => null) } });

    const res = await handleStatusEvent(
      { provider: 'meta_whatsapp', routing: {}, event: statusEvent('delivered') },
      deps,
      logger,
    );

    expect(res.outcome).toBe('skipped');
    expect(deps.orphan.record).not.toHaveBeenCalled();
  });
});
