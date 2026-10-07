/** F71 (F-03) — revalidação periódica da sessão do socket (fakes, sem rede). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext, SessionResolution } from '../auth';
import {
  checkSocketSession,
  SOCKET_REVALIDATE_INTERVAL_MS,
  startSocketRevalidation,
} from './revalidate';
import { disconnectMemberSockets, setMemberDisconnector } from './member-disconnect';

const sessionOf = (memberId: string): SessionContext =>
  ({ member: { id: memberId }, workspace: { id: 'ws1' } }) as unknown as SessionContext;

const ok = (memberId: string): SessionResolution => ({ kind: 'ok', session: sessionOf(memberId) });

describe('checkSocketSession', () => {
  const session = sessionOf('m1');
  it('mesmo membro -> valid', async () => {
    expect(await checkSocketSession(session, 'c', async () => ok('m1'))).toBe('valid');
  });
  it('outro membro (empresa do handshake perdida) -> revoked', async () => {
    expect(await checkSocketSession(session, 'c', async () => ok('m2'))).toBe('revoked');
  });
  it('invalid (sem membership ativa / token morto) -> revoked', async () => {
    expect(await checkSocketSession(session, 'c', async () => ({ kind: 'invalid' }))).toBe(
      'revoked',
    );
  });
  it('unavailable ou exceção -> unavailable (não derruba)', async () => {
    expect(await checkSocketSession(session, 'c', async () => ({ kind: 'unavailable' }))).toBe(
      'unavailable',
    );
    expect(
      await checkSocketSession(session, 'c', async () => {
        throw new Error('db off');
      }),
    ).toBe('unavailable');
  });
  it('repassa o cookie do handshake ao resolver', async () => {
    const resolve = vi.fn(async () => ok('m1'));
    await checkSocketSession(session, 'hm_session=t; hm_workspace=w', resolve);
    expect(resolve).toHaveBeenCalledWith('hm_session=t; hm_workspace=w');
  });
});

describe('startSocketRevalidation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeSocket() {
    let onDisconnect: (() => void) | undefined;
    return {
      disconnect: vi.fn(),
      on: vi.fn((_e: 'disconnect', l: () => void) => {
        onDisconnect = l;
      }),
      fireDisconnect: () => onDisconnect?.(),
    };
  }

  it('derruba o socket quando a membership deixa de valer', async () => {
    const socket = fakeSocket();
    const resolve = vi.fn<() => Promise<SessionResolution>>(async () => ok('m1'));
    const onRevoked = vi.fn();
    startSocketRevalidation(socket, {
      session: sessionOf('m1'),
      cookieHeader: 'c',
      resolve,
      onRevoked,
    });

    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);
    expect(socket.disconnect).not.toHaveBeenCalled();

    resolve.mockResolvedValue({ kind: 'invalid' });
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(onRevoked).toHaveBeenCalledOnce();

    // parou: não revalida mais.
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS * 3);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('indisponibilidade não derruba e o timer segue', async () => {
    const socket = fakeSocket();
    const resolve = vi.fn<() => Promise<SessionResolution>>(async () => ({ kind: 'unavailable' }));
    startSocketRevalidation(socket, { session: sessionOf('m1'), cookieHeader: 'c', resolve });
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS * 2);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('limpa o timer no disconnect', async () => {
    const socket = fakeSocket();
    const resolve = vi.fn<() => Promise<SessionResolution>>(async () => ok('m1'));
    startSocketRevalidation(socket, { session: sessionOf('m1'), cookieHeader: 'c', resolve });
    socket.fireDisconnect();
    await vi.advanceTimersByTimeAsync(SOCKET_REVALIDATE_INTERVAL_MS * 3);
    expect(resolve).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('disconnectMemberSockets', () => {
  afterEach(() => setMemberDisconnector(null));
  it('é no-op sem desconector registrado', async () => {
    await expect(disconnectMemberSockets('m1')).resolves.toBeUndefined();
  });
  it('chama o desconector e engole falhas', async () => {
    const fn = vi.fn(async () => {
      throw new Error('redis');
    });
    setMemberDisconnector(fn);
    await expect(disconnectMemberSockets('m1')).resolves.toBeUndefined();
    expect(fn).toHaveBeenCalledWith('m1');
  });
});
