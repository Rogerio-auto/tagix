import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { uuidParamGuard } from './uuid-params';

const UUID = '11111111-2222-4333-8444-555555555555';

/** Stub mínimo de Request/Response p/ exercitar o guard sem subir o Express.
 *  Por padrão simula uma sessão presente (cookie hm_session) — o guard só atua
 *  quando autenticado; passar `{ auth: false }` simula um request anônimo. */
function run(
  path: string,
  opts: { auth?: boolean } = {},
): { status: number | null; nexted: boolean; body: unknown } {
  const authed = opts.auth !== false;
  let status: number | null = null;
  let body: unknown = null;
  let nexted = false;
  const req = {
    path,
    headers: authed ? { cookie: 'hm_session=token-abc' } : {},
  } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    nexted = true;
  };
  uuidParamGuard(req, res, next);
  return { status, nexted, body };
}

describe('uuidParamGuard', () => {
  it('passa rotas fora de /api/*', () => {
    expect(run('/health').nexted).toBe(true);
    expect(run('/auth/login').nexted).toBe(true);
  });

  it('no-op sem sessão (deixa o requireAuth responder 401)', () => {
    const r = run('/api/deals/not-a-uuid', { auth: false });
    expect(r.nexted).toBe(true);
    expect(r.status).toBeNull();
  });

  it('passa /api/<coleção> sem id', () => {
    expect(run('/api/conversations').nexted).toBe(true);
    expect(run('/api/deals').nexted).toBe(true);
  });

  it('passa id-UUID válido em posição de :id', () => {
    expect(run(`/api/conversations/${UUID}`).nexted).toBe(true);
    expect(run(`/api/deals/${UUID}/history`).nexted).toBe(true);
    expect(run(`/api/knowledge/documents/${UUID}`).nexted).toBe(true);
    expect(run(`/api/availability/exceptions/${UUID}`).nexted).toBe(true);
    expect(run(`/api/dev/webhooks/${UUID}/deliveries`).nexted).toBe(true);
    expect(run(`/api/stages/${UUID}`).nexted).toBe(true);
  });

  it('404 em id malformado (não-UUID) em posição de :id', () => {
    for (const p of [
      '/api/conversations/not-a-uuid',
      '/api/conversations/not-a-uuid/messages',
      '/api/deals/123',
      '/api/agents/abc',
      '/api/flows/xyz',
      '/api/knowledge/documents/bad',
      '/api/availability/exceptions/bad',
      '/api/dev/webhooks/bad/deliveries',
      '/api/dev/api-keys/bad/revoke',
      '/api/stages/bad',
    ]) {
      const r = run(p);
      expect(r.nexted, p).toBe(false);
      expect(r.status, p).toBe(404);
    }
  });

  it('passa segmentos estáticos que ocupam a posição de :id', () => {
    for (const p of [
      '/api/agents/models',
      '/api/agents/tools',
      '/api/agents/templates',
      '/api/flows/executions',
      '/api/flows/manual-order',
      '/api/conversations/routing-targets',
      '/api/contacts/bulk-opt-in',
      '/api/stages/reorder',
      '/api/members/me',
      '/api/members/me/sessions/current',
      // /api/channels/* — sub-rotas literais do wizard de conexão Meta (não :id).
      '/api/channels/connect',
      '/api/channels/whatsapp/connect',
      '/api/channels/instagram/accounts',
      '/api/channels/instagram/connect',
    ]) {
      expect(run(p).nexted, p).toBe(true);
    }
  });

  it('não valida coleções desconhecidas (deixa o roteamento decidir)', () => {
    expect(run('/api/dashboard/metrics/conversoes_por_tipo').nexted).toBe(true);
    expect(run('/api/platform/tenants/not-a-uuid').nexted).toBe(true);
    expect(run('/api/sla').nexted).toBe(true);
  });

  it('é determinístico (sem efeitos colaterais entre chamadas)', () => {
    const spy = vi.fn();
    expect(spy).not.toHaveBeenCalled();
    expect(run(`/api/deals/${UUID}`).nexted).toBe(true);
    expect(run('/api/deals/bad').status).toBe(404);
    expect(run(`/api/deals/${UUID}`).nexted).toBe(true);
  });
});
