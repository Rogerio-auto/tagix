/**
 * F70-S19/S20 — signer único e verificador de referência dos webhooks de saída.
 * O verificador é contrato público (clientes copiam): formato estrito, janela para os
 * dois lados e HMAC de `${timestamp}.${corpo}` em tempo constante.
 */
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SIGNATURE_HEADER,
  signatureHeaders,
  signWebhook,
  TIMESTAMP_HEADER,
  unixSeconds,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from './webhook-signature';

const SECRET = 'segredo-de-teste-0123456789';
const BODY = '{"messageId":"m1","_meta":{"eventId":"m1:received","event":"message.received"}}';
const AT = new Date('2026-09-25T12:00:00.000Z');

function signed(at: Date = AT, body: string = BODY) {
  const h = signatureHeaders(SECRET, body, at);
  return { signature: h[SIGNATURE_HEADER], timestamp: h[TIMESTAMP_HEADER] };
}

describe('signatureHeaders / signWebhook', () => {
  it('assina `${timestamp}.${corpo}` com HMAC-SHA256 (vetor independente)', () => {
    const ts = unixSeconds(AT);
    const expected = createHmac('sha256', SECRET).update(`${ts}.${BODY}`).digest('hex');
    expect(signatureHeaders(SECRET, BODY, AT)).toEqual({
      [TIMESTAMP_HEADER]: String(ts),
      [SIGNATURE_HEADER]: `sha256=${expected}`,
    });
  });

  it('timestamp inválido lança (defeito de quem assina)', () => {
    expect(() => signWebhook(SECRET, -1, BODY)).toThrow(RangeError);
    expect(() => signWebhook(SECRET, 1.5, BODY)).toThrow(RangeError);
  });
});

describe('verifyWebhookSignature', () => {
  it('aceita a entrega dentro da janela, com corpo string ou Buffer cru', () => {
    const { signature, timestamp } = signed();
    const ts = unixSeconds(AT);
    expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signature, timestamp, now: AT })).toEqual(
      { ok: true, timestamp: ts },
    );
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        body: Buffer.from(BODY, 'utf8'),
        signature,
        timestamp,
        now: new Date(AT.getTime() + WEBHOOK_TOLERANCE_SECONDS * 1000),
      }).ok,
    ).toBe(true);
  });

  it('timestamp adulterado → mismatch (o ts está dentro da assinatura)', () => {
    const { signature, timestamp } = signed();
    const forged = String(Number(timestamp) + 1);
    expect(
      verifyWebhookSignature({ secret: SECRET, body: BODY, signature, timestamp: forged, now: AT }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('corpo ou segredo diferente → mismatch', () => {
    const { signature, timestamp } = signed();
    expect(
      verifyWebhookSignature({ secret: SECRET, body: `${BODY} `, signature, timestamp, now: AT }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    expect(
      verifyWebhookSignature({ secret: `${SECRET}!`, body: BODY, signature, timestamp, now: AT }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('fora da janela, para o passado e para o futuro → outside_tolerance', () => {
    const { signature, timestamp } = signed();
    const drift = (WEBHOOK_TOLERANCE_SECONDS + 1) * 1000;
    for (const now of [new Date(AT.getTime() + drift), new Date(AT.getTime() - drift)]) {
      expect(verifyWebhookSignature({ secret: SECRET, body: BODY, signature, timestamp, now })).toEqual(
        { ok: false, reason: 'outside_tolerance' },
      );
    }
  });

  it('headers ausentes ou malformados', () => {
    const { signature, timestamp } = signed();
    const base = { secret: SECRET, body: BODY, now: AT };
    expect(verifyWebhookSignature({ ...base, signature: undefined, timestamp })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
    expect(verifyWebhookSignature({ ...base, signature, timestamp: '' })).toEqual({
      ok: false,
      reason: 'missing_header',
    });
    for (const bad of ['sha1=abc', signature.toUpperCase(), `${signature}0`]) {
      expect(verifyWebhookSignature({ ...base, signature: bad, timestamp })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
    for (const bad of ['-1', '1.5', ' 1', '1e9', '1234567890123']) {
      expect(verifyWebhookSignature({ ...base, signature, timestamp: bad })).toEqual({
        ok: false,
        reason: 'malformed',
      });
    }
  });
});
