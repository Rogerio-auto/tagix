import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import type { IStorageDriver, PutObjectInput, SignedUrl } from './types';
import { toBuffer } from './stream';

export interface R2DriverOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Driver de produção: Cloudflare R2 (S3-compatível, sem egress). */
export class R2Driver implements IStorageDriver {
  private readonly client: S3Client;

  constructor(private readonly opts: R2DriverOptions) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: input.key,
        Body: await toBuffer(input.body),
        ContentType: input.contentType,
      }),
    );
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const url = await presign(
      this.client,
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
