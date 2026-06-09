/** Contratos de storage de mídia. Implementados por LocalDriver (dev) e R2Driver (prod). */

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
