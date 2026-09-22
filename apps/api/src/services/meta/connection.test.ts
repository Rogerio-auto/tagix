/**
 * F69-S02 — a conversa com a Graph na conexão.
 *
 * O que este arquivo protege: que o token de curta duração seja sempre trocado
 * pelo de longa duração (senão os leads param no dia seguinte), e que uma
 * permissão negada não esconda os ativos que as outras permitem ver.
 *
 * F69-S12 acrescentou o bloco de `exchangeCode`: a troca do código e a `redirect_uri` que a Meta
 * exige.
 */
import { describe, expect, it, vi } from 'vitest';
import { MetaError } from '@hm/channels';
import {
  connectFromCode,
  exchangeCode,
  fetchAssets,
  MetaConnectError,
  toLongLived,
  type GraphGet,
} from './connection';

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
    // F69-S12: o caminho documentado (sem `redirect_uri`) é o que deve valer quando funciona.
    expect(s.exchange.redirectUriAceita).toBeNull();
    expect(s.exchange.tentativas).toHaveLength(1);
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

/**
 * F69-S12 — a troca do `code` e a `redirect_uri` que a Meta exige.
 *
 * O login da conexão vinha recusado com `100/36008` ("redirect_uri is identical…") mesmo seguindo o
 * exemplo da Meta (sem `redirect_uri`). Este bloco trava o comportamento da sonda que descobre a
 * candidata aceita:
 *
 * 1. tenta primeiro o caminho documentado (sem `redirect_uri`);
 * 2. só insiste quando a recusa é exatamente `36008` — token inválido ou instabilidade param na
 *    hora, porque cada chamada extra é mais uma chance de a Meta invalidar o código;
 * 3. devolve qual candidata funcionou, que é o que o log precisa para a lista colapsar depois.
 */
describe('exchangeCode', () => {
  function erro36008(): MetaError {
    return new MetaError(
      'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request',
      { httpStatus: 400, code: 100, subcode: 36008 },
    );
  }

  /** Graph falsa que só aceita uma `redirect_uri` (`null` = parâmetro ausente). */
  function graphQueAceita(aceita: string | null): { graph: GraphGet; chamadas: Array<string | null> } {
    const chamadas: Array<string | null> = [];
    const graph: GraphGet = {
      get: vi.fn((path: string) => {
        const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
        const recebida = query.has('redirect_uri') ? query.get('redirect_uri') : null;
        chamadas.push(recebida);
        if (recebida !== aceita) return Promise.reject(erro36008());
        return Promise.resolve({ access_token: 'token-curto' });
      }),
    };
    return { graph, chamadas };
  }

  const PAGINA = 'https://app.leadium.com.br/settings/meta';

  it('caminho documentado primeiro: sem redirect_uri, uma chamada só', async () => {
    const { graph, chamadas } = graphQueAceita(null);
    const r = await exchangeCode(graph, 'codigo', APP, { pageUrl: PAGINA });
    expect(r.token).toBe('token-curto');
    expect(r.redirectUriAceita).toBeNull();
    expect(chamadas).toEqual([null]);
  });

  it('recusado por 36008: tenta a URL da página e devolve qual foi aceita', async () => {
    const { graph, chamadas } = graphQueAceita(PAGINA);
    const r = await exchangeCode(graph, 'codigo', APP, { pageUrl: PAGINA });
    expect(r.token).toBe('token-curto');
    expect(r.redirectUriAceita).toBe(PAGINA);
    expect(chamadas).toEqual([null, PAGINA]);
    expect(r.tentativas.map((t) => t.ok)).toEqual([false, true]);
  });

  it('última candidata é a vazia', async () => {
    const { graph, chamadas } = graphQueAceita('');
    const r = await exchangeCode(graph, 'codigo', APP, { pageUrl: PAGINA });
    expect(r.redirectUriAceita).toBe('');
    expect(chamadas).toEqual([null, PAGINA, '']);
  });

  it('erro que NÃO é de redirect_uri para na primeira tentativa', async () => {
    const graph: GraphGet = {
      get: vi.fn(() =>
        Promise.reject(new MetaError('Error validating access token', { httpStatus: 400, code: 190 })),
      ),
    };
    await expect(exchangeCode(graph, 'codigo', APP, { pageUrl: PAGINA })).rejects.toMatchObject({ code: 190 });
    expect(graph.get).toHaveBeenCalledTimes(1);
  });

  it('sem a URL da página, tenta só o documentado e o vazio', async () => {
    const { graph, chamadas } = graphQueAceita('');
    await exchangeCode(graph, 'codigo', APP);
    expect(chamadas).toEqual([null, '']);
  });

  it('resposta sem token não é sucesso', async () => {
    const graph: GraphGet = { get: vi.fn(() => Promise.resolve({ nada: true })) };
    await expect(exchangeCode(graph, 'codigo', APP)).rejects.toBeInstanceOf(MetaConnectError);
  });

  it('cada tentativa é reportada para o log, com o código da Meta', async () => {
    const vistas: Array<{ redirectUri: string | null; ok: boolean; graphSubcode?: number }> = [];
    const { graph } = graphQueAceita('');
    await exchangeCode(graph, 'codigo', APP, {
      pageUrl: PAGINA,
      onAttempt: (t) => void vistas.push({ redirectUri: t.redirectUri, ok: t.ok, graphSubcode: t.graphSubcode }),
    });
    expect(vistas).toHaveLength(3);
    expect(vistas[0]).toMatchObject({ redirectUri: null, ok: false, graphSubcode: 36008 });
    expect(vistas[2]).toMatchObject({ redirectUri: '', ok: true });
  });
});
