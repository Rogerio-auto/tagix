/**
 * F69-S02 — a conversa com a Graph na conexão.
 *
 * O que este arquivo protege: que o token de curta duração seja sempre trocado
 * pelo de longa duração (senão os leads param no dia seguinte), e que uma
 * permissão negada não esconda os ativos que as outras permitem ver.
 */
import { describe, expect, it } from 'vitest';
import { connectFromCode, fetchAssets, MetaConnectError, toLongLived, type GraphGet } from './connection';

const APP = { appId: 'app-1', appSecret: 'segredo' };
const agora = new Date('2026-09-14T12:00:00Z');

/** Graph falsa: responde pelo começo do caminho; o que não conhece falha como a Graph. */
function graphFalsa(rotas: Record<string, unknown>): GraphGet & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    get(path: string) {
      chamadas.push(path);
      const chave = Object.keys(rotas).find((k) => path.startsWith(k));
      if (chave === undefined) return Promise.reject(new Error(`sem rota: ${path}`));
      const v = rotas[chave];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    },
  };
}

describe('connectFromCode', () => {
  it('troca o código, pede o token longo e junta identidade, permissões e ativos', async () => {
    let trocas = 0;
    const graph: GraphGet = {
      get(path: string) {
        if (path.startsWith('oauth/access_token')) {
          trocas += 1;
          return Promise.resolve(
            path.includes('fb_exchange_token')
              ? { access_token: 'LONGO', expires_in: 5_184_000 }
              : { access_token: 'CURTO' },
          );
        }
        if (path.startsWith('me?')) return Promise.resolve({ id: 'asid-9', name: 'Ana' });
        if (path.startsWith('me/permissions')) {
          return Promise.resolve({ data: [{ permission: 'ads_read', status: 'granted' }] });
        }
        if (path.startsWith('me/accounts')) {
          return Promise.resolve({
            data: [{ id: 'pg1', name: 'Loja', instagram_business_account: { id: 'ig1', username: 'loja' } }],
          });
        }
        if (path.startsWith('me/adaccounts')) {
          return Promise.resolve({ data: [{ id: 'act_1', name: 'Conta', currency: 'USD' }] });
        }
        return Promise.reject(new Error(path));
      },
    };

    const s = await connectFromCode(graph, 'code-x', APP, agora);
    expect(trocas).toBe(2);
    expect(s.token).toBe('LONGO');
    expect(s.expiresAt?.toISOString()).toBe('2026-11-13T12:00:00.000Z');
    expect(s.metaUserId).toBe('asid-9');
    expect(s.granted).toEqual(['ads_read']);
    expect(s.assets.pages[0]).toEqual({ id: 'pg1', name: 'Loja', instagram: { id: 'ig1', username: 'loja' } });
    expect(s.assets.adAccounts[0]?.currency).toBe('USD');
  });

  it('troca falhando interrompe com erro de domínio', async () => {
    const graph = graphFalsa({ 'oauth/access_token': {} });
    await expect(connectFromCode(graph, 'x', APP, agora)).rejects.toBeInstanceOf(MetaConnectError);
  });
});

describe('toLongLived', () => {
  it('sem expires_in o token é tratado como sem expiração', async () => {
    const graph = graphFalsa({ 'oauth/access_token': { access_token: 'L' } });
    const r = await toLongLived(graph, 'c', APP, agora);
    expect(r.expiresAt).toBeNull();
  });
});

describe('fetchAssets', () => {
  it('sem permissão de anúncio, as páginas continuam aparecendo', async () => {
    const graph = graphFalsa({
      'me/accounts': { data: [{ id: 'pg1', name: 'Loja' }] },
      'me/adaccounts': new Error('(#200) permissão ausente'),
    });
    const a = await fetchAssets(graph, 't');
    expect(a.pages).toHaveLength(1);
    expect(a.pages[0]?.instagram).toBeNull();
    expect(a.adAccounts).toEqual([]);
  });

  it('itens malformados são ignorados', async () => {
    const graph = graphFalsa({
      'me/accounts': { data: [null, { name: 'sem id' }, { id: 'ok' }] },
      'me/adaccounts': { data: 'x' },
    });
    const a = await fetchAssets(graph, 't');
    expect(a.pages.map((p) => p.id)).toEqual(['ok']);
  });
});
