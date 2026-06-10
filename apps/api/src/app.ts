import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './auth';
import { loadConfig } from './config';
import { healthHandler } from './health';
import { errorHandler } from './middlewares/error';
import { createChannelsRouter } from './routes/channels';
import { createConversationsRouter } from './routes/conversations';
import { createNotesRouter } from './routes/conversations/notes';
import { createRoutingRouter } from './routes/conversations/routing';
import { createWindowRouter } from './routes/conversations/window';
import { createWebhooksRouter } from './routes/webhooks';

/** Monta o app Express 5 com middlewares de segurança + rotas de auth + /health. */
export function createApp(): Express {
  const config = loadConfig();
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(compression());

  // Webhooks ANTES do json global: as rotas POST usam express.raw p/ HMAC Meta
  // (exige os bytes exatos recebidos). Ver routes/webhooks/index.ts.
  app.use(createWebhooksRouter());

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', healthHandler);
  app.use(createAuthRouter());
  app.use(createConversationsRouter());
  app.use(createWindowRouter());
  app.use(createNotesRouter());
  app.use(createRoutingRouter());
  app.use(createChannelsRouter());

  // Error handler por último (Express 5 captura erros de handlers async).
  app.use(errorHandler);
  return app;
}
