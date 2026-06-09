/**
 * @hm/storage — abstração de storage de mídia (`IStorageDriver`).
 *
 * Drivers concretos (LocalDriver para dev, R2Driver para prod) entram em F0-S14.
 * A mídia nunca acumula na VPS — o driver R2 é S3-compatível sem egress.
 */

export interface PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array | ReadableStream;
  readonly contentType: string;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface IStorageDriver {
  put(input: PutObjectInput): Promise<void>;
  getSignedUrl(key: string, ttlSeconds: number): Promise<SignedUrl>;
  delete(key: string): Promise<void>;
}

export type StorageDriverKind = 'local' | 'r2';
