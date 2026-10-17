/**
 * Escrita do SSE público do Copiloto (COPILOTO.md §5.3).
 *
 * - Cabeçalhos de streaming de produção: `text/event-stream`, `Cache-Control: no-cache,
 *   no-transform` (o `no-transform` também desliga o `compression()` do app, que senão
 *   bufferiza o stream) e `X-Accel-Buffering: no` (nginx/Traefik não seguram os frames).
 * - Todo frame passa pelo `CopilotStreamEventSchema` ANTES de sair: um frame fora do
 *   contrato nunca chega ao navegador; vira log e, se for o caso, `error internal`.
 * - Heartbeat de comentário (`: hb`) a cada 15 s: mantém a conexão viva em proxies com
 *   timeout de ociosidade enquanto o modelo pensa ou uma ferramenta roda.
 */
import type { Response } from 'express';
import { CopilotStreamEventSchema, type CopilotStreamEvent } from '@hm/shared';

export const COPILOT_SSE_HEARTBEAT_MS = 15_000;

export const COPILOT_SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

export interface CopilotSseWriter {
  /** `false` quando o cliente já foi embora ou o frame não valida (nada foi escrito). */
  send(event: CopilotStreamEvent): boolean;
  /** Encerra o stream (idempotente). */
  end(): void;
  /** O cliente ainda está lá? */
  readonly open: boolean;
}

export interface OpenSseOptions {
  readonly heartbeatMs?: number;
  /** Frame que não validou (bug de mapeamento): só o tipo vai para o log. */
  readonly onInvalidFrame?: (type: string) => void;
}

export function openCopilotSse(res: Response, options: OpenSseOptions = {}): CopilotSseWriter {
  res.writeHead(200, COPILOT_SSE_HEADERS);
  res.flushHeaders();
  res.socket?.setNoDelay(true);

  let ended = false;
  const alive = (): boolean => !ended && !res.writableEnded && !res.destroyed;
  const heartbeat = setInterval(() => {
    if (alive()) res.write(': hb\n\n');
  }, options.heartbeatMs ?? COPILOT_SSE_HEARTBEAT_MS);
  heartbeat.unref();
  res.on('close', () => clearInterval(heartbeat));

  return {
    send(event: CopilotStreamEvent): boolean {
      if (!alive()) return false;
      const parsed = CopilotStreamEventSchema.safeParse(event);
      if (!parsed.success) {
        options.onInvalidFrame?.(event.type);
        return false;
      }
      res.write(`data: ${JSON.stringify(parsed.data)}\n\n`);
      return true;
    },
    end(): void {
      clearInterval(heartbeat);
      if (ended) return;
      ended = true;
      if (!res.writableEnded) res.end();
    },
    get open(): boolean {
      return alive();
    },
  };
}
