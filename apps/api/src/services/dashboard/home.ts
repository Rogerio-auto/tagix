/**
 * Carga da Home (F72-S04): as agregações contra o Postgres. O contrato e a projeção
 * por papel moram em `./home-model` (puro); aqui só se busca o que o escopo do papel
 * vai mostrar — nada de calcular receita da empresa para um AGENT e descartar depois.
 *
 * Toda query roda na `tx` que a rota recebe de `req.scoped` (RLS do workspace) E filtra
 * `workspace_id` explicitamente: defesa em profundidade e o prefixo dos índices.
 *
 * ## Speed-to-lead (definição)
 *
 * Por conversa criada na janela (exceto grupos):
 * - **âncora** = 1ª mensagem do contato (`inbound`, `sender_type='contact'`);
 * - **resposta** = 1ª mensagem de saída de um HUMANO (`member`) ou da IA (`agent`) a
 *   partir da âncora, que não tenha falhado no envio.
 *
 * Fica de fora, por decisão:
 * - saída `system` (campanha, flow, lembrete, quick-reply automático, API pública):
 *   boas-vindas automática não é resposta, e contá-la transformaria a métrica em
 *   vaidade;
 * - saída ANTES da âncora (prospecção/campanha que abriu a conversa): não respondeu
 *   ninguém — a contagem começa quando o lead fala;
 * - conversa sem resposta: não entra na mediana (não há duração), mas é contada em
 *   `sample.unanswered` para a mediana não esconder lead abandonado;
 * - conversa sem nenhuma mensagem do contato: não é lead esperando, não entra.
 *
 * O instante é `coalesce(provider_timestamp, created_at)`: o horário do provedor vence,
 * porque mensagem importada por sincronização de histórico tem `created_at` da
 * importação. Mediana, não média: um lead de madrugada não pode mover o número.
 *
 * ## Desempenho
 *
 * As duas janelas saem de UMA varredura (`FILTER`), e cada conversa resolve âncora e
 * resposta com `LIMIT 1` sobre `idx_messages_conversation_provider_ts` (sem N+1: são
 * laterais na mesma query). Contagens usam `idx_conv_events_workspace_occurred`,
 * `idx_conversations_ws_status_lastmsg`, `idx_messages_workspace_created` e o prefixo
 * `workspace_id` dos índices de deals/contatos. Toda a carga roda sob
 * `SET LOCAL statement_timeout` de 5s (`./viewer-scope`).
 *
 * ## SUPERVISOR: o que respeita a visibilidade da inbox (F30) e o que não
 *
 * Decisão (DASHBOARD.md §2.1/§2.5 + LIVECHAT_OPS §1):
 * - **Respeitam o predicado** (`buildVisibilityPredicate`): tudo que é por CONVERSA —
 *   "aguardando acima do SLA" e "mídia que falhou" (apontam para uma conversa
 *   específica: link para conversa invisível na inbox é vazamento) e o speed-to-lead
 *   (§2.1: `tempo_medio_primeira_resposta` do SUPERVISOR é "do team"). O SUPERVISOR
 *   vê o speed-to-lead dos departamentos que lidera, inclusive no período anterior.
 * - **Ficam no workspace**: receita e conversões (§2.5: `conversoes_workspace_mes` e
 *   `valor_convertido_workspace_mes` são ✅ para SUP), leads novos (contato não tem
 *   departamento; é o denominador da taxa de conversão do §2.5) e a jornada (funil
 *   leads → conversas → agendados → ganhos: recortar só um degrau quebraria o funil).
 *   São contagens agregadas, sem identidade de conversa.
 * - Para OWNER/ADMIN o predicado é `true` e nem entra na query.
 *
 * ## Receita: KPI e série são o MESMO conjunto
 *
 * `countedConversions` é a fonte única do filtro (workspace, não cancelada, janela
 * meio-aberta `[from, to)`). O KPI (`conversionPairs`) e a série diária (`revenueRows`)
 * usam o mesmo fragmento sobre a MESMA janela atual, então a soma da série é o KPI —
 * `fillRevenueSeries` só preenche dias vazios com 0, não descarta nem duplica dia.
 */
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import type { Role } from '@hm/shared';
import {
  buildHomePayload,
  canSeeChannelHealth,
  fillRevenueSeries,
  HOME_MEDIA_FAILED_DAYS,
  HOME_PERIOD_DAYS,
  HOME_STALLED_DEAL_DAYS,
  homeScopeForRole,
  homeWindows,
  resolveSlaMinutes,
  toFiniteNumber,
  type AttentionAggregates,
  type HomeJourney,
  type HomePayload,
  type HomePeriodDays,
  type Pair,
  type PersonalAggregates,
  type SpeedToLeadStats,
  type TimeWindow,
  type WorkspaceAggregates,
} from './home-model';
import { applyDashboardStatementTimeout, inboxVisibilityFor } from './viewer-scope';

const DAY_MS = 86_400_000;

/**
 * Recorte de conversas de uma query da Home. `memberId` = atribuídas ao membro (escopo
 * pessoal); `visibility` = predicado da inbox (F30) sobre a tabela `conversations`,
 * que por isso aparece SEM alias nas queries que o aplicam.
 */
export interface ConversationFilter {
  readonly memberId?: string | null;
  readonly visibility?: SQL | null;
}

function conversationFilterSql(filter: ConversationFilter | undefined): SQL {
  const parts: SQL[] = [];
  if (filter?.memberId) parts.push(sql`AND conversations.assigned_to = ${filter.memberId}`);
  if (filter?.visibility) parts.push(sql`AND ${filter.visibility}`);
  return sql.join(parts, sql` `);
}

export interface LoadHomeArgs {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly role: Role;
  readonly periodDays?: HomePeriodDays;
  readonly now?: Date;
}

const iso = (d: Date): string => d.toISOString();
const int = (raw: unknown): number => toFiniteNumber(raw) ?? 0;
const firstRow = <T>(rows: Iterable<T>): T | undefined => Array.from(rows)[0];

// ─── Speed-to-lead ───────────────────────────────────────────────────────────

/**
 * Speed-to-lead da janela atual e da anterior numa varredura só. `filter.memberId`
 * recorta as conversas atribuídas ao membro (escopo pessoal); `filter.visibility`, as
 * que a inbox mostra ao membro (SUPERVISOR — F30).
 */
export async function speedToLeadStats(
  tx: DbTx,
  workspaceId: string,
  windows: { readonly current: TimeWindow; readonly previous: TimeWindow },
  filter?: ConversationFilter,
): Promise<{ current: SpeedToLeadStats; previous: SpeedToLeadStats }> {
  const curFrom = iso(windows.current.from);
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH base AS (
      SELECT conversations.created_at >= ${curFrom}::timestamptz AS is_current,
             first_in.at AS lead_at,
             first_reply.at AS reply_at
      FROM conversations
      CROSS JOIN LATERAL (
        SELECT coalesce(m.provider_timestamp, m.created_at) AS at
        FROM messages m
        WHERE m.conversation_id = conversations.id
          AND m.workspace_id = conversations.workspace_id
          AND m.direction = 'inbound'
          AND m.sender_type = 'contact'
        ORDER BY coalesce(m.provider_timestamp, m.created_at) ASC
        LIMIT 1
      ) first_in
      LEFT JOIN LATERAL (
        SELECT coalesce(m.provider_timestamp, m.created_at) AS at
        FROM messages m
        WHERE m.conversation_id = conversations.id
          AND m.workspace_id = conversations.workspace_id
          AND m.direction = 'outbound'
          AND m.sender_type IN ('member', 'agent')
          AND m.view_status <> 'failed'
          AND coalesce(m.provider_timestamp, m.created_at) >= first_in.at
        ORDER BY coalesce(m.provider_timestamp, m.created_at) ASC
        LIMIT 1
      ) first_reply ON true
      WHERE conversations.workspace_id = ${workspaceId}
        AND conversations.kind <> 'group'
        AND conversations.created_at >= ${iso(windows.previous.from)}::timestamptz
        AND conversations.created_at < ${iso(windows.current.to)}::timestamptz
        ${conversationFilterSql(filter)}
    )
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reply_at - lead_at)))
        FILTER (WHERE is_current) AS cur_median,
      count(reply_at) FILTER (WHERE is_current) AS cur_answered,
      count(*) FILTER (WHERE is_current AND reply_at IS NULL) AS cur_unanswered,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reply_at - lead_at)))
        FILTER (WHERE NOT is_current) AS prev_median,
      count(reply_at) FILTER (WHERE NOT is_current) AS prev_answered,
      count(*) FILTER (WHERE NOT is_current AND reply_at IS NULL) AS prev_unanswered
    FROM base
  `);
  const r = firstRow(rows);
  const stats = (median: unknown, answered: unknown, unanswered: unknown): SpeedToLeadStats => {
    const m = toFiniteNumber(median);
    return {
      medianSeconds: m === null ? null : Math.round(m),
      answered: int(answered),
      unanswered: int(unanswered),
    };
  };
  return {
    current: stats(r?.['cur_median'], r?.['cur_answered'], r?.['cur_unanswered']),
    previous: stats(r?.['prev_median'], r?.['prev_answered'], r?.['prev_unanswered']),
  };
}

// ─── Escopo workspace ────────────────────────────────────────────────────────

/**
 * O conjunto de conversões que conta como receita/conversão na Home: do workspace, não
 * cancelada, `occurred_at` em `[from, to)`. FONTE ÚNICA do KPI e da série (ver cabeçalho):
 * mudar a regra aqui muda os dois juntos.
 */
function countedConversions(workspaceId: string, win: TimeWindow): SQL {
  return sql`conversion_events.workspace_id = ${workspaceId}
      AND conversion_events.cancelled_at IS NULL
      AND conversion_events.occurred_at >= ${iso(win.from)}::timestamptz
      AND conversion_events.occurred_at < ${iso(win.to)}::timestamptz`;
}

async function conversionPairs(
  tx: DbTx,
  workspaceId: string,
  windows: { readonly current: TimeWindow; readonly previous: TimeWindow },
): Promise<{ hasTypes: boolean; revenue: Pair; conversions: Pair }> {
  // Uma varredura para as duas janelas: cada linha cai em exatamente uma (FILTER com o
  // mesmo fragmento da série), então `cur_*` é `countedConversions(current)` exato.
  const inCurrent = countedConversions(workspaceId, windows.current);
  const inPrevious = countedConversions(workspaceId, windows.previous);
  const rows = await tx.execute<Record<string, unknown>>(sql`
    SELECT
      EXISTS (SELECT 1 FROM conversion_types t WHERE t.workspace_id = ${workspaceId}) AS has_types,
      count(*) FILTER (WHERE ${inCurrent}) AS cur_n,
      coalesce(sum(conversion_events.value_cents) FILTER (WHERE ${inCurrent}), 0) AS cur_v,
      count(*) FILTER (WHERE ${inPrevious}) AS prev_n,
      coalesce(sum(conversion_events.value_cents) FILTER (WHERE ${inPrevious}), 0) AS prev_v
    FROM conversion_events
    WHERE ${countedConversions(workspaceId, { from: windows.previous.from, to: windows.current.to })}
  `);
  const r = firstRow(rows);
  return {
    hasTypes: r?.['has_types'] === true,
    revenue: { current: int(r?.['cur_v']), previous: int(r?.['prev_v']) },
    conversions: { current: int(r?.['cur_n']), previous: int(r?.['prev_n']) },
  };
}

async function leadPairs(
  tx: DbTx,
  workspaceId: string,
  windows: { readonly current: TimeWindow; readonly previous: TimeWindow },
): Promise<Pair> {
  const curFrom = iso(windows.current.from);
  const rows = await tx.execute<Record<string, unknown>>(sql`
    SELECT
      count(*) FILTER (WHERE created_at >= ${curFrom}::timestamptz) AS cur,
      count(*) FILTER (WHERE created_at < ${curFrom}::timestamptz) AS prev
    FROM contacts
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND created_at >= ${iso(windows.previous.from)}::timestamptz
      AND created_at < ${iso(windows.current.to)}::timestamptz
  `);
  const r = firstRow(rows);
  return { current: int(r?.['cur']), previous: int(r?.['prev']) };
}

/** Jornada da janela atual: leads → conversas → agendados → ganhos. */
async function journeyCounts(
  tx: DbTx,
  workspaceId: string,
  win: TimeWindow,
  leads: number,
): Promise<HomeJourney> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    SELECT
      (SELECT count(*) FROM conversations c
        WHERE c.workspace_id = ${workspaceId}
          AND c.created_at >= ${iso(win.from)}::timestamptz
          AND c.created_at < ${iso(win.to)}::timestamptz) AS conversations,
      (SELECT count(*) FROM events ev
        WHERE ev.workspace_id = ${workspaceId}
          AND ev.status <> 'cancelled'
          AND ev.created_at >= ${iso(win.from)}::timestamptz
          AND ev.created_at < ${iso(win.to)}::timestamptz) AS booked,
      (SELECT count(*) FROM deals d
        WHERE d.workspace_id = ${workspaceId}
          AND d.closed_won = true
          AND d.closed_at >= ${iso(win.from)}::timestamptz
          AND d.closed_at < ${iso(win.to)}::timestamptz) AS won
  `);
  const r = firstRow(rows);
  return {
    leads,
    conversations: int(r?.['conversations']),
    booked: int(r?.['booked']),
    won: int(r?.['won']),
  };
}

/**
 * Receita por dia (UTC) da janela; os dias vazios são preenchidos na projeção pura.
 * Mesmo `countedConversions` e mesma janela do KPI: soma da série == KPI de receita.
 */
async function revenueRows(
  tx: DbTx,
  workspaceId: string,
  win: TimeWindow,
): Promise<{ day: string; valueCents: number }[]> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    SELECT to_char(date_trunc('day', conversion_events.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
           coalesce(sum(conversion_events.value_cents), 0) AS total
    FROM conversion_events
    WHERE ${countedConversions(workspaceId, win)}
    GROUP BY 1
  `);
  return Array.from(rows).map((r) => ({ day: String(r['day']), valueCents: int(r['total']) }));
}

async function loadWorkspaceAggregates(
  tx: DbTx,
  workspaceId: string,
  windows: { readonly current: TimeWindow; readonly previous: TimeWindow },
  visibility: SQL | null,
): Promise<WorkspaceAggregates> {
  const [conv, leads, stl] = await Promise.all([
    conversionPairs(tx, workspaceId, windows),
    leadPairs(tx, workspaceId, windows),
    // SUPERVISOR: só as conversas dos departamentos que lidera (ver cabeçalho).
    speedToLeadStats(tx, workspaceId, windows, { visibility }),
  ]);
  const [journey, series] = await Promise.all([
    journeyCounts(tx, workspaceId, windows.current, leads.current),
    conv.hasTypes ? revenueRows(tx, workspaceId, windows.current) : Promise.resolve(null),
  ]);
  return {
    hasConversionTypes: conv.hasTypes,
    revenueCents: conv.revenue,
    conversions: conv.conversions,
    leads,
    speedToLead: stl,
    journey,
    revenueSeries: series ? fillRevenueSeries(series, windows.current) : null,
  };
}

// ─── Escopo pessoal ──────────────────────────────────────────────────────────

async function loadPersonalAggregates(
  tx: DbTx,
  workspaceId: string,
  memberId: string,
  now: Date,
  windows: { readonly current: TimeWindow; readonly previous: TimeWindow },
): Promise<PersonalAggregates> {
  const { conversations } = schema;
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const [queue, stl] = await Promise.all([
    tx
      .select({
        open: count(sql`case when ${conversations.status} = 'open' then 1 end`),
        waiting: count(
          sql`case when ${conversations.status} = 'open'
                    and ${conversations.lastMessageFrom} = 'contact'
                    and ${conversations.snoozedUntil} is null then 1 end`,
        ),
        resolvedToday: count(
          sql`case when ${conversations.status} = 'resolved'
                    and ${conversations.resolvedAt} >= ${iso(startOfToday)}::timestamptz then 1 end`,
        ),
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.workspaceId, workspaceId),
          eq(conversations.assignedTo, memberId),
          sql`(${conversations.status} = 'open' or ${conversations.resolvedAt} >= ${iso(startOfToday)}::timestamptz)`,
        ),
      ),
    speedToLeadStats(tx, workspaceId, windows, { memberId }),
  ]);
  const q = queue[0];
  return {
    open: q?.open ?? 0,
    waiting: q?.waiting ?? 0,
    resolvedToday: q?.resolvedToday ?? 0,
    speedToLead: stl,
  };
}

// ─── Atenção ─────────────────────────────────────────────────────────────────

/** Regra de SLA ativa do workspace (escopo `workspace`), se houver. */
async function workspaceSlaFirstResponseSecs(
  tx: DbTx,
  workspaceId: string,
): Promise<number | null> {
  const { slaRules } = schema;
  const [row] = await tx
    .select({ secs: slaRules.firstResponseSecs })
    .from(slaRules)
    .where(
      and(
        eq(slaRules.workspaceId, workspaceId),
        eq(slaRules.scopeType, 'workspace'),
        eq(slaRules.isActive, 'active'),
      ),
    )
    .limit(1);
  return row?.secs ?? null;
}

async function attentionWaiting(
  tx: DbTx,
  workspaceId: string,
  filter: ConversationFilter,
  cutoff: Date,
): Promise<AttentionAggregates['waiting']> {
  // Mesma definição de "aguardando" da Hoje (`loadToday`), acima da régua de SLA, e o
  // mesmo recorte de visibilidade da inbox (F30).
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH w AS (
      SELECT conversations.id, conversations.last_message_at
      FROM conversations
      WHERE conversations.workspace_id = ${workspaceId}
        AND conversations.status = 'open'
        AND conversations.last_message_from = 'contact'
        AND conversations.last_message_at IS NOT NULL
        AND conversations.snoozed_until IS NULL
        AND conversations.last_message_at < ${iso(cutoff)}::timestamptz
        ${conversationFilterSql(filter)}
    )
    SELECT
      (SELECT count(*) FROM w) AS n,
      (SELECT w.id FROM w ORDER BY w.last_message_at ASC LIMIT 1) AS oldest_id,
      -- Epoch em ms, não timestamptz: o driver devolve data como texto no formato do
      -- PG, e parsear isso no JS é frágil.
      (SELECT EXTRACT(EPOCH FROM min(w.last_message_at)) * 1000 FROM w) AS oldest_ms
  `);
  const r = firstRow(rows);
  const oldestMs = toFiniteNumber(r?.['oldest_ms']);
  const id = r?.['oldest_id'];
  return {
    count: int(r?.['n']),
    oldestAt: oldestMs === null ? null : new Date(oldestMs),
    oldestConversationId: typeof id === 'string' ? id : null,
  };
}

async function attentionStalledDeals(
  tx: DbTx,
  workspaceId: string,
  memberId: string | null,
  cutoff: Date,
): Promise<AttentionAggregates['stalledDeals']> {
  const memberFilter = memberId ? sql`AND d.owner_id = ${memberId}` : sql``;
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH s AS (
      SELECT d.id, coalesce(d.updated_at, d.created_at) AS moved_at
      FROM deals d
      WHERE d.workspace_id = ${workspaceId}
        AND d.closed_at IS NULL
        AND coalesce(d.updated_at, d.created_at) < ${iso(cutoff)}::timestamptz
        ${memberFilter}
    )
    SELECT
      (SELECT count(*) FROM s) AS n,
      (SELECT s.id FROM s ORDER BY s.moved_at ASC LIMIT 1) AS oldest_id
  `);
  const r = firstRow(rows);
  const id = r?.['oldest_id'];
  return { count: int(r?.['n']), oldestDealId: typeof id === 'string' ? id : null };
}

/**
 * Canal caído = canal ATIVO sem credencial (`channel_secrets` apagado: desvinculado ou
 * revogado). Mais a conexão Meta (F69) ainda marcada ativa mas com o token vencido — a
 * integração parou sem ninguém ter pedido. Conexão `revoked` não entra: revogar é uma
 * escolha, e a tela da Meta já explica o que aconteceu. Status de sessão WAHA não é
 * persistido no modelo; não é inventado aqui.
 */
async function attentionChannelDown(
  tx: DbTx,
  workspaceId: string,
  now: Date,
): Promise<NonNullable<AttentionAggregates['channelDown']>> {
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH down AS (
      SELECT ch.id
      FROM channels ch
      WHERE ch.workspace_id = ${workspaceId}
        AND ch.is_active = true
        AND NOT EXISTS (SELECT 1 FROM channel_secrets s WHERE s.channel_id = ch.id)
    )
    SELECT
      (SELECT count(*) FROM down) AS n,
      (SELECT down.id FROM down LIMIT 1) AS any_id,
      EXISTS (
        SELECT 1 FROM meta_connections mc
        WHERE mc.workspace_id = ${workspaceId}
          AND mc.status = 'active'
          AND mc.token_expires_at IS NOT NULL
          AND mc.token_expires_at < ${iso(now)}::timestamptz
      ) AS meta_expired
  `);
  const r = firstRow(rows);
  const n = int(r?.['n']);
  const id = r?.['any_id'];
  return {
    count: n,
    onlyChannelId: n === 1 && typeof id === 'string' ? id : null,
    metaLoginExpired: r?.['meta_expired'] === true,
  };
}

/**
 * Mídia RECEBIDA que o worker não conseguiu baixar (`media_status='failed'`, F52): o
 * atendente não vê o que o lead mandou. Janela curta e índice `(workspace_id,
 * created_at)`. Falha de ENVIO de saída é outro problema (a tela de sincronização
 * cuida) e não se mistura aqui — a cópia da tela diz "ao baixar".
 */
async function attentionMediaFailed(
  tx: DbTx,
  workspaceId: string,
  filter: ConversationFilter,
  since: Date,
): Promise<AttentionAggregates['mediaFailed']> {
  // Recorte por conversa (pessoal e/ou visibilidade da inbox). O par `workspace_id`
  // amarra a conversa ao MESMO tenant da mensagem (defesa em profundidade além do RLS).
  const conversationScope =
    filter.memberId || filter.visibility
      ? sql`AND EXISTS (SELECT 1 FROM conversations
                        WHERE conversations.id = m.conversation_id
                          AND conversations.workspace_id = m.workspace_id
                          ${conversationFilterSql(filter)})`
      : sql``;
  const rows = await tx.execute<Record<string, unknown>>(sql`
    WITH f AS (
      SELECT m.conversation_id, m.created_at
      FROM messages m
      WHERE m.workspace_id = ${workspaceId}
        AND m.media_status = 'failed'
        AND m.deleted_at IS NULL
        AND m.created_at >= ${iso(since)}::timestamptz
        ${conversationScope}
    )
    SELECT
      (SELECT count(*) FROM f) AS n,
      (SELECT f.conversation_id FROM f ORDER BY f.created_at DESC LIMIT 1) AS latest_conversation_id
  `);
  const r = firstRow(rows);
  const id = r?.['latest_conversation_id'];
  return { count: int(r?.['n']), latestConversationId: typeof id === 'string' ? id : null };
}

// ─── Carga ───────────────────────────────────────────────────────────────────

export async function loadHome(tx: DbTx, args: LoadHomeArgs): Promise<HomePayload> {
  const now = args.now ?? new Date();
  const periodDays = args.periodDays ?? HOME_PERIOD_DAYS;
  const scope = homeScopeForRole(args.role);
  const windows = homeWindows(now, periodDays);
  const ws = args.workspaceId;
  const mine = scope === 'personal' ? args.memberId : null;
  // F30: conversa que a inbox esconde do membro não aparece (nem é linkada) na Home.
  const visibility = inboxVisibilityFor(args);
  const conversationFilter: ConversationFilter = { memberId: mine, visibility };

  await applyDashboardStatementTimeout(tx);
  const sla = resolveSlaMinutes(await workspaceSlaFirstResponseSecs(tx, ws));

  const [waiting, stalledDeals, channelDown, mediaFailed] = await Promise.all([
    attentionWaiting(tx, ws, conversationFilter, new Date(now.getTime() - sla.minutes * 60_000)),
    attentionStalledDeals(tx, ws, mine, new Date(now.getTime() - HOME_STALLED_DEAL_DAYS * DAY_MS)),
    canSeeChannelHealth(args.role) ? attentionChannelDown(tx, ws, now) : Promise.resolve(null),
    attentionMediaFailed(
      tx,
      ws,
      conversationFilter,
      new Date(now.getTime() - HOME_MEDIA_FAILED_DAYS * DAY_MS),
    ),
  ]);

  // Só se carrega o que o escopo do papel mostra.
  const workspace =
    scope === 'workspace' ? await loadWorkspaceAggregates(tx, ws, windows, visibility) : null;
  const personal =
    scope === 'personal' ? await loadPersonalAggregates(tx, ws, args.memberId, now, windows) : null;

  return buildHomePayload({
    role: args.role,
    now,
    periodDays,
    sla,
    workspace,
    personal,
    attention: { waiting, stalledDeals, channelDown, mediaFailed },
  });
}
