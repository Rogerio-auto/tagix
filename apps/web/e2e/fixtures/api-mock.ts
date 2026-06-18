/**
 * Router de mocks de API para a jornada e2e (F10-S03).
 *
 * Intercepta TODA a rede que sairia do browser para a API real (`/api/**`,
 * `/auth/**`) e para o transporte realtime (`/socket.io**`), respondendo com o
 * seed determinístico. Nenhum serviço externo (API @hm/api, WAHA, agent-runtime,
 * Meta) precisa estar de pé — o teste é hermético.
 *
 * É STATEFUL dentro de uma página: ações com efeito (conectar canal, enviar
 * mensagem, disparar flow, mover deal) mutam o estado em memória, então os GETs
 * subsequentes (incluindo as invalidações do React Query) refletem a mudança —
 * exatamente como faria a API real. Isso permite asserções de ponta-a-ponta sem
 * acoplar a teste a timing de socket.
 */

import type { Page, Route, Request } from '@playwright/test';
import {
  AGENT_REPLY,
  CHANNEL,
  CONVERSATION,
  DASHBOARD,
  DEAL,
  INBOUND_MESSAGE,
  MANUAL_FLOW,
  ME,
  PIPELINE,
  STAGES,
  WINDOW_OPEN,
} from './seed';

type Json = Record<string, unknown>;

interface MockMessage {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  senderType: string;
  type: string;
  content: string | null;
  viewStatus: string;
  mediaUrl: string | null;
  createdAt: string;
}

interface MockDeal {
  id: string;
  stageId: string;
  [k: string]: unknown;
}

interface MockChannel {
  id: string;
  [k: string]: unknown;
}

/** Estado mutável da sessão de teste — uma instância por página. */
export interface MockState {
  channels: MockChannel[];
  messages: MockMessage[];
  deals: MockDeal[];
  /** Conta envios outbound do atendente para encadear a resposta do agente. */
  agentRepliedFor: Set<string>;
  /** Threads de suporte (F38) abertas durante o teste. */
  supportThreads: { id: string; subject: string; status: string; priority: string; assignedTo: string | null; lastMessageAt: string; createdAt: string }[];
}

function freshState(): MockState {
  return {
    channels: [{ ...CHANNEL }],
    // A API ordena por createdAt desc → a mais recente primeiro.
    messages: [{ ...INBOUND_MESSAGE }],
    deals: [{ ...DEAL }],
    agentRepliedFor: new Set<string>(),
    supportThreads: [],
  };
}

function json(route: Route, body: Json, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function parseBody(request: Request): Json {
  const raw = request.postData();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return {};
  }
}

/** Tira o `?qs` e devolve o pathname normalizado da rota proxiada. */
function pathOf(url: string): string {
  return new URL(url).pathname;
}

/**
 * Liga os mocks na página. Devolve o estado para asserções/avanço manual de
 * cenário (ex.: forçar a resposta do agente num ponto específico do teste).
 */
export async function installApiMocks(page: Page): Promise<MockState> {
  const state = freshState();

  // 1) socket.io: responde 200 vazio para o handshake não vazar erro de rede.
  //    O SocketProvider é resiliente a connect_error; a jornada não depende de
  //    push de socket (usa polling/optimistic), então o realtime fica inerte.
  await page.route('**/socket.io/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }),
  );

  // 2) Auth: login seta o cookie de sessão (httpOnly) e devolve o member.
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'set-cookie': `${'hm_session'}=e2e-token; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: JSON.stringify(ME),
    }),
  );
  await page.route('**/auth/**', (route) => json(route, { ok: true }));

  // 3) API: roteador único por pathname + método.
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = pathOf(request.url());

    // ── Sessão / identidade ──────────────────────────────────────────────
    if (path === '/api/me') return json(route, ME);

    // ── Dashboard ────────────────────────────────────────────────────────
    if (path === '/api/dashboard/me') return json(route, DASHBOARD);

    // ── Canais ───────────────────────────────────────────────────────────
    if (path === '/api/channels' && method === 'GET') {
      return json(route, { channels: state.channels });
    }
    if (path === '/api/channels/connect' && method === 'POST') {
      const body = parseBody(request);
      const created = {
        ...CHANNEL,
        id: `chan_new_${state.channels.length}`,
        name: typeof body['name'] === 'string' ? body['name'] : 'Novo canal',
        provider: typeof body['provider'] === 'string' ? body['provider'] : 'meta_whatsapp',
        isDefault: false,
      };
      state.channels.push(created);
      return json(route, { channel: created });
    }

    // ── Conversas / mensagens ────────────────────────────────────────────
    if (path === '/api/conversations' && method === 'GET') {
      return json(route, { conversations: [CONVERSATION] });
    }
    const msgMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(path);
    if (msgMatch) {
      const conversationId = msgMatch[1] ?? '';
      if (method === 'GET') {
        const ordered = [...state.messages].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        return json(route, { messages: ordered });
      }
      if (method === 'POST') {
        const body = parseBody(request);
        const sent: MockMessage = {
          id: `msg_sent_${state.messages.length}`,
          conversationId,
          direction: 'outbound',
          senderType: 'member',
          type: typeof body['type'] === 'string' ? body['type'] : 'text',
          content: typeof body['content'] === 'string' ? body['content'] : null,
          viewStatus: 'sent',
          mediaUrl: typeof body['mediaUrl'] === 'string' ? body['mediaUrl'] : null,
          createdAt: new Date().toISOString(),
        };
        state.messages.push(sent);

        // O "agente IA" responde de forma determinística uma vez por conversa.
        if (!state.agentRepliedFor.has(conversationId)) {
          state.agentRepliedFor.add(conversationId);
          state.messages.push({
            ...AGENT_REPLY,
            id: `msg_agent_${state.messages.length}`,
            createdAt: new Date(Date.now() + 1000).toISOString(),
          });
        }
        return json(route, { message: sent });
      }
    }
    const windowMatch = /^\/api\/conversations\/([^/]+)\/window$/.exec(path);
    if (windowMatch) return json(route, { window: WINDOW_OPEN });

    // ── Flows ────────────────────────────────────────────────────────────
    if (path === '/api/flows' && method === 'GET') {
      return json(route, { flows: [MANUAL_FLOW] });
    }
    if (path === '/api/flows/executions' && method === 'GET') {
      return json(route, { executions: [] });
    }
    const triggerMatch = /^\/api\/flows\/([^/]+)\/trigger$/.exec(path);
    if (triggerMatch && method === 'POST') {
      return json(route, { executionId: 'exec_e2e_1' });
    }

    // ── Pipeline / deals ─────────────────────────────────────────────────
    if (path === '/api/pipelines' && method === 'GET') {
      return json(route, { pipelines: [PIPELINE] });
    }
    const pipeDetail = /^\/api\/pipelines\/([^/]+)$/.exec(path);
    if (pipeDetail && method === 'GET') {
      return json(route, { pipeline: PIPELINE, stages: STAGES });
    }
    if (path === '/api/deals' && method === 'GET') {
      return json(route, { deals: state.deals });
    }
    const moveMatch = /^\/api\/deals\/([^/]+)\/move-stage$/.exec(path);
    if (moveMatch && method === 'POST') {
      const dealId = moveMatch[1] ?? '';
      const body = parseBody(request);
      const stageId = typeof body['stageId'] === 'string' ? body['stageId'] : '';
      const deal = state.deals.find((d) => d.id === dealId);
      if (deal && stageId) deal.stageId = stageId;
      return json(route, { deal: deal ?? { id: dealId, stageId } });
    }

    // ─── F38: Central de Ajuda (leitor) ────────────────────────────────────
    if (path === '/api/help/categories' && method === 'GET') {
      return json(route, {
        categories: [
          { id: 'cat_e2e_1', slug: 'primeiros-passos', title: 'Primeiros passos', description: 'Comece por aqui.', icon: null, order: 0, publishedCount: 1 },
        ],
      });
    }
    if (path === '/api/help/articles' && method === 'GET') {
      return json(route, {
        articles: [
          { id: 'art_e2e_1', categoryId: 'cat_e2e_1', slug: 'como-criar-um-agente', title: 'Como criar um agente', excerpt: 'Em poucos passos.', status: 'published', order: 0, anchorKey: 'agents.list' },
        ],
      });
    }
    if (path.startsWith('/api/help/articles/by-anchor/') && method === 'GET') {
      return json(route, {
        article: { id: 'art_e2e_1', categoryId: 'cat_e2e_1', slug: 'como-criar-um-agente', title: 'Como criar um agente', excerpt: 'Em poucos passos.', status: 'published', order: 0, anchorKey: 'agents.list', bodyMd: '## Passo a passo\n\nEscolha um **template**.', publishedAt: null, updatedAt: null },
      });
    }
    if (path.startsWith('/api/help/articles/') && method === 'GET') {
      return json(route, {
        article: { id: 'art_e2e_1', categoryId: 'cat_e2e_1', slug: 'como-criar-um-agente', title: 'Como criar um agente', excerpt: 'Em poucos passos.', status: 'published', order: 0, anchorKey: 'agents.list', bodyMd: '## Passo a passo\n\nEscolha um **template**.', publishedAt: null, updatedAt: null },
      });
    }
    if (path.endsWith('/feedback') && path.startsWith('/api/help/') && method === 'POST') {
      return json(route, { feedback: { ok: true } });
    }

    // ─── F38: Suporte (membro) ─────────────────────────────────────────────
    if (path === '/api/support/threads' && method === 'GET') {
      return json(route, { threads: state.supportThreads });
    }
    if (path === '/api/support/threads' && method === 'POST') {
      const body = parseBody(request) as { subject?: string; priority?: string; message?: string };
      const now = new Date().toISOString();
      const thread = { id: 'sup_e2e_' + (state.supportThreads.length + 1), subject: body.subject ?? 'Sem assunto', status: 'open', priority: body.priority ?? 'normal', assignedTo: null, lastMessageAt: now, createdAt: now };
      state.supportThreads.unshift(thread);
      return json(route, { thread, message: { id: 'msg_e2e_1', threadId: thread.id, senderType: 'member', senderId: 'mem_e2e', body: body.message ?? '', createdAt: now } }, 201);
    }
    if (path.startsWith('/api/support/threads/') && path.endsWith('/messages') && method === 'POST') {
      return json(route, { message: { id: 'msg_e2e_2', threadId: 'sup_e2e_1', senderType: 'member', senderId: 'mem_e2e', body: (parseBody(request) as { body?: string }).body ?? '', createdAt: new Date().toISOString() } }, 201);
    }
    if (path.startsWith('/api/support/threads/') && path.endsWith('/resolve') && method === 'POST') {
      const t = state.supportThreads[0];
      if (t) t.status = 'resolved';
      return json(route, { thread: t ?? { id: 'sup_e2e_1', status: 'resolved' } });
    }
    if (path.startsWith('/api/support/threads/') && method === 'GET') {
      const t = state.supportThreads[0] ?? { id: 'sup_e2e_1', subject: 'Ajuda', status: 'open', priority: 'normal', assignedTo: null, lastMessageAt: new Date().toISOString(), createdAt: new Date().toISOString() };
      return json(route, { thread: t, messages: [{ id: 'msg_e2e_1', threadId: t.id, senderType: 'member', senderId: 'mem_e2e', body: 'Preciso de ajuda', createdAt: new Date().toISOString() }] });
    }

    // ─── F38: Portal do Desenvolvedor (OpenAPI live) ───────────────────────
    if (path === '/api/v1/openapi.json' && method === 'GET') {
      return json(route, {
        openapi: '3.1.0',
        info: { title: 'Leadium API', version: '1.0.0', description: 'API publica v1 da Leadium.' },
        paths: {
          '/api/v1/contacts': { get: { summary: 'Lista contatos', description: 'Requer o scope `contacts:read`.' } },
          '/api/v1/deals': { get: { summary: 'Lista deals', description: 'Requer o scope `deals:read`.' } },
        },
      });
    }

    // Fallback: qualquer GET não modelado devolve um envelope vazio plausível,
    // para nenhum hook de UI quebrar com 404 e poluir o teste com erro de rede.
    if (method === 'GET') return json(route, {});
    return json(route, { ok: true });
  });

  return state;
}
