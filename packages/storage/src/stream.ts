import { Buffer } from 'node:buffer';
import type { PutObjectInput } from './types';

/** Normaliza o body (Uint8Array ou ReadableStream) para um buffer. */
export async function toBuffer(body: PutObjectInput['body']): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value as Uint8Array);
  }
  return Buffer.concat(chunks);
}
