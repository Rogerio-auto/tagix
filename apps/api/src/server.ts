import { createServer, type Server as HttpServer } from 'node:http';
import { createApp } from './app';
import { createSocketServer, type IoServer } from './socket';

export interface ApiServer {
  httpServer: HttpServer;
  io: IoServer;
}

/** App Express + servidor HTTP + Socket.io (com adapter Redis). */
export function createApiServer(): ApiServer {
  const httpServer = createServer(createApp());
  const io = createSocketServer(httpServer);
  return { httpServer, io };
}
