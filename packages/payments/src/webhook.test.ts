import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from './webhook';

const SECRET = 'whsec_test_platform_secret';
const BODY = JSON.stringify({ event: 'checkout.completed', data: { id: 'evt_1' } });

function signHex(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}
function signBase64(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

describe('verifyWebhookSignature', () => {
  it('aceita assinatura hex válida (string)', () => {
    expect(verifyWebhookSignature(BODY, signHex(BODY, SECRET), SECRET)).toBe(true);
  });

  it('aceita assinatura hex válida (Buffer)', () => {
    const buf = Buffer.from(BODY, 'utf8');
    expect(verifyWebhookSignature(buf, signHex(BODY, SECRET), SECRET)).toBe(true);
  });

  it('aceita assinatura com prefixo sha256=', () => {
    expect(verifyWebhookSignature(BODY, `sha256=${signHex(BODY, SECRET)}`, SECRET)).toBe(true);
  });

  it('aceita assinatura em base64', () => {
    expect(verifyWebhookSignature(BODY, signBase64(BODY, SECRET), SECRET)).toBe(true);
  });

  it('rejeita assinatura ausente (undefined)', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
  });

  it('rejeita assinatura ausente (null/empty)', () => {
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyWebhookSignature(BODY, 'sha256=', SECRET)).toBe(false);
  });

  it('rejeita secret ausente', () => {
    expect(verifyWebhookSignature(BODY, signHex(BODY, SECRET), '')).toBe(false);
    expect(verifyWebhookSignature(BODY, signHex(BODY, SECRET), undefined)).toBe(false);
  });

  it('rejeita mismatch (secret errado)', () => {
    expect(verifyWebhookSignature(BODY, signHex(BODY, 'wrong_secret'), SECRET)).toBe(false);
  });

  it('rejeita mismatch (corpo adulterado)', () => {
    const sig = signHex(BODY, SECRET);
    const tampered = JSON.stringify({ event: 'checkout.completed', data: { id: 'evt_TAMPERED' } });
    expect(verifyWebhookSignature(tampered, sig, SECRET)).toBe(false);
  });

  it('rejeita assinatura de tamanho diferente sem lançar', () => {
    expect(verifyWebhookSignature(BODY, 'deadbeef', SECRET)).toBe(false);
  });

  it('rejeita assinatura com caracteres inválidos', () => {
    const len = signHex(BODY, SECRET).length;
    expect(verifyWebhookSignature(BODY, 'z'.repeat(len), SECRET)).toBe(false);
  });
});
