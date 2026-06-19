import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSecret, verifyWebhookSignature } from './webhook';

const SECRET = 'whsec_test_platform_secret';
const PUBLIC_KEY = 'abacate_public_key_test';
const BODY = JSON.stringify({ event: 'checkout.completed', data: { id: 'evt_1' } });

function signBase64(body: string, key: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('base64');
}
function signHex(body: string, key: string): string {
  return createHmac('sha256', key).update(body, 'utf8').digest('hex');
}

describe('verifyWebhookSecret (auth primária — query param)', () => {
  it('aceita secret idêntico', () => {
    expect(verifyWebhookSecret(SECRET, SECRET)).toBe(true);
  });
  it('rejeita secret ausente (provided)', () => {
    expect(verifyWebhookSecret(undefined, SECRET)).toBe(false);
    expect(verifyWebhookSecret(null, SECRET)).toBe(false);
    expect(verifyWebhookSecret('', SECRET)).toBe(false);
  });
  it('rejeita expected ausente', () => {
    expect(verifyWebhookSecret(SECRET, undefined)).toBe(false);
    expect(verifyWebhookSecret(SECRET, '')).toBe(false);
  });
  it('rejeita mismatch', () => {
    expect(verifyWebhookSecret('wrong', SECRET)).toBe(false);
  });
  it('rejeita prefixo/sufixo (sem lançar em tamanhos diferentes)', () => {
    expect(verifyWebhookSecret(SECRET + 'x', SECRET)).toBe(false);
    expect(verifyWebhookSecret(SECRET.slice(0, -1), SECRET)).toBe(false);
  });
});

describe('verifyWebhookSignature (camada extra — HMAC com chave pública)', () => {
  it('aceita assinatura base64 válida (string)', () => {
    expect(verifyWebhookSignature(BODY, signBase64(BODY, PUBLIC_KEY), PUBLIC_KEY)).toBe(true);
  });

  it('aceita assinatura base64 válida (Buffer)', () => {
    const buf = Buffer.from(BODY, 'utf8');
    expect(verifyWebhookSignature(buf, signBase64(BODY, PUBLIC_KEY), PUBLIC_KEY)).toBe(true);
  });

  it('aceita assinatura com prefixo sha256=', () => {
    expect(verifyWebhookSignature(BODY, `sha256=${signBase64(BODY, PUBLIC_KEY)}`, PUBLIC_KEY)).toBe(
      true,
    );
  });

  it('aceita assinatura em hex (defensivo)', () => {
    expect(verifyWebhookSignature(BODY, signHex(BODY, PUBLIC_KEY), PUBLIC_KEY)).toBe(true);
  });

  it('rejeita assinatura ausente (undefined/null/empty)', () => {
    expect(verifyWebhookSignature(BODY, undefined, PUBLIC_KEY)).toBe(false);
    expect(verifyWebhookSignature(BODY, null, PUBLIC_KEY)).toBe(false);
    expect(verifyWebhookSignature(BODY, '', PUBLIC_KEY)).toBe(false);
    expect(verifyWebhookSignature(BODY, 'sha256=', PUBLIC_KEY)).toBe(false);
  });

  it('rejeita chave pública ausente', () => {
    expect(verifyWebhookSignature(BODY, signBase64(BODY, PUBLIC_KEY), '')).toBe(false);
    expect(verifyWebhookSignature(BODY, signBase64(BODY, PUBLIC_KEY), undefined)).toBe(false);
  });

  it('rejeita mismatch (chave errada)', () => {
    expect(verifyWebhookSignature(BODY, signBase64(BODY, 'wrong_key'), PUBLIC_KEY)).toBe(false);
  });

  it('rejeita mismatch (corpo adulterado)', () => {
    const sig = signBase64(BODY, PUBLIC_KEY);
    const tampered = JSON.stringify({ event: 'checkout.completed', data: { id: 'evt_TAMPERED' } });
    expect(verifyWebhookSignature(tampered, sig, PUBLIC_KEY)).toBe(false);
  });

  it('rejeita assinatura de tamanho diferente sem lançar', () => {
    expect(verifyWebhookSignature(BODY, 'deadbeef', PUBLIC_KEY)).toBe(false);
  });
});
