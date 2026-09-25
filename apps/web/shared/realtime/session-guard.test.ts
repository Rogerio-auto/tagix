/**
 * F70-S28 — socket com handshake recusado. Log de produção de 25/09:
 * `socket: handshake unauthorized` com `hasSessionCookie: true` e o app parado, sem
 * ir ao login. O guard decide: sessão morta → login uma vez, sem reconectar;
 * recusa temporária → tenta de novo com backoff; erro de transporte → socket.io.
 */
import { describe, expect, it, vi } from 'vitest';
import { attachSessionGuard, retryDelayMs, type GuardedSocket } from './session-guard';

type Listener = (...args: unknown[]) => void;

/** Socket fake: emite eventos como o socket.io-client e conta connect/disconnect. */
function fakeSocket(active = false) {
  const listeners = new Map<string, Set<Listener>>();
  const state = { active, connects: 0, disconnects: 0 };
  const socket = {
    get active() {
      return state.active;
    },
    connect: vi.fn(() => {
      state.connects += 1;
    }),
    disconnect: vi.fn(() => {
      state.disconnects += 1;
      state.active = false;
    }),
    on: vi.fn((event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(fn);
    }),
    off: vi.fn((event: string, fn: Listener) => {
      listeners.get(event)?.delete(fn);
    }),
  };
  const emit = (event: string, ...args: unknown[]): void => {
    for (const fn of listeners.get(event) ?? []) fn(...args);
  };
  return { socket: socket as unknown as GuardedSocket, state, emit, listeners };
}

/** Agenda manual: guarda as tarefas para o teste rodar quando quiser. */
function manualSchedule() {
  const tasks: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = (fn: () => void, ms: number) => {
    const task = { fn, ms, cancelled: false };
    tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  const runAll = (): void => {
    for (const t of tasks.splice(0)) if (!t.cancelled) t.fn();
  };
  return { schedule, tasks, runAll };
}

describe('attachSessionGuard', () => {
  it('handshake `unauthorized` → derruba o socket e chama o login UMA vez, sem reconectar', () => {
    const { socket, state, emit } = fakeSocket(false);
    const onSessionExpired = vi.fn();
    const sched = manualSchedule();
    attachSessionGuard(socket, { onSessionExpired, schedule: sched.schedule });

    emit('connect_error', new Error('unauthorized'));
    emit('connect_error', new Error('unauthorized'));
    emit('connect_error', new Error('auth_unavailable'));
    sched.runAll();

    expect(onSessionExpired).toHaveBeenCalledOnce();
    expect(state.disconnects).toBe(1);
    expect(state.connects).toBe(0);
    expect(sched.tasks).toHaveLength(0);
  });

  it('recusa temporária (`auth_unavailable`) → nova tentativa com backoff crescente, sem login', () => {
    const { socket, state, emit } = fakeSocket(false);
    const onSessionExpired = vi.fn();
    const sched = manualSchedule();
    attachSessionGuard(socket, { onSessionExpired, schedule: sched.schedule });

    emit('connect_error', new Error('auth_unavailable'));
    expect(sched.tasks[0]?.ms).toBe(2_000);
    sched.runAll();
    expect(state.connects).toBe(1);

    emit('connect_error', new Error('auth_unavailable'));
    expect(sched.tasks[0]?.ms).toBe(4_000);
    sched.runAll();
    expect(state.connects).toBe(2);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('conectou → backoff volta ao início', () => {
    const { socket, emit } = fakeSocket(false);
    const sched = manualSchedule();
    attachSessionGuard(socket, { onSessionExpired: vi.fn(), schedule: sched.schedule });

    emit('connect_error', new Error('auth_unavailable'));
    sched.runAll();
    emit('connect_error', new Error('auth_unavailable'));
    sched.runAll();
    emit('connect');
    emit('connect_error', new Error('auth_unavailable'));
    expect(sched.tasks[0]?.ms).toBe(2_000);
  });

  it('erro de transporte (socket ainda `active`) → não agenda nada: o socket.io reconecta', () => {
    const { socket, emit } = fakeSocket(true);
    const sched = manualSchedule();
    attachSessionGuard(socket, { onSessionExpired: vi.fn(), schedule: sched.schedule });

    emit('connect_error', new Error('xhr poll error'));
    expect(sched.tasks).toHaveLength(0);
  });

  it('não empilha tentativas: várias recusas antes da espera → uma tentativa só', () => {
    const { socket, emit } = fakeSocket(false);
    const sched = manualSchedule();
    attachSessionGuard(socket, { onSessionExpired: vi.fn(), schedule: sched.schedule });

    emit('connect_error', new Error('auth_unavailable'));
    emit('connect_error', new Error('auth_unavailable'));
    expect(sched.tasks).toHaveLength(1);
  });

  it('dispose remove os listeners e cancela a tentativa pendente', () => {
    const { socket, state, emit, listeners } = fakeSocket(false);
    const sched = manualSchedule();
    const dispose = attachSessionGuard(socket, {
      onSessionExpired: vi.fn(),
      schedule: sched.schedule,
    });

    emit('connect_error', new Error('auth_unavailable'));
    dispose();
    sched.runAll();

    expect(state.connects).toBe(0);
    expect(listeners.get('connect_error')?.size ?? 0).toBe(0);
  });
});

describe('retryDelayMs', () => {
  it('2s, 4s, 8s… com teto de 60s', () => {
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(retryDelayMs(20)).toBe(60_000);
  });
});
