/**
 * @hm/api — entrypoint da API (Express 5 + Socket.io).
 *
 * Este arquivo cresce em F0-S06 (servidor Express + middlewares helmet/cors/
 * requireAuth/withRLS + error handler) e F0-S07 (Socket.io + Redis adapter).
 * Por ora valida que a config carrega e que o logging compartilhado funciona.
 */

import { createLogger } from '@hm/logger';
import { loadConfig } from './config.js';

export function bootstrap(): void {
  const config = loadConfig();
  const log = createLogger(config.nodeEnv === 'development' ? 'debug' : 'info', {
    service: '@hm/api',
  });
  log.info('config carregada', { port: config.port, env: config.nodeEnv });
  // F0-S06: criar app Express, registrar middlewares e rotas, app.listen(port, '0.0.0.0').
}

export { loadConfig } from './config.js';
export type { ApiConfig } from './config.js';
