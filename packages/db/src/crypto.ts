/**
 * Cifra de segredos de canal — AES-256-GCM com versionamento de key (DATA_MODEL §6.2).
 * Formato do payload: base64(iv):base64(tag):base64(ciphertext).
 */
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/** Resolve a chave por versão. MVP: chave única de `ENCRYPTION_KEY` (hex de 32 bytes). */
function getKey(_keyVersion: number): Buffer {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex) throw new Error('Variável de ambiente obrigatória ausente: ENCRYPTION_KEY');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter 32 bytes (64 caracteres hex).');
  }
  return key;
}

export function encryptSecret(plaintext: string, keyVersion = 1): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(keyVersion), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string, keyVersion = 1): string {
  const parts = payload.split(':');
  const [ivB, tagB, encB] = parts;
  if (parts.length !== 3 || !ivB || !tagB || !encB) {
    throw new Error('Payload cifrado inválido.');
  }
  const decipher = createDecipheriv(ALGO, getKey(keyVersion), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encB, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
