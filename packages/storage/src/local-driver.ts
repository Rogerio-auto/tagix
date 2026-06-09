import { createHmac } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IStorageDriver, PutObjectInput, SignedUrl } from './types';
import { toBuffer } from './stream';

export interface LocalDriverOptions {
  /** Diretório base no disco (ex.: ./tmp/storage). */
  basePath: string;
  /** Base pública para as signed URLs (ex.: rota /media da API). */
  publicBaseUrl?: string;
  /** Segredo do HMAC que assina as URLs. */
  signingSecret?: string;
}

/** Driver de dev: grava no filesystem; signed URL = link com HMAC + expiração. */
export class LocalDriver implements IStorageDriver {
  constructor(private readonly opts: LocalDriverOptions) {}

  private filePath(key: string): string {
    return path.join(this.opts.basePath, key);
  }

  async put(input: PutObjectInput): Promise<void> {
    const fp = this.filePath(input.key);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, await toBuffer(input.body));
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const secret = this.opts.signingSecret ?? 'dev-signing-secret';
    const sig = createHmac('sha256', secret).update(`${key}:${exp}`).digest('hex');
    const base = this.opts.publicBaseUrl ?? 'http://localhost:3001/media';
    const url = `${base}/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
    return { url, expiresAt };
  }

  async delete(key: string): Promise<void> {
    await rm(this.filePath(key), { force: true });
  }
}
