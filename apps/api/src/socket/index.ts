import type { Server as HttpServer } from 'node:http';
import { Server, type DefaultEventsMap, type ExtendedError, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { eq } from 'drizzle-orm';
import { schema, withWorkspace } from '@hm/db';
import {
  SESSION_COOKIE,
  preferredWorkspaceFromHeader,
  readCookieFromHeader,
  resolveSessionStatus,
  type SessionContext,
  type SessionResolution,
} from '../auth';
import { loadConfig } from '../config';
import { startSocketRelay } from './relay';
import { wireSupportRealtime } from '../services/support-realtime';
import { registerSupportSocketHandlers } from '../sockets/support';
import { createLogger } from '@hm/logger';
import { startSocketRevalidation } from './revalidate';
import { setMemberDisconnector } from './member-disconnect';

// Diagnóstico de tempo real: loga handshake (auth ok/falha), conexão + rooms e
// join de conversa. Sem isto, "socket não atualiza" é uma caixa-preta.
const socketLog = createLogger('info', { svc: 'socket' });

interface SocketData {
  session?: SessionContext;
}

type IoServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

type IoSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * Mensagem do `connect_error` do handshake — contrato com o `SocketProvider` do web
 * (F70-S28): `unauthorized` = sessão morta (vai ao login); `auth_unavailable` =
 * provider de auth indisponível (retry com backoff, sem deslogar).
 */
export function handshakeErrorMessage(kind: 'invalid' | 'unavailable'): string {
  return kind === 'invalid' ? 'unauthorized' : 'auth_unavailable';
}

/**
 * Resolve a sessão do handshake a partir do header `Cookie` cru, com as MESMAS regras da
 * API: `hm_session` + empresa ativa `hm_workspace` revalidada contra membership `active`
 * do `auth_user_id` (F71-S03). Cookie de empresa inválida é ignorado (cai na padrão).
 */
export async function resolveHandshakeSession(
  cookieHeader: string | undefined,
): Promise<SessionResolution> {
  const token = readCookieFromHeader(cookieHeader, SESSION_COOKIE);
  if (!token) return { kind: 'invalid' };
  return resolveSessionStatus(token, preferredWorkspaceFromHeader(cookieHeader));
}

/** Rooms em que o socket entra: a empresa ATIVA da sessão e o próprio membro. */
export function sessionRooms(session: SessionContext): [string, string] {
  return [`ws:${session.workspace.id}`, `member:${session.member.id}`];
}

/**
 * Middleware de handshake (`io.use`): sem sessão, recusa com a mensagem do contrato
 * (`handshakeErrorMessage`); com sessão, a anexa em `socket.data.session`.
 */
export function handshakeAuth(socket: IoSocket, next: (err?: ExtendedError) => void): void {
  void (async () => {
    const cookieHeader = socket.handshake.headers.cookie;
    const result = await resolveHandshakeSession(cookieHeader);
    if (result.kind !== 'ok') {
      socketLog.warn('handshake unauthorized', {
        hasCookieHeader: Boolean(cookieHeader),
        hasSessionCookie: readCookieFromHeader(cookieHeader, SESSION_COOKIE) !== null,
        reason: result.kind,
        url: socket.handshake.url,
        transport: socket.conn.transport.name,
      });
      // F70-S28: o cliente só volta ao login em `unauthorized` (sessão morta).
      // `auth_unavailable` (provider fora do ar) ele trata como falha temporária e
      // tenta de novo com backoff — nunca desloga por instabilidade de infra.
      next(new Error(handshakeErrorMessage(result.kind)));
      return;
    }
    socket.data.session = result.session;
    next();
  })().catch((err: unknown) => {
    // Falha inesperada (ex.: banco fora): recusa como temporária, sem deslogar.
    socketLog.error('handshake falhou', { err: err instanceof Error ? err.message : String(err) });
    next(new Error(handshakeErrorMessage('unavailable')));
  });
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

  io.use(handshakeAuth);

  // F-03: bloqueio/remoção de membro derruba os sockets dele na hora (todas as instâncias,
  // via adapter Redis). O timer de revalidação abaixo cobre os caminhos que não passam aqui.
  setMemberDisconnector((memberId) => {
    io.in(`member:${memberId}`).disconnectSockets(true);
  });

  io.on('connection', (socket) => {
    const session = socket.data.session;
    if (!session) {
      socket.disconnect(true);
      return;
    }
    const rooms = sessionRooms(session);
    const [wsRoom] = rooms;
    socket.join(rooms);
    io.to(wsRoom).emit('member:online', { memberId: session.member.id });
    // F-03: o handshake autentica uma vez; revalida a sessão/membership a cada 60 s.
    startSocketRevalidation(socket, {
      session,
      cookieHeader: socket.handshake.headers.cookie,
      resolve: resolveHandshakeSession,
      onRevoked: () =>
        socketLog.warn('socket derrubado: sessão/membership não vale mais', {
          memberId: session.member.id,
          workspaceId: session.workspace.id,
        }),
    });
    socketLog.info('socket conectado', {
      memberId: session.member.id,
      workspaceId: session.workspace.id,
      transport: socket.conn.transport.name,
    });

    // Diagnóstico de instabilidade: registra o upgrade de transporte
    // (polling→websocket) e o MOTIVO da desconexão (ping timeout / transport close
    // / transport error / client disconnect) — para isolar onde a conexão morre.
    socket.conn.on('upgrade', () => {
      socketLog.info('transport upgraded', {
        memberId: session.member.id,
        transport: socket.conn.transport.name,
      });
    });
    socket.on('disconnect', (reason) => {
      socketLog.info('socket desconectado', {
        memberId: session.member.id,
        reason,
        transport: socket.conn.transport.name,
      });
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
