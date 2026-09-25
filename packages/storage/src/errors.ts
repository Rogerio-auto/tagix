/**
 * Classificação das falhas de storage (F70-S27).
 *
 * Incidente de 25/09 (e o de 09/09, F61-S11): o token do R2 foi recusado e a mídia
 * parou em silêncio. O worker tratava "Access Denied" igual a um soluço de rede —
 * gastava as retentativas do job e o mandava para a DLQ, sem um `warn` sequer.
 *
 * Três naturezas, três reações:
 *  - `config`    — a credencial ou o bucket estão errados (`AccessDenied`,
 *                  `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `NoSuchBucket`, 401/403).
 *                  Retentar em segundos não adianta; só uma pessoa conserta. O job espera
 *                  com backoff longo SEM gastar as retentativas, e o alarme toca.
 *  - `transient` — rede, timeout, 5xx, throttling. Retentar resolve; a escada normal de
 *                  retry da fila cuida.
 *  - `unknown`   — o resto. Tratado como transitório (a escada tem fim: DLQ).
 *
 * Nada aqui carrega segredo: o `StorageError` guarda só código, operação, bucket e
 * status HTTP. Nunca a mensagem crua do provedor (pode ecoar a chave de acesso, caso do
 * `InvalidAccessKeyId`), nunca o corpo da resposta, nunca a URL assinada.
 */

/** Natureza da falha — decide a reação (ver cabeçalho). */
export type StorageFailureKind = 'config' | 'transient' | 'unknown';

/** Operação que falhou (log/métrica). */
export type StorageOperation = 'put' | 'head' | 'sign' | 'delete' | 'probe';

/** Códigos S3/R2 que só uma correção humana resolve. */
const CONFIG_CODES: ReadonlySet<string> = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'NoSuchBucket',
  'InvalidBucketName',
  'AllAccessDisabled',
  'AccountProblem',
  'InvalidToken',
  'ExpiredToken',
  'AuthorizationHeaderMalformed',
  'Forbidden',
  'Unauthorized',
  'CredentialsProviderError',
]);

/** Códigos que indicam soluço do provedor ou da rede. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'InternalError',
  'ServiceUnavailable',
  'SlowDown',
  'RequestTimeout',
  'RequestTimeTooSkewed',
  'ThrottlingException',
  'TimeoutError',
  'AbortError',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'NetworkingError',
]);

/** Código seguro para log: só letras, dígitos e `_`/`-`/`.`, com teto de tamanho. */
function safeCode(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'Unknown';
}

function readString(obj: object, key: string): string | undefined {
  const value: unknown = Reflect.get(obj, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Status HTTP de um erro do AWS SDK (`$metadata.httpStatusCode`), se houver. */
function readHttpStatus(obj: object): number | undefined {
  const meta: unknown = Reflect.get(obj, '$metadata');
  if (typeof meta === 'object' && meta !== null) {
    const status: unknown = Reflect.get(meta, 'httpStatusCode');
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  const direct: unknown = Reflect.get(obj, 'httpStatus');
  return typeof direct === 'number' && Number.isFinite(direct) ? direct : undefined;
}

/** Código de rede do Node (`err.code`, ou o da causa). */
function readNodeCode(obj: object): string | undefined {
  const own = readString(obj, 'code');
  if (own !== undefined) return own;
  const cause: unknown = Reflect.get(obj, 'cause');
  return typeof cause === 'object' && cause !== null ? readString(cause, 'code') : undefined;
}

/**
 * Deriva um código estável do erro. Respostas a `HEAD` não têm corpo, então o SDK não
 * traz `AccessDenied` por nome — o status HTTP decide (403 negado, 404 bucket ausente).
 */
function deriveCode(obj: object, httpStatus: number | undefined): string {
  const name = readString(obj, 'Code') ?? readString(obj, 'name');
  // `Unknown`/`UnknownError`: nome que o SDK dá a respostas de erro sem corpo (HEAD 403).
  const generic =
    name === undefined ||
    name === 'Error' ||
    name === 'Unknown' ||
    name === 'UnknownError' ||
    /^\d+$/.test(name);
  if (!generic) return safeCode(name);
  const nodeCode = readNodeCode(obj);
  if (nodeCode !== undefined) return safeCode(nodeCode);
  if (httpStatus === 401) return 'Unauthorized';
  if (httpStatus === 403) return 'AccessDenied';
  if (httpStatus === 404) return 'NoSuchBucket';
  if (httpStatus !== undefined) return `Http${httpStatus}`;
  return 'Unknown';
}

/** Resultado da classificação — tudo seguro para log e métrica. */
export interface StorageFailureInfo {
  readonly kind: StorageFailureKind;
  readonly code: string;
  readonly httpStatus: number | undefined;
}

/**
 * Classifica um erro de storage. Aceita `StorageError` (já classificado), erros do AWS
 * SDK, erros de rede do Node e qualquer outra coisa (`unknown`).
 */
export function classifyStorageError(err: unknown): StorageFailureInfo {
  if (err instanceof StorageError) {
    return { kind: err.kind, code: err.code, httpStatus: err.httpStatus };
  }
  if (typeof err !== 'object' || err === null) {
    return { kind: 'unknown', code: 'Unknown', httpStatus: undefined };
  }
  const httpStatus = readHttpStatus(err);
  const code = deriveCode(err, httpStatus);
  if (CONFIG_CODES.has(code)) return { kind: 'config', code, httpStatus };
  if (TRANSIENT_CODES.has(code)) return { kind: 'transient', code, httpStatus };
  if (httpStatus === 401 || httpStatus === 403) return { kind: 'config', code, httpStatus };
  if (httpStatus !== undefined && (httpStatus >= 500 || httpStatus === 429)) {
    return { kind: 'transient', code, httpStatus };
  }
  return { kind: 'unknown', code, httpStatus };
}

/**
 * Erro de storage já classificado e SANEADO. A `message` é montada só com código e
 * operação — a original do provedor fica de fora de propósito (ver cabeçalho).
 */
export class StorageError extends Error {
  override readonly name = 'StorageError';
  readonly kind: StorageFailureKind;
  readonly code: string;
  readonly operation: StorageOperation;
  readonly bucket: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(opts: {
    readonly kind: StorageFailureKind;
    readonly code: string;
    readonly operation: StorageOperation;
    readonly bucket?: string | undefined;
    readonly httpStatus?: number | undefined;
  }) {
    super(`storage ${opts.operation} falhou: ${opts.code}`);
    this.kind = opts.kind;
    this.code = opts.code;
    this.operation = opts.operation;
    this.bucket = opts.bucket;
    this.httpStatus = opts.httpStatus;
    Object.setPrototypeOf(this, StorageError.prototype);
  }

  /** Embrulha um erro qualquer num `StorageError` saneado (idempotente). */
  static from(err: unknown, operation: StorageOperation, bucket?: string): StorageError {
    if (err instanceof StorageError) return err;
    const info = classifyStorageError(err);
    return new StorageError({ ...info, operation, bucket });
  }

  /** Campos para log estruturado — sem segredo. */
  toLogFields(): Record<string, string | number | undefined> {
    return {
      storageCode: this.code,
      storageKind: this.kind,
      storageOperation: this.operation,
      bucket: this.bucket,
      httpStatus: this.httpStatus,
    };
  }
}

/** `true` quando o erro é de configuração (credencial/bucket). */
export function isStorageConfigError(err: unknown): boolean {
  return classifyStorageError(err).kind === 'config';
}

// ─── Sonda ────────────────────────────────────────────────────────────────────

/**
 * Estado do storage visto pela sonda:
 *  - `ok`          — respondeu e aceitou a credencial;
 *  - `denied`      — respondeu e recusou (credencial/bucket: falha de configuração);
 *  - `unreachable` — não respondeu a tempo, ou respondeu com erro transitório.
 */
export type StorageProbeState = 'ok' | 'denied' | 'unreachable';

export interface StorageProbeResult {
  readonly state: StorageProbeState;
  /** Código seguro da falha (ausente em `ok`). */
  readonly code?: string;
  readonly durationMs: number;
}

/** Driver que sabe se sondar de forma barata (sem gravar objeto). */
export interface IStorageProbe {
  probe(timeoutMs: number): Promise<StorageProbeResult>;
}

/** Estreita um driver qualquer para um que sabe se sondar. */
export function isStorageProbe(driver: unknown): driver is IStorageProbe {
  return (
    typeof driver === 'object' &&
    driver !== null &&
    typeof Reflect.get(driver, 'probe') === 'function'
  );
}

/** Converte um erro da sonda no estado correspondente. */
export function probeStateFromError(err: unknown): { state: StorageProbeState; code: string } {
  const info = classifyStorageError(err);
  return { state: info.kind === 'config' ? 'denied' : 'unreachable', code: info.code };
}
