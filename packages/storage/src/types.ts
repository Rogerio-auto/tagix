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

/** Opções da URL assinada de leitura. */
export interface SignedUrlOptions {
  /**
   * Sobrescreve o `Content-Type` que o storage devolve ao baixar (S3/R2:
   * `response-content-type`). Usado p/ forçar `audio/ogg; codecs=opus` em notas de voz
   * — sem o hint de codec, o WhatsApp Cloud API renderiza como áudio plano, sem a onda PTT.
   */
  readonly responseContentType?: string;
}

export interface IStorageDriver {
  put(input: PutObjectInput): Promise<void>;
  getSignedUrl(key: string, ttlSeconds: number, opts?: SignedUrlOptions): Promise<SignedUrl>;
  delete(key: string): Promise<void>;
}

export type StorageDriverKind = 'local' | 'r2';
