/**
 * Carregamento e validação de configuração da API a partir do ambiente.
 * Fail-fast: se uma var obrigatória falta, o processo não sobe.
 */

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

export function loadConfig(): ApiConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as ApiConfig['nodeEnv'];
  return {
    nodeEnv,
    port: Number(process.env['API_PORT'] ?? '3001'),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    corsOrigin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  };
}
