import { createServer, type Server as HttpServer } from 'node:http';
import { createLogger } from '@hm/logger';
import { createApp } from './app';
import { COPILOT_EXECUTORS } from './internal/copilot';
import {
  createExecutorRegistry,
  createProposalEngineDeps,
  startProposalSweeper,
  type ProposalSweeper,
} from './services/copilot/proposals';
import { createSocketServer, type IoServer } from './socket';

export interface ApiServer {
  httpServer: HttpServer;
  io: IoServer;
  /** Para os trabalhos de fundo do processo HTTP (varredura do Copiloto). Idempotente. */
  stopBackground(): Promise<void>;
}

export interface ApiServerOptions {
  /**
   * Varredura das propostas do Copiloto (F73-S05: expira e retoma lotes). Só no processo HTTP.
   * Default: ligada fora de `NODE_ENV=test`.
   */
  readonly copilotSweeper?: boolean;
}

/** App Express + servidor HTTP + Socket.io (com adapter Redis) + trabalhos de fundo. */
export function createApiServer(options: ApiServerOptions = {}): ApiServer {
  const httpServer = createServer(createApp());
  const io = createSocketServer(httpServer);

  const sweeperEnabled = options.copilotSweeper ?? process.env['NODE_ENV'] !== 'test';
  const sweeper: ProposalSweeper | null = sweeperEnabled
    ? startProposalSweeper(
        createProposalEngineDeps({ executors: createExecutorRegistry(COPILOT_EXECUTORS) }),
      )
    : null;
  let stopping: Promise<void> | null = null;
  const stopBackground = (): Promise<void> =>
    (stopping ??= (sweeper?.stop() ?? Promise.resolve()).catch((err: unknown) => {
      createLogger('warn', { svc: '@hm/api' }).warn('falha ao parar a varredura do Copiloto', {
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }));
  // Shutdown: fechar o HTTP para a varredura (e espera as execuções em andamento).
  httpServer.once('close', () => {
    void stopBackground();
  });

  return { httpServer, io, stopBackground };
}
