/**
 * Leitura dos leads na Meta (F69-S03).
 *
 * ## Por que o token de página
 *
 * A conexão guarda o token do **usuário** (F69-S02). A leitura de lead e do cadastro
 * do formulário é feita com o token da **página**, derivado dele: é o token que a
 * Meta documenta para Lead Ads e o que continua valendo quando a pessoa que conectou
 * é administradora da página, mas não anunciante. O token de página é pedido uma vez
 * e guardado em memória por pouco tempo — nunca no banco, nunca em log.
 */
import type { GraphClient } from '@hm/channels';
import {
  FORM_DISCLAIMER_FIELDS,
  LEAD_FIELDS,
  parseFormDisclaimer,
  parseLead,
  type FormDisclaimer,
  type ParsedLead,
} from '@hm/channels';
import type { LeadSource } from './ports';

type GraphGet = Pick<GraphClient, 'get'>;

/** Dez minutos: cobre uma rajada de leads sem segurar token revogado por muito tempo. */
const PAGE_TOKEN_TTL_MS = 10 * 60 * 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class GraphPageTokens {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly graph: GraphGet,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Token da página a partir do token do usuário.
   *
   * A chave inclui o token do usuário (por hash implícito do Map, em memória): se a
   * conexão for refeita com outro usuário, o token antigo não é reaproveitado.
   */
  async forPage(userToken: string, pageId: string): Promise<string> {
    const chave = `${pageId}:${userToken}`;
    const guardado = this.cache.get(chave);
    const agora = this.clock();
    if (guardado !== undefined && guardado.expiresAt > agora) return guardado.token;

    const res = await this.graph.get(`${encodeURIComponent(pageId)}?fields=access_token`, userToken);
    const token = isRecord(res) && typeof res['access_token'] === 'string' ? res['access_token'] : null;
    if (token === null) {
      // Sem token de página = a pessoa não administra mais a página. Não adianta retry.
      throw new PageAccessError(pageId);
    }
    this.cache.set(chave, { token, expiresAt: agora + PAGE_TOKEN_TTL_MS });
    return token;
  }
}

/** A conexão não dá mais acesso à página. Falha definitiva: reconectar resolve, retry não. */
export class PageAccessError extends Error {
  constructor(readonly pageId: string) {
    super('A conexão Meta não tem mais acesso a esta página. Reconecte a Meta com a página marcada.');
    this.name = 'PageAccessError';
  }
}

export class GraphLeadSource implements LeadSource {
  constructor(
    private readonly graph: GraphGet,
    private readonly pageTokens: GraphPageTokens = new GraphPageTokens(graph),
  ) {}

  async fetchLead(input: {
    connectionToken: string;
    pageId: string;
    leadgenId: string;
  }): Promise<ParsedLead | null> {
    const token = await this.pageTokens.forPage(input.connectionToken, input.pageId);
    const res = await this.graph.get(
      `${encodeURIComponent(input.leadgenId)}?fields=${LEAD_FIELDS}`,
      token,
    );
    return parseLead(res);
  }

  async fetchDisclaimer(input: {
    connectionToken: string;
    pageId: string;
    formId: string;
  }): Promise<FormDisclaimer | null> {
    try {
      const token = await this.pageTokens.forPage(input.connectionToken, input.pageId);
      const res = await this.graph.get(
        `${encodeURIComponent(input.formId)}?fields=${encodeURIComponent(FORM_DISCLAIMER_FIELDS)}`,
        token,
      );
      return parseFormDisclaimer(res);
    } catch {
      return null;
    }
  }

  /**
   * Leads de uma página criados depois de `since` — para a reconciliação.
   *
   * Percorre os formulários da página e, em cada um, os leads com
   * `time_created > since`. Limitado por página de resultado para não transformar
   * uma conta com milhares de leads antigos numa varredura sem fim: a primeira
   * reconciliação olha só a janela recente (quem chama define `since`).
   */
  async listLeadIdsSince(input: {
    connectionToken: string;
    pageId: string;
    since: Date;
    maxPerForm?: number;
  }): Promise<Array<{ leadgenId: string; formId: string; adId: string | null }>> {
    const token = await this.pageTokens.forPage(input.connectionToken, input.pageId);
    const max = input.maxPerForm ?? 500;
    const formularios = await this.graph.get(
      `${encodeURIComponent(input.pageId)}/leadgen_forms?fields=id&limit=100`,
      token,
    );
    const ids = (isRecord(formularios) && Array.isArray(formularios['data']) ? formularios['data'] : [])
      .map((f) => (isRecord(f) && typeof f['id'] === 'string' ? f['id'] : null))
      .filter((x): x is string => x !== null);

    const filtro = encodeURIComponent(
      JSON.stringify([
        { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(input.since.getTime() / 1000) },
      ]),
    );
    const saida: Array<{ leadgenId: string; formId: string; adId: string | null }> = [];
    for (const formId of ids) {
      let caminho: string | null =
        `${encodeURIComponent(formId)}/leads?fields=id,ad_id&limit=100&filtering=${filtro}`;
      let lidos = 0;
      while (caminho !== null && lidos < max) {
        const pagina: unknown = await this.graph.get(caminho, token);
        const itens = isRecord(pagina) && Array.isArray(pagina['data']) ? pagina['data'] : [];
        for (const item of itens) {
          if (!isRecord(item) || typeof item['id'] !== 'string') continue;
          saida.push({
            leadgenId: item['id'],
            formId,
            adId: typeof item['ad_id'] === 'string' ? item['ad_id'] : null,
          });
          lidos += 1;
        }
        const paging = isRecord(pagina) ? pagina['paging'] : undefined;
        const proxima = isRecord(paging) && typeof paging['next'] === 'string' ? paging['next'] : null;
        caminho = itens.length > 0 ? proxima : null;
      }
    }
    return saida;
  }
}
