import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import type { IStorageDriver, PutObjectInput, SignedUrl, SignedUrlOptions } from './types';
import { StorageError, probeStateFromError, type IStorageProbe, type StorageProbeResult } from './errors';
import { toBuffer } from './stream';

export interface R2DriverOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Endpoint S3 alternativo (testes / S3 local). Default: o do R2 da conta. */
  endpoint?: string;
}

/**
 * Driver de produção: Cloudflare R2 (S3-compatível, sem egress).
 *
 * Toda falha sai como `StorageError` classificado e saneado (F70-S27): o chamador
 * decide a reação pelo `kind` (configuração × transitória) e pode logar os campos sem
 * risco de vazar a chave de acesso ou uma URL assinada.
 */
export class R2Driver implements IStorageDriver, IStorageProbe {
  private readonly client: S3Client;

  constructor(private readonly opts: R2DriverOptions) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: opts.endpoint !== undefined,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(input: PutObjectInput): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.opts.bucket,
          Key: input.key,
          Body: await toBuffer(input.body),
          ContentType: input.contentType,
        }),
      );
    } catch (err: unknown) {
      throw StorageError.from(err, 'put', this.opts.bucket);
    }
  }

  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    opts?: SignedUrlOptions,
  ): Promise<SignedUrl> {
    try {
      const url = await presign(
        this.client,
        new GetObjectCommand({
          Bucket: this.opts.bucket,
          Key: key,
          // `response-content-type` faz o R2 devolver este Content-Type no download — o
          // provider (Meta) usa o header da resposta para classificar a mídia.
          ...(opts?.responseContentType ? { ResponseContentType: opts.responseContentType } : {}),
        }),
        { expiresIn: ttlSeconds },
      );
      return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
    } catch (err: unknown) {
      throw StorageError.from(err, 'sign', this.opts.bucket);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
    } catch (err: unknown) {
      throw StorageError.from(err, 'delete', this.opts.bucket);
    }
  }

  /**
   * Sonda barata: `HeadBucket`. Toca a rede e valida a credencial contra o bucket sem
   * gravar nada (o `PUT` de sondagem da F61-S11 deixava um objeto `_health/probe`). Um
   * token revogado, expirado ou com escopo errado devolve 403 aqui, exatamente como no
   * incidente de 25/09.
   *
   * Limite conhecido: um token só de LEITURA passa nesta sonda e falha no `put`. Essa
   * metade é coberta pelo worker de mídia, que conta cada upload recusado
   * (`hm_media_storage_failures_total{kind="config"}`) e dispara o mesmo alerta.
   */
  async probe(timeoutMs: number): Promise<StorageProbeResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }), {
        abortSignal: controller.signal,
      });
      return { state: 'ok', durationMs: Date.now() - started };
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return { state: 'unreachable', code: 'TimeoutError', durationMs: Date.now() - started };
      }
      const { state, code } = probeStateFromError(err);
      return { state, code, durationMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}
