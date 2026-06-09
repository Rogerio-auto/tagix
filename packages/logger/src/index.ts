/**
 * @hm/logger — logging estruturado (Pino) com PII masking.
 * O contrato `Logger` é estável; só a implementação interna usa Pino.
 */
import pino, { type Logger as PinoLogger } from 'pino';

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

// Campos mascarados no output (PII / segredos). `*.x` cobre objetos aninhados.
const REDACT_PATHS = [
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
  'phone',
  '*.phone',
  'email',
  '*.email',
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

export function createLogger(minLevel: LogLevel = 'info', base: LogFields = {}): Logger {
  const p = pino({
    level: minLevel,
    base,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return wrap(p);
}

export * from './otel';
