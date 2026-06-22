import type { Server as HttpServer } from 'node:http';
import { Server, type DefaultEventsMap } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import { SESSION_COOKIE, resolveSession, type SessionContext } from '../auth';
import { loadConfig } from '../config';
import { startSocketRelay } from './relay';
import { wireSupportRealtime } from '../services/support-realtime';
import { registerSupportSocketHandlers } from '../sockets/support';
import { createLogger } from '@hm/logger';

// Diagnóstico de tempo real: loga handshake (auth ok/falha), conexão + rooms e
// join de conversa. Sem isto, "socket não atualiza" é uma caixa-preta.
const socketLog = createLogger('info', { svc: 'socket' });

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

  // F38: liga o seam de eventos de suporte ao emit em processo (rooms support:*).
  wireSupportRealtime(io);

  io.use((socket, next) => {
    void (async () => {
      const token = parseCookie(socket.handshake.headers.cookie ?? '', SESSION_COOKIE);
      const session = token ? await resolveSession(token) : null;
      if (!session) {
        socketLog.warn('handshake unauthorized', {
          hasCookieHeader: Boolean(socket.handshake.headers.cookie),
          hasSessionCookie: token !== null,
        });
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
    socketLog.info('socket conectado', {
      memberId: session.member.id,
      workspaceId: session.workspace.id,
      transport: socket.conn.transport.name,
    });

    // F38: handlers de suporte (join autorizado por visibilidade; platform → support:platform).
    registerSupportSocketHandlers(socket, {
      workspaceId: session.workspace.id,
      memberId: session.member.id,
      isPlatformAdmin: session.member.isPlatformAdmin,
    });

    // Rooms por conversa: o client pede join ao abrir uma conversa. Verifica posse
    // no workspace (RLS) ANTES de entrar — uma room `conversation:<id>` recebe
    // eventos sensíveis (message:new etc.), então nunca confiar no id do client.
    socket.on('conversation:join', (conversationId: unknown) => {
      if (typeof conversationId !== 'string' || conversationId.length === 0) return;
      void (async () => {
        const owned = await withWorkspace(session.workspace.id, async (tx) => {
          const [row] = await tx
            .select({ id: schema.conversations.id })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, conversationId));
          return Boolean(row);
        });
        if (owned) await socket.join(`conversation:${conversationId}`);
      })();
    });

    socket.on('conversation:leave', (conversationId: unknown) => {
      if (typeof conversationId === 'string' && conversationId.length > 0) {
        void socket.leave(`conversation:${conversationId}`);
      }
    });
  });

  return io;
}

export type { IoServer };
