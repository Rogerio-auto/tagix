/**
 * Teste de verificação de assinatura HMAC do webhook Meta (F1-S02 DoD).
 *
 * Cobre o contrato de segurança crítico: assinatura válida passa, qualquer
 * adulteração (corpo, segredo, header ausente/malformado) falha. É puro (sem
 * DB/MQ) — roda sem infra.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './signature';

const APP_SECRET = 'test_app_secret_value';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

describe('verifyMetaSignature', () => {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('aceita assinatura válida (corpo + app_secret corretos)', () => {
    expect(verifyMetaSignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it('aceita assinatura válida quando o corpo é Buffer', () => {
    expect(verifyMetaSignature(Buffer.from(body, 'utf8'), sign(body), APP_SECRET)).toBe(true);
  });

  it('rejeita corpo adulterado (assinatura não bate)', () => {
    const tampered = body + ' ';
    expect(verifyMetaSignature(tampered, sign(body), APP_SECRET)).toBe(false);
  });

  it('rejeita assinatura gerada com outro segredo', () => {
    expect(verifyMetaSignature(body, sign(body, 'wrong_secret'), APP_SECRET)).toBe(false);
  });

  it('rejeita header ausente', () => {
    expect(verifyMetaSignature(body, undefined, APP_SECRET)).toBe(false);
  });

  it('rejeita header sem o prefixo sha256=', () => {
    const raw = createHmac('sha256', APP_SECRET).update(body).digest('hex');
    expect(verifyMetaSignature(body, raw, APP_SECRET)).toBe(false);
  });

  it('rejeita app_secret vazio', () => {
    expect(verifyMetaSignature(body, sign(body), '')).toBe(false);
  });

  it('rejeita hex malformado / tamanho divergente', () => {
    expect(verifyMetaSignature(body, 'sha256=deadbeef', APP_SECRET)).toBe(false);
  });
});
