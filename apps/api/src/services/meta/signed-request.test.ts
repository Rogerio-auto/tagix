/**
 * F69-S01 — o `signed_request` é a única coisa que separa um pedido legítimo da
 * Meta de alguém tentando apagar os dados de um usuário alheio.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignedRequest } from './signed-request';

const SEGREDO = 'segredo-do-app-de-teste';

/** Monta um `signed_request` como a Meta monta. */
function assinar(payload: unknown, segredo = SEGREDO): string {
  const codificado = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const assinatura = createHmac('sha256', segredo).update(codificado).digest('base64url');
  return `${assinatura}.${codificado}`;
}

const valido = { algorithm: 'HMAC-SHA256', user_id: '1234567890', issued_at: 1_790_000_000 };

describe('verifySignedRequest', () => {
  it('aceita um pedido assinado corretamente', () => {
    const r = verifySignedRequest(assinar(valido), SEGREDO);
    expect(r).toEqual({ ok: true, payload: { userId: '1234567890', issuedAt: 1_790_000_000 } });
  });

  it('recusa assinatura feita com outro segredo', () => {
    // É exatamente o ataque: alguém sem o App Secret forjando o pedido.
    const r = verifySignedRequest(assinar(valido, 'outro-segredo'), SEGREDO);
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('recusa payload adulterado depois de assinado', () => {
    const [assinatura] = assinar(valido).split('.');
    const trocado = Buffer.from(JSON.stringify({ ...valido, user_id: 'vitima' })).toString(
      'base64url',
    );
    expect(verifySignedRequest(`${assinatura}.${trocado}`, SEGREDO)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('recusa algoritmo diferente mesmo com assinatura válida', () => {
    const r = verifySignedRequest(assinar({ ...valido, algorithm: 'none' }), SEGREDO);
    expect(r).toEqual({ ok: false, reason: 'bad_algorithm' });
  });

  it('aceita o nome do algoritmo em qualquer caixa', () => {
    const r = verifySignedRequest(assinar({ ...valido, algorithm: 'hmac-sha256' }), SEGREDO);
    expect(r.ok).toBe(true);
  });

  it('recusa payload sem user_id', () => {
    const r = verifySignedRequest(assinar({ algorithm: 'HMAC-SHA256' }), SEGREDO);
    expect(r).toEqual({ ok: false, reason: 'missing_user' });
  });

  it('formato quebrado não lança', () => {
    for (const lixo of ['', 'semponto', 'a.b.c', '!!!.???', `${'a'.repeat(10)}.`]) {
      const r = verifySignedRequest(lixo, SEGREDO);
      expect(r.ok).toBe(false);
    }
  });

  it('JSON ilegível com assinatura válida é malformado, não exceção', () => {
    const codificado = Buffer.from('isto nao e json').toString('base64url');
    const assinatura = createHmac('sha256', SEGREDO).update(codificado).digest('base64url');
    expect(verifySignedRequest(`${assinatura}.${codificado}`, SEGREDO)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('sem App Secret configurado, recusa tudo — nunca aceita por omissão', () => {
    expect(verifySignedRequest(assinar(valido), '')).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });
});
