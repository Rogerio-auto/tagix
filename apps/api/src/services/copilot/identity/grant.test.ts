/**
 * F73-S03 — grant HMAC do turno (ADR-003 §2): ida e volta, adulteração em cada segmento,
 * expiração, versão desconhecida e segredo diferente. Puro (sem banco).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COPILOT_GRANT_TTL_SECONDS,
  generateGrantNonce,
  mintGrant,
  signRawGrant,
  verifyGrant,
} from './grant';

const secret = randomBytes(32);
const now = new Date('2026-10-17T12:00:00.000Z');
const input = {
  turnId: randomUUID(),
  workspaceId: randomUUID(),
  memberId: randomUUID(),
  nonce: generateGrantNonce(),
};

/** Troca um caractere por outro do alfabeto base64url, garantidamente diferente. */
function flipChar(segment: string, index: number): string {
  const c = segment[index] ?? 'A';
  const replacement = c === 'A' ? 'B' : 'A';
  return `${segment.slice(0, index)}${replacement}${segment.slice(index + 1)}`;
}

describe('mintGrant / verifyGrant', () => {
  it('ida e volta: o payload sai igual ao que entrou', () => {
    const token = mintGrant(input, { secret, now });
    const result = verifyGrant(token, { secret, now });
    expect(result).toEqual({
      ok: true,
      payload: {
        v: 1,
        tid: input.turnId,
        ws: input.workspaceId,
        mid: input.memberId,
        exp: Math.floor(now.getTime() / 1000) + COPILOT_GRANT_TTL_SECONDS,
        nonce: input.nonce,
      },
    });
  });

  it('payload adulterado (qualquer posição) → grant_bad_signature', () => {
    const token = mintGrant(input, { secret, now });
    const [payload = '', signature = ''] = token.split('.');
    for (const i of [0, Math.floor(payload.length / 2), payload.length - 1]) {
      expect(verifyGrant(`${flipChar(payload, i)}.${signature}`, { secret, now })).toEqual({
        ok: false,
        reason: 'grant_bad_signature',
      });
    }
  });

  it('payload trocado por outro bem formado (outro membro) → grant_bad_signature', () => {
    const token = mintGrant(input, { secret, now });
    const signature = token.split('.')[1] ?? '';
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        tid: input.turnId,
        ws: input.workspaceId,
        mid: randomUUID(),
        exp: Math.floor(now.getTime() / 1000) + 60,
        nonce: input.nonce,
      }),
    ).toString('base64url');
    expect(verifyGrant(`${forged}.${signature}`, { secret, now })).toMatchObject({
      reason: 'grant_bad_signature',
    });
  });

  it('assinatura adulterada, truncada ou em grafia não canônica → grant_bad_signature', () => {
    const token = mintGrant(input, { secret, now });
    const [payload = '', signature = ''] = token.split('.');
    for (const i of [0, Math.floor(signature.length / 2), signature.length - 1]) {
      expect(verifyGrant(`${payload}.${flipChar(signature, i)}`, { secret, now })).toMatchObject({
        reason: 'grant_bad_signature',
      });
    }
    expect(verifyGrant(`${payload}.${signature.slice(0, -2)}`, { secret, now })).toMatchObject({
      reason: 'grant_bad_signature',
    });
  });

  it('estrutura inválida → grant_malformed', () => {
    const token = mintGrant(input, { secret, now });
    const cases: unknown[] = [
      undefined,
      '',
      'semponto',
      `${token}.extra`,
      `.${token.split('.')[1] ?? ''}`,
      `${token.split('.')[0] ?? ''}.`,
      'a+b.c/d',
      'x'.repeat(5000),
      42,
    ];
    for (const c of cases) {
      expect(verifyGrant(c, { secret, now })).toEqual({ ok: false, reason: 'grant_malformed' });
    }
  });

  it('assinado, mas com payload fora do formato v1 → grant_malformed', () => {
    const extra = signRawGrant(
      {
        v: 1,
        tid: input.turnId,
        ws: input.workspaceId,
        mid: input.memberId,
        exp: 9e9,
        nonce: input.nonce,
        role: 'OWNER',
      },
      secret,
    );
    expect(verifyGrant(extra, { secret, now })).toMatchObject({ reason: 'grant_malformed' });
    const body = Buffer.from('{nope').toString('base64url');
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
    expect(verifyGrant(`${body}.${sig}`, { secret, now })).toMatchObject({
      reason: 'grant_malformed',
    });
  });

  it('exp vencido (ou exatamente agora) → grant_expired', () => {
    const token = mintGrant({ ...input, ttlSeconds: 30 }, { secret, now });
    expect(verifyGrant(token, { secret, now: new Date(now.getTime() + 29_000) }).ok).toBe(true);
    expect(verifyGrant(token, { secret, now: new Date(now.getTime() + 30_000) })).toEqual({
      ok: false,
      reason: 'grant_expired',
    });
    expect(verifyGrant(token, { secret, now: new Date(now.getTime() + 3_600_000) })).toMatchObject({
      reason: 'grant_expired',
    });
  });

  it('versão desconhecida (assinada corretamente) → grant_unsupported_version', () => {
    for (const v of [2, 0, '1', null]) {
      const token = signRawGrant(
        {
          v,
          tid: input.turnId,
          ws: input.workspaceId,
          mid: input.memberId,
          exp: 9e9,
          nonce: input.nonce,
        },
        secret,
      );
      expect(verifyGrant(token, { secret, now })).toEqual({
        ok: false,
        reason: 'grant_unsupported_version',
      });
    }
  });

  it('segredo diferente → grant_bad_signature (versão e exp nem são lidos)', () => {
    const token = mintGrant(input, { secret, now });
    expect(verifyGrant(token, { secret: randomBytes(32), now })).toEqual({
      ok: false,
      reason: 'grant_bad_signature',
    });
    const v2 = signRawGrant({ v: 2 }, randomBytes(32));
    expect(verifyGrant(v2, { secret, now })).toMatchObject({ reason: 'grant_bad_signature' });
  });

  it('mintGrant recusa ttl fora de 1..120 e entrada inválida', () => {
    expect(() => mintGrant({ ...input, ttlSeconds: 121 }, { secret, now })).toThrow(RangeError);
    expect(() => mintGrant({ ...input, ttlSeconds: 0 }, { secret, now })).toThrow(RangeError);
    expect(() => mintGrant({ ...input, memberId: 'nao-uuid' }, { secret, now })).toThrow();
    expect(() => mintGrant({ ...input, nonce: 'curto' }, { secret, now })).toThrow();
  });

  it('generateGrantNonce cabe no check do banco (16..128) e não repete', () => {
    const a = generateGrantNonce();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).not.toBe(generateGrantNonce());
  });
});
