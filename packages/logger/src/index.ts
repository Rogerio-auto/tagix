/**
 * @hm/logger — logging estruturado com PII masking.
 *
 * F0-S08 troca a implementação interna por Pino + OpenTelemetry mantendo esta
 * interface. Consumidores dependem só do contrato `Logger`, nunca da impl.
 */

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

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Implementação mínima sobre `console` (substituída por Pino em F0-S08).
 * Já emite JSON estruturado para parsing por coletores.
 */
export function createLogger(minLevel: LogLevel = 'info', base: LogFields = {}): Logger {
  const threshold = LEVELS[minLevel];

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LEVELS[level] < threshold) return;
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...base, ...fields });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (bindings) => createLogger(minLevel, { ...base, ...bindings }),
  };
}
