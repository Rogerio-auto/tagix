import type { NextFunction, Request, Response } from 'express';
import { readToken } from '../auth/session';

/**
 * Guard de path-params UUID (route-audit / robustez de borda).
 *
 * Vários endpoints `/api/.../:id` consultam direto `eq(table.id, raw)`. Quando o
 * cliente manda um id que NÃO é um UUID válido (ex. `/api/deals/not-a-uuid`), o
 * Postgres rejeita com `invalid input syntax for type uuid`, que sobe como uma
 * exceção não tratada → **500** (erro de servidor para um input do cliente). Em
 * dev o handler central ainda anexa SQL/params no corpo, o que piora o sinal.
 *
 * Este middleware roda ANTES das rotas e valida, de forma central, os segmentos
 * de path que ocupam uma posição de id-UUID conhecida. Um id malformado responde
 * **404** — coerente com o contrato de IDOR do resto da app (`assertConversationVisible`
 * e amigos respondem 404, sem confirmar a existência do recurso). Assim, um id
 * inválido é indistinguível de um id inexistente, e nunca vira 500.
 *
 * Precedência de auth: o guard SÓ atua quando há um token de sessão presente. Sem
 * cookie de sessão é no-op → o `requireAuth` de cada rota responde **401** antes de
 * qualquer leitura de id (contrato 401-first do app: anônimo nunca vê 404 de id).
 *
 * Carve-outs intencionais (segmentos que NÃO são UUID e devem passar):
 *   - `/api/members/me/sessions/:id` — o id pode ser o literal `current`.
 *   - `/api/dashboard/metrics/:key`  — `:key` é uma metric-key (`[a-z0-9_]`), não UUID.
 *   - `/api/agents/(models|tools|templates)` e `/api/flows/(executions|manual-order)` —
 *     são rotas estáticas que colidem com a forma `/coleção/:id`; por não serem UUID
 *     elas seguem normalmente para o handler estático correto.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coleções cujo segmento imediatamente seguinte é um id-UUID consultado no banco.
 * Mapeadas por prefixo de path. Só validamos o PRIMEIRO segmento após a coleção
 * (o `:id`); ids encadeados (`:tagId`, `:attId`, …) caem nos mesmos handlers, que
 * já 404'am quando não encontram — e não chegam aqui se o `:id` pai já barrou.
 */
const ID_AFTER = new Set<string>([
  'agents',
  'availability', // /api/availability/exceptions/:id — tratado pelo offset abaixo
  'calendars',
  'campaigns',
  'channels',
  'contacts',
  'conversations',
  'conversions',
  'conversion-types',
  'deals',
  'departments',
  'events',
  'flow-executions',
  'flows',
  'knowledge', // /api/knowledge/documents/:id — offset abaixo
  'members',
  'pipelines',
  'stages',
  'teams',
  'tags',
]);

/**
 * Coleções aninhadas (`/api/<a>/<b>/:id`) cujo id está no índice 3. Mapeia o par
 * `<a>/<b>` → true. Cobre os recursos sob `/api/dev/*`.
 */
const ID_AFTER_NESTED = new Set<string>([
  'dev/webhooks',
  'dev/api-keys',
]);

/**
 * Segmentos estáticos que ocupam a posição de `:id` mas são rotas literais (não
 * ids). Precisam passar direto — senão o guard 404'aria rotas válidas. Inclui os
 * literais de sessão (`me`/`current`) e cada sub-rota estática conhecida que colide
 * com a forma `/coleção/:id` (ex. `/api/agents/models`, `/api/flows/executions`).
 */
const NON_UUID_LITERALS = new Set<string>([
  'me',
  'current',
  // /api/channels/* — sub-rotas literais (NÃO são :id de canal): o wizard de
  // conexão Meta bate em /api/channels/connect, /api/channels/whatsapp/connect e
  // /api/channels/instagram/{accounts,connect}. Sem estes, o guard 404'ava o
  // connect inteiro para usuários autenticados (o guard só age com sessão).
  'connect',
  'whatsapp',
  'instagram',
  // /api/agents/*
  'models',
  'tools',
  'templates',
  // /api/contacts/*
  'bulk-opt-in',
  'bulk-opt-out',
  // /api/conversations/*
  'routing-targets',
  // /api/flows/*
  'executions',
  'manual-order',
  // /api/stages/*
  'reorder',
]);

/**
 * Resolve, a partir dos segmentos do path, a posição do candidato a id-UUID.
 * Retorna o valor a validar, ou `null` se não há posição de id-UUID neste path.
 */
function idCandidate(segments: readonly string[]): string | null {
  // segments: ['api', '<collection>', '<id?>', ...]
  if (segments[0] !== 'api') return null;
  const collection = segments[1];
  if (collection === undefined) return null;

  // /api/knowledge/documents/:id e /api/availability/exceptions/:id têm a coleção
  // real no índice 2; o id no índice 3.
  if (collection === 'knowledge' && segments[2] === 'documents') {
    return segments[3] ?? null;
  }
  if (collection === 'availability' && segments[2] === 'exceptions') {
    return segments[3] ?? null;
  }
  // Coleções aninhadas (/api/dev/webhooks/:id, /api/dev/api-keys/:id) — id no índice 3.
  const nestedKey = segments[2] !== undefined ? `${collection}/${segments[2]}` : '';
  if (ID_AFTER_NESTED.has(nestedKey)) {
    return segments[3] ?? null;
  }
  // /api/members/me/sessions/:id — id pode ser 'current'; cai no carve-out abaixo.
  if (!ID_AFTER.has(collection)) return null;
  return segments[2] ?? null;
}

export function uuidParamGuard(req: Request, res: Response, next: NextFunction): void {
  // Só nos importamos com a árvore /api/* (rotas internas autenticadas).
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  // Sem token de sessão → deixa o requireAuth da rota responder 401 (401-first).
  if (readToken(req) === null) {
    next();
    return;
  }
  const segments = req.path.split('/').filter((s) => s.length > 0);
  const candidate = idCandidate(segments);

  if (candidate === null || candidate.length === 0) {
    next();
    return;
  }
  // Literais conhecidos (me/current) e qualquer coisa já-UUID passam.
  if (NON_UUID_LITERALS.has(candidate) || UUID_RE.test(candidate)) {
    next();
    return;
  }
  // Segmento ocupa posição de id-UUID mas não é um UUID → 404 (não confirma recurso).
  res.status(404).json({ message: 'Recurso não encontrado.' });
}
