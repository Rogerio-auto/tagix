/**
 * @hm/logger — logging estruturado (Pino) com PII masking + correlação
 * request-scoped. O contrato `Logger` é estável; só a implementação interna
 * usa Pino.
 */
import pino, { type Logger as PinoLogger, type DestinationStream } from 'pino';
import { resolveLogContext } from './context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

/**
 * Campos mascarados no output (PII / segredos). `*.x` cobre objetos aninhados
 * (um nível). A allowlist do bootstrap cobria só credenciais + phone/email; a
 * auditoria (§3.10) apontou vazamento dos identificadores de canal e documentos
 * pessoais (msisdn/wa_id/document/cpf/address/to/from), agora redigidos.
 */
const REDACT_PATHS = [
  // Credenciais / segredos.
  'password',
  '*.password',
  'token',
  '*.token',
  'secret',
  '*.secret',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'apiKey',
  '*.apiKey',
  // Contato / PII direta.
  'phone',
  '*.phone',
  'email',
  '*.email',
  'msisdn',
  '*.msisdn',
  'wa_id',
  '*.wa_id',
  'waId',
  '*.waId',
  'address',
  '*.address',
  // Documentos pessoais.
  'document',
  '*.document',
  'cpf',
  '*.cpf',
  'cnpj',
  '*.cnpj',
  // Destinatário/remetente de canal (telefone/handle).
  'to',
  '*.to',
  'from',
  '*.from',
];

function wrap(p: PinoLogger): Logger {
  return {
    debug: (msg, fields) => p.debug(fields ?? {}, msg),
    info: (msg, fields) => p.info(fields ?? {}, msg),
    warn: (msg, fields) => p.warn(fields ?? {}, msg),
    error: (msg, fields) => p.error(fields ?? {}, msg),
    child: (bindings) => wrap(p.child(bindings)),
  };
}

export interface LoggerOptions {
  /** Destino do stream (testes). Default: stdout do Pino. */
  readonly destination?: DestinationStream;
}

export function createLogger(
  minLevel: LogLevel = 'info',
  base: LogFields = {},
  options: LoggerOptions = {},
): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: minLevel,
    base,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Correlação (F56-S20): injeta requestId/workspaceId (e demais campos do
    // contexto async) em CADA linha de log, quando dentro de runWithLogContext.
    mixin: () => resolveLogContext(),
  };
  const p = options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
  return wrap(p);
}

export { runWithLogContext, getLogContext, resolveLogContext } from './context';
export type { LogContext } from './context';
export * from './otel';
