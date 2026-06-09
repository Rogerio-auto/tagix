import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto';

beforeAll(() => {
  // chave de teste (32 bytes hex) — independente do .env
  process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('hex');
});

describe('crypto AES-256-GCM', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const secret = 'sk-meta-token-super-secreto-123';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('ciphertext difere a cada chamada (IV aleatório)', () => {
    expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
  });

  it('payload adulterado falha a autenticação', () => {
    const enc = encryptSecret('hello');
    const [iv, tag] = enc.split(':');
    const tampered = `${iv}:${tag}:${Buffer.from('outra-coisa').toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
