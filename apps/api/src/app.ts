import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth';
import { loadConfig } from './config';
import { healthHandler } from './health';
import { errorHandler } from './middlewares/error';

/** Monta o app Express 5 com middlewares de segurança + rotas de auth + /health. */
export function createApp(): Express {
  const config = loadConfig();
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', healthHandler);
  app.use(createAuthRouter());

  // Error handler por último (Express 5 captura erros de handlers async).
  app.use(errorHandler);
  return app;
}
