/**
 * Trava de origem da IA (F70-S07) — configurável por workspace (F70-S30).
 *
 * O número do dono pode ser pessoal: família e contatos antigos escrevem para o mesmo
 * WhatsApp que recebe os anúncios. Com a trava LIGADA (padrão, fail-closed), nenhum
 * caminho AUTOMÁTICO liga a IA numa conversa sem origem comprovada. Um número só
 * comercial desliga a trava e a origem deixa de importar.
 *
 * **Fonte única.** Este módulo é o único lugar que responde "a trava de origem deixa a
 * IA automática atender esta conversa?". Todos os caminhos consultam daqui:
 *
 *  - {@link aiOriginGateSql}: predicado SQL para o WHERE do UPDATE que liga a IA
 *    (flow `ai_action`, handoff de campanha, retomada, transferência). A configuração é
 *    lida por subselect DENTRO do próprio UPDATE: atômico, sem janela entre ler a
 *    configuração e ligar.
 *  - {@link workspaceRequiresProvenOriginSql}: a leitura da configuração, para quem
 *    precisa do valor numa leitura (o worker de agentes, no `loadContext`).
 *  - {@link passesAiOriginGate}: a mesma decisão em memória, sobre o valor lido pelo
 *    SQL acima (usada pelo `authorizeAiReply` do worker). Um teste contra o banco trava
 *    que ela e {@link aiOriginGateSql} concordam em toda a matriz.
 *
 * **Regra.** passa = trava desligada OU origem elegível. A elegibilidade é uma só —
 * `isAiEligibleOrigin` (`@hm/channels`) — e a leitura da coluna é fail-closed
 * (`normalizeConversationOrigin`, `@hm/shared`: NULL/desconhecido = `sem-origem`). A
 * marca humana (F70-S19/S23) é uma alternativa que cada caminho soma por `OR`; ela não
 * mora aqui porque cada caminho a trata de um jeito (retomada preserva, transferência
 * exige IA já `on`, worker compara as marcas).
 *
 * **Fail-closed da configuração.** Só o booleano `false` desliga a trava. Workspace que
 * o escopo RLS não enxerga, linha ausente ou valor não booleano contam como LIGADA.
 */
import { inArray, or, sql, type SQL } from 'drizzle-orm';
import { isAiEligibleOrigin, type ConversationOrigin } from '@hm/channels';
import { schema } from '@hm/db';
import {
  CONVERSATION_ORIGINS,
  normalizeConversationOrigin,
  type ConversationOriginValue,
} from '@hm/shared';

const { conversations, workspaces } = schema;

/**
 * Compile-time: o domínio persistido (`@hm/shared`) e o classificado
 * (`@hm/channels`) são o MESMO conjunto. Se alguém acrescentar uma origem de um lado
 * só, o build quebra aqui antes de a trava deixar passar (ou barrar) algo por engano.
 */
type SameOriginDomain = [ConversationOrigin] extends [ConversationOriginValue]
  ? [ConversationOriginValue] extends [ConversationOrigin]
    ? true
    : false
  : false;
const originDomainsMatch: SameOriginDomain = true;
void originDomainsMatch;

/** Origens com que a IA pode ser ligada automaticamente quando a trava está ligada. */
export const AI_ELIGIBLE_CONVERSATION_ORIGINS: readonly ConversationOriginValue[] =
  CONVERSATION_ORIGINS.filter((o) => isAiEligibleOrigin(o));

/** A conversa com esta `origin` (valor cru do banco) é de origem comprovada? */
export function isConversationAiEligible(rawOrigin: unknown): boolean {
  return isAiEligibleOrigin(normalizeConversationOrigin(rawOrigin));
}

/** Valor da configuração quando o workspace nunca a gravou (a coluna nasce com ele). */
export const AI_REQUIRES_PROVEN_ORIGIN_DEFAULT = true;

/**
 * Configuração do workspace da conversa (`workspaces.ai_requires_proven_origin`), para
 * usar em query sobre `conversations`. Fail-closed: workspace invisível no escopo RLS ou
 * inexistente → `true` (o `coalesce`).
 */
export function workspaceRequiresProvenOriginSql(): SQL<boolean> {
  return sql<boolean>`coalesce((select ${workspaces.aiRequiresProvenOrigin} from ${workspaces} where ${workspaces.id} = ${conversations.workspaceId}), true)`;
}

/**
 * Predicado da trava para o WHERE de um UPDATE/SELECT em `conversations`: a trava do
 * workspace está desligada OU a origem da conversa é elegível. NULL em `origin` não está
 * no IN, então conversa sem origem gravada só passa com a trava desligada.
 *
 * Sempre booleano (nunca NULL): `origin IN (...)` com `origin` NULL é NULL na lógica de
 * três valores, e `NULL OR false` também. No WHERE isso já barraria, mas lido como valor
 * (SELECT) viraria `null`; o `coalesce` fecha o predicado em `false`.
 */
export function aiOriginGateSql(): SQL<boolean> {
  const gate = or(
    inArray(conversations.origin, [...AI_ELIGIBLE_CONVERSATION_ORIGINS]),
    sql`not ${workspaceRequiresProvenOriginSql()}`,
  );
  // `or` só devolve undefined sem argumentos; aqui há dois.
  if (gate === undefined) throw new Error('aiOriginGateSql: predicado vazio');
  return sql<boolean>`coalesce((${gate}), false)`;
}

/** Entrada da decisão em memória: valores CRUS lidos do banco. */
export interface AiOriginGateInput {
  /** `workspaces.ai_requires_proven_origin`. Só o booleano `false` desliga a trava. */
  readonly requiresProvenOrigin: unknown;
  /** `conversations.origin` cru. */
  readonly origin: unknown;
}

/** Mesma decisão de {@link aiOriginGateSql}, sobre valores já lidos. */
export function passesAiOriginGate(input: AiOriginGateInput): boolean {
  return input.requiresProvenOrigin === false || isConversationAiEligible(input.origin);
}
