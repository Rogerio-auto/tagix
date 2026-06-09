import { createLogger } from '@hm/logger';
import { loadConfig } from './config';
import { createApiServer } from './server';

const config = loadConfig();
const log = createLogger(config.nodeEnv === 'development' ? 'debug' : 'info', {
  service: '@hm/api',
});

const { httpServer } = createApiServer();
httpServer.listen(config.port, '0.0.0.0', () => {
  log.info('API ouvindo (HTTP + Socket.io)', { port: config.port, env: config.nodeEnv });
});
