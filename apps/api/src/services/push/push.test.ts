/**
 * F61-S03 — as decisões do envio de push que não podem regredir.
 *
 * O que este arquivo protege:
 *
 * 1. **Que um serviço de push fora do ar não apague a base de assinaturas** do
 *    cliente. Só o provedor dizendo "este endereço não existe" (404/410) justifica
 *    apagar; 5xx, timeout e 429 são ambíguos.
 * 2. **Que push mal configurado não derrube o produto.** Sem VAPID, o canal de
 *    aviso fica desligado e o resto funciona.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listForMember = vi.fn<() => Promise<unknown[]>>(() => Promise.resolve([]));

vi.mock('@hm/db', () => ({
  withWorkspace: (_ws: string, fn: (tx: unknown) => unknown) => fn({}),
  pushRepo: {
    listForMember,
    markUsed: vi.fn(() => Promise.resolve()),
    markFailure: vi.fn(() => Promise.resolve()),
    removeByEndpoint: vi.fn(() => Promise.resolve()),
  },
}));

const setVapidDetails = vi.fn();
vi.mock('web-push', () => ({
  default: { setVapidDetails, sendNotification: vi.fn(() => Promise.resolve()) },
  WebPushError: class extends Error {
    statusCode: number;
    constructor(msg: string, statusCode: number) {
      super(msg);
      this.statusCode = statusCode;
    }
  },
}));

const { isDeadEndpoint, isPushConfigured, notifyMember, publicKey, resetPushConfig } =
  await import('./index');

const ENV = { ...process.env };

beforeEach(() => {
  resetPushConfig();
  setVapidDetails.mockClear();
  listForMember.mockClear().mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...ENV };
});

describe('isDeadEndpoint — o que justifica apagar uma assinatura', () => {
  it('404 e 410 são a fonte da verdade: o endereço não existe', () => {
    expect(isDeadEndpoint(404)).toBe(true);
    expect(isDeadEndpoint(410)).toBe(true);
  });

  it('5xx NÃO apaga — provedor fora do ar não pode custar a base do cliente', () => {
    for (const s of [500, 502, 503, 504]) expect(isDeadEndpoint(s)).toBe(false);
  });

  it('429 (limite) NÃO apaga', () => {
    expect(isDeadEndpoint(429)).toBe(false);
  });

  it('erro sem status (rede, timeout) NÃO apaga', () => {
    expect(isDeadEndpoint(undefined)).toBe(false);
  });

  it('401/403 NÃO apagam — é a NOSSA credencial errada, não o aparelho do cliente', () => {
    // VAPID trocado sem migrar assinaturas apagaria a base inteira num deploy.
    expect(isDeadEndpoint(401)).toBe(false);
    expect(isDeadEndpoint(403)).toBe(false);
  });
});

describe('push sem VAPID configurado', () => {
  it('não configura nada e informa que está desligado', () => {
    delete process.env['VAPID_PUBLIC_KEY'];
    delete process.env['VAPID_PRIVATE_KEY'];
    expect(isPushConfigured()).toBe(false);
    expect(publicKey()).toBeNull();
    expect(setVapidDetails).not.toHaveBeenCalled();
  });

  it('notificar vira no-op silencioso — o produto não cai por causa do canal de aviso', async () => {
    delete process.env['VAPID_PUBLIC_KEY'];
    delete process.env['VAPID_PRIVATE_KEY'];
    const r = await notifyMember({ workspaceId: 'w', memberId: 'm' }, { title: 'Lead novo' });
    expect(r).toEqual({ enviados: 0, removidos: 0, falhas: 0 });
    // Nem chega a consultar o banco: sem canal, não há o que buscar.
    expect(listForMember).not.toHaveBeenCalled();
  });

  it('só a chave pública, sem a privada, continua desligado', () => {
    process.env['VAPID_PUBLIC_KEY'] = 'BLwv';
    delete process.env['VAPID_PRIVATE_KEY'];
    expect(isPushConfigured()).toBe(false);
  });
});

describe('push configurado', () => {
  beforeEach(() => {
    process.env['VAPID_PUBLIC_KEY'] = 'BLwvzi4kXuFXellV9hWJmXNaq687Rh0FAofND4UUAP3l';
    process.env['VAPID_PRIVATE_KEY'] = 'VbBQhFnyQw3q_OdnKs6jMQgraHZ-yGQZLPFDZshMWZI';
  });

  it('configura o VAPID uma vez e expõe a chave pública', () => {
    expect(isPushConfigured()).toBe(true);
    expect(publicKey()).toBe(process.env['VAPID_PUBLIC_KEY']);
  });

  it('membro sem aparelho não gera envio', async () => {
    const r = await notifyMember({ workspaceId: 'w', memberId: 'm' }, { title: 'Lead novo' });
    expect(r.enviados).toBe(0);
  });
});
