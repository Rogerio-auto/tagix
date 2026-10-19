import { createServer, type Server as HttpServer } from 'node:http';
import { createLogger } from '@hm/logger';
import { createApp } from './app';
import { parseCopilotEnabled } from './config';
import { COPILOT_EXECUTORS } from './internal/copilot';
import {
  createExecutorRegistry,
  createProposalEngineDeps,
  startProposalSweeper,
  type ProposalSweeper,
} from './services/copilot/proposals';
import { startBriefingScheduler, type BriefingScheduler } from './services/copilot/briefing';
import { startBudgetAlertScheduler, type BudgetAlertScheduler } from './services/copilot/usage';
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
  /**
   * Agendador do briefing da manhã (F73-S12: 06:30 locais de cada workspace). Só no processo
   * HTTP, com lock Redis. Default: ligado fora de `NODE_ENV=test`.
   */
  readonly copilotBriefing?: boolean;
  /**
   * Agendador do alerta de orçamento do Copiloto (F73-S15). Só no processo HTTP, com lock Redis.
   * Default: ligado fora de `NODE_ENV=test`.
   */
  readonly copilotBudgetAlert?: boolean;
}

/** App Express + servidor HTTP + Socket.io (com adapter Redis) + trabalhos de fundo. */
export function createApiServer(options: ApiServerOptions = {}): ApiServer {
  const httpServer = createServer(createApp());
  const io = createSocketServer(httpServer);

  // Chave global COPILOT_ENABLED (F73-S17): desligada ⇒ nenhum trabalho de fundo do Copiloto
  // sobe, nem com a opção explícita (a chave vence).
  const copilotEnabled = parseCopilotEnabled();
  const notTest = process.env['NODE_ENV'] !== 'test';
  const sweeperEnabled = copilotEnabled && (options.copilotSweeper ?? notTest);
  const sweeper: ProposalSweeper | null = sweeperEnabled
    ? startProposalSweeper(
        createProposalEngineDeps({ executors: createExecutorRegistry(COPILOT_EXECUTORS) }),
      )
    : null;
  const briefingEnabled = copilotEnabled && (options.copilotBriefing ?? notTest);
  const briefing: BriefingScheduler | null = briefingEnabled ? startBriefingScheduler() : null;
  const budgetAlertEnabled = copilotEnabled && (options.copilotBudgetAlert ?? notTest);
  const budgetAlert: BudgetAlertScheduler | null = budgetAlertEnabled
    ? startBudgetAlertScheduler()
    : null;
  let stopping: Promise<void> | null = null;
  const stopBackground = (): Promise<void> =>
    (stopping ??= Promise.all([
      (sweeper?.stop() ?? Promise.resolve()).catch((err: unknown) => {
        createLogger('warn', { svc: '@hm/api' }).warn('falha ao parar a varredura do Copiloto', {
          errorName: err instanceof Error ? err.name : typeof err,
        });
      }),
      (briefing?.stop() ?? Promise.resolve()).catch((err: unknown) => {
        createLogger('warn', { svc: '@hm/api' }).warn(
          'falha ao parar o agendador do briefing do Copiloto',
          { errorName: err instanceof Error ? err.name : typeof err },
        );
      }),
      (budgetAlert?.stop() ?? Promise.resolve()).catch((err: unknown) => {
        createLogger('warn', { svc: '@hm/api' }).warn(
          'falha ao parar o agendador do alerta de orçamento do Copiloto',
          { errorName: err instanceof Error ? err.name : typeof err },
        );
      }),
    ]).then(() => undefined));
  // Shutdown: fechar o HTTP para a varredura (e espera as execuções em andamento).
  httpServer.once('close', () => {
    void stopBackground();
  });

  return { httpServer, io, stopBackground };
}
