import { createLogger } from '@hm/logger';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const log = createLogger(config.nodeEnv === 'development' ? 'debug' : 'info', {
  service: '@hm/api',
});

createApp().listen(config.port, '0.0.0.0', () => {
  log.info('API ouvindo', { port: config.port, env: config.nodeEnv });
});
