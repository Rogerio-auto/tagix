import { createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IStorageDriver, PutObjectInput, SignedUrl, SignedUrlOptions } from './types';
import type { IStorageProbe, StorageProbeResult } from './errors';
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
export class LocalDriver implements IStorageDriver, IStorageProbe {
  constructor(private readonly opts: LocalDriverOptions) {}

  private filePath(key: string): string {
    return path.join(this.opts.basePath, key);
  }

  async put(input: PutObjectInput): Promise<void> {
    const fp = this.filePath(input.key);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, await toBuffer(input.body));
  }

  // `opts` (responseContentType) é honrado só no R2 (prod); no dev o content-type sai do
  // arquivo servido pela rota /media. Aceito o parâmetro para casar a interface.
  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    _opts?: SignedUrlOptions,
  ): Promise<SignedUrl> {
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

  /**
   * Sonda do dev: o diretório base existe (ou pode ser criado) e aceita escrita.
   * Permissão negada vira `denied`, igual a uma credencial recusada no R2.
   */
  async probe(_timeoutMs: number): Promise<StorageProbeResult> {
    const started = Date.now();
    try {
      await mkdir(this.opts.basePath, { recursive: true });
      await access(this.opts.basePath, constants.W_OK);
      return { state: 'ok', durationMs: Date.now() - started };
    } catch (err: unknown) {
      const raw: unknown =
        typeof err === 'object' && err !== null ? Reflect.get(err, 'code') : undefined;
      const code = typeof raw === 'string' ? raw : 'Unknown';
      const denied = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
      return { state: denied ? 'denied' : 'unreachable', code, durationMs: Date.now() - started };
    }
  }
}
