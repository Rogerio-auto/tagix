import type { Server as HttpServer } from 'node:http';
import { Server, type DefaultEventsMap } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { SESSION_COOKIE, resolveSession, type SessionContext } from '../auth';
import { loadConfig } from '../config';
import { startSocketRelay } from './relay';

interface SocketData {
  session?: SessionContext;
}

type IoServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Socket.io autenticado pela MESMA sessão da API (cookie). Adapter Redis para
 * escalar multi-processo. Cada socket entra nas rooms `ws:<workspaceId>` e
 * `member:<memberId>` e o workspace recebe `member:online`.
 */
export function createSocketServer(httpServer: HttpServer): IoServer {
  const config = loadConfig();
  const io: IoServer = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
  });

  const pub = new Redis(config.redisUrl);
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  // Relay RabbitMQ → Socket.io. Falha de conexão não derruba o boot.
  void startSocketRelay(io).catch((err: unknown) => {
    console.error('[socket] falha ao iniciar relay RabbitMQ:', err);
  });

  io.use((socket, next) => {
    void (async () => {
      const token = parseCookie(socket.handshake.headers.cookie ?? '', SESSION_COOKIE);
      const session = token ? await resolveSession(token) : null;
      if (!session) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.session = session;
      next();
    })();
  });

  io.on('connection', (socket) => {
    const session = socket.data.session;
    if (!session) {
      socket.disconnect(true);
      return;
    }
    const wsRoom = `ws:${session.workspace.id}`;
    socket.join([wsRoom, `member:${session.member.id}`]);
    io.to(wsRoom).emit('member:online', { memberId: session.member.id });
  });

  return io;
}

export type { IoServer };
