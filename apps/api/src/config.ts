/**
 * Carregamento e validação de configuração da API a partir do ambiente.
 * Fail-fast: se uma var obrigatória falta, o processo não sobe.
 */
import { randomBytes } from 'node:crypto';
import { createLogger } from '@hm/logger';
import { z } from 'zod';

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly corsOrigin: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

// ─── Segredo do grant do Copiloto (ADR-003 §2) ───────────────────────────────

/** Nome da variável. Segredo PRÓPRIO: não é o `AGENT_RUNTIME_TOKEN`. */
export const COPILOT_GRANT_SECRET_ENV = 'COPILOT_GRANT_SECRET';

/** Mínimo de 32 bytes (256 bits): a chave do HMAC-SHA256 não pode ser mais fraca que o hash. */
export const COPILOT_GRANT_SECRET_MIN_BYTES = 32;

/**
 * O valor é usado como bytes UTF-8 crus (gere com `openssl rand -base64 48`). O tamanho é
 * medido em BYTES, não em caracteres.
 */
const CopilotGrantSecretSchema = z
  .string()
  .refine((s) => Buffer.byteLength(s, 'utf8') >= COPILOT_GRANT_SECRET_MIN_BYTES, {
    message: `${COPILOT_GRANT_SECRET_ENV} precisa de pelo menos ${COPILOT_GRANT_SECRET_MIN_BYTES} bytes.`,
  });

/** Segredo efêmero do processo, só fora de produção (dev e teste sem a variável). */
let processGrantSecret: Buffer | null = null;

/**
 * Chave do HMAC do grant do Copiloto.
 *
 * - Variável presente: precisa de ≥ 32 bytes em QUALQUER ambiente (valor curto é erro, não
 *   aviso: um segredo fraco em staging vira hábito em produção).
 * - Ausente em produção: lança (o boot falha em `loadConfig`).
 * - Ausente fora de produção: gera 32 bytes aleatórios por processo e avisa uma vez. Grants
 *   deixam de valer a cada reinício, o que em dev é o comportamento certo (turnos duram 120 s).
 *
 * Lida a cada chamada (barata): a rotação do segredo vale sem reinício do processo.
 */
export function copilotGrantSecret(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[COPILOT_GRANT_SECRET_ENV];
  if (raw !== undefined && raw !== '') {
    const parsed = CopilotGrantSecretSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `${COPILOT_GRANT_SECRET_ENV} inválida: precisa de pelo menos ${COPILOT_GRANT_SECRET_MIN_BYTES} bytes.`,
      );
    }
    return Buffer.from(parsed.data, 'utf8');
  }
  if ((env['NODE_ENV'] ?? 'development') === 'production') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${COPILOT_GRANT_SECRET_ENV}`);
  }
  if (processGrantSecret === null) {
    processGrantSecret = randomBytes(COPILOT_GRANT_SECRET_MIN_BYTES);
    createLogger('warn', { svc: '@hm/api', component: 'config' }).warn(
      `${COPILOT_GRANT_SECRET_ENV} ausente: usando um segredo efêmero gerado por este processo (só fora de produção).`,
    );
  }
  return processGrantSecret;
}

export function loadConfig(): ApiConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as ApiConfig['nodeEnv'];
  // Fail-fast do segredo do Copiloto: em produção sem a variável, o processo não sobe.
  copilotGrantSecret();
  return {
    nodeEnv,
    port: Number(process.env['API_PORT'] ?? '3001'),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  };
}
