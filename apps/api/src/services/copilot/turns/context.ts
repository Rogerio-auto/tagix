/**
 * Contexto de página do Copiloto (COPILOTO.md §5.1; R3): DICA, não autorização.
 *
 * O navegador diz o que a pessoa está vendo (`CopilotPageContextSchema`, `.strict()` já
 * aplicado na borda). Aqui cada id é RE-RESOLVIDO sob RLS + escopo do membro
 * (`resolveVisible`, o mesmo predicado das telas): id de outro workspace, inexistente ou
 * invisível some EM SILÊNCIO (sem erro que vire oráculo). O rótulo do chip e o resumo que o
 * modelo lê saem do banco, nunca do texto que o cliente mandou.
 *
 * Os rótulos são nomes de negócio (título do negócio, nome do contato). Nome de contato pode
 * ter sido escrito pelo próprio contato (perfil do WhatsApp): por isso é limpo de controles,
 * cortado e entra no resumo entre aspas, como dado.
 */
import type { CopilotJsonObject, DbTx } from '@hm/db';
import { PAGE_CONTEXT_SELECTION_MAX, type CopilotPageContext } from '@hm/shared';
import type { CopilotPrincipal } from '../identity/principal';
import { resolveVisible, type CopilotEntityType, type VisibleEntity } from '../identity/scope';

export interface ResolvedPageContext {
  /** `page_context_resolved.label` do pedido ao runtime (sempre preenchido). */
  readonly label: string;
  /** `page_context_resolved.entity_summary`: o que está na tela, com ids para as ferramentas. */
  readonly entitySummary?: string;
  /** `turn_started.context_label` ("Vendo: Maria Souza · Alinhadores"); `null` sem contexto visível. */
  readonly chipLabel: string | null;
  /** O que fica gravado (mensagem e sessão): só o que o membro vê. `null` sem contexto. */
  readonly stored: CopilotJsonObject | null;
}

const LABEL_MAX = 160;
const SUMMARY_MAX = 1000;
/** Ids da seleção citados no resumo (o resto vira "+N"); o resumo tem 1.000 caracteres. */
const SUMMARY_IDS_MAX = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Valores livres de filtro que entram no resumo (status, período). */
const FILTER_VALUE_RE = /^[A-Za-z0-9_.:-]{1,32}$/;

/** Rótulo da tela pelo 1º segmento do padrão de rota. Desconhecida = "Tela atual". */
const ROUTE_LABELS: Readonly<Record<string, string>> = {
  hoje: 'Hoje',
  dashboard: 'Painel',
  pipeline: 'Pipeline',
  deals: 'Negócios',
  conversations: 'Conversas',
  inbox: 'Conversas',
  contacts: 'Contatos',
  calendar: 'Agenda',
  agenda: 'Agenda',
  campaigns: 'Campanhas',
  flows: 'Fluxos',
  agents: 'Agentes',
  reports: 'Relatórios',
  settings: 'Configurações',
  copilot: 'Copiloto',
};

const ENTITY_NOUNS: Readonly<Record<CopilotEntityType, readonly [string, string]>> = {
  deal: ['negócio', 'negócios'],
  contact: ['contato', 'contatos'],
  conversation: ['conversa', 'conversas'],
  campaign: ['campanha', 'campanhas'],
  event: ['compromisso', 'compromissos'],
  pipeline: ['pipeline', 'pipelines'],
  stage: ['estágio', 'estágios'],
};

function clean(text: string, max: number): string {
  const flat = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = Array.from(flat);
  return letters.length > max ? `${letters.slice(0, max - 1).join('')}…` : flat;
}

/** Aspas internas viram simples: o rótulo fica delimitado no resumo. */
function quoted(label: string): string {
  return `"${label.replace(/"/g, "'")}"`;
}

export function routeLabelFor(route: string): string {
  const first = route.split('/').find((segment) => segment.length > 0) ?? '';
  return ROUTE_LABELS[first.toLowerCase()] ?? 'Tela atual';
}

function nounFor(type: CopilotEntityType, count: number): string {
  const [one, many] = ENTITY_NOUNS[type];
  return count === 1 ? one : many;
}

async function visible(
  tx: DbTx,
  principal: CopilotPrincipal,
  type: CopilotEntityType,
  id: string,
): Promise<VisibleEntity | null> {
  return UUID_RE.test(id) ? resolveVisible(tx, principal, { type, id }) : null;
}

/**
 * Re-resolve o contexto. Custo: 1 query por id (entidade + seleção ≤ 50 + 2 filtros), no
 * `tx` do turno. Ids repetidos na seleção contam uma vez.
 */
export async function resolvePageContext(
  tx: DbTx,
  principal: CopilotPrincipal,
  context: CopilotPageContext | undefined,
): Promise<ResolvedPageContext> {
  if (!context) return { label: 'Sem tela aberta', chipLabel: null, stored: null };

  const routeLabel = routeLabelFor(context.route);
  const summary: string[] = [`Tela: ${routeLabel} (${clean(context.route, 120)}).`];
  const stored: CopilotJsonObject = { route: context.route };
  if (context.view) stored['view'] = context.view;

  const entity = context.entity
    ? await visible(tx, principal, context.entity.type, context.entity.id)
    : null;
  if (entity) {
    stored['entity'] = { type: entity.type, id: entity.id };
    summary.push(
      `Aberto na tela: ${nounFor(entity.type, 1)} ${quoted(clean(entity.label, 120))} (id ${entity.id}).`,
    );
  }

  const selected: VisibleEntity[] = [];
  if (context.selection) {
    const ids = [...new Set(context.selection.ids.map((id) => id.toLowerCase()))].slice(
      0,
      PAGE_CONTEXT_SELECTION_MAX,
    );
    for (const id of ids) {
      const row = await visible(tx, principal, context.selection.type, id);
      if (row) selected.push(row);
    }
    if (selected.length > 0) {
      const type = context.selection.type;
      stored['selection'] = { type, ids: selected.map((s) => s.id) };
      const cited = selected
        .slice(0, SUMMARY_IDS_MAX)
        .map((s) => s.id)
        .join(', ');
      const rest =
        selected.length > SUMMARY_IDS_MAX ? ` +${selected.length - SUMMARY_IDS_MAX}` : '';
      summary.push(
        `Selecionados: ${selected.length} ${nounFor(type, selected.length)} (ids ${cited}${rest}).`,
      );
    }
  }

  const filters: CopilotJsonObject = {};
  const filterParts: string[] = [];
  let pipeline: VisibleEntity | null = null;
  if (context.filters?.pipelineId) {
    pipeline = await visible(tx, principal, 'pipeline', context.filters.pipelineId);
    if (pipeline) {
      filters['pipelineId'] = pipeline.id;
      filterParts.push(`pipeline ${quoted(clean(pipeline.label, 80))} (id ${pipeline.id})`);
    }
  }
  if (context.filters?.stageId) {
    const stage = await visible(tx, principal, 'stage', context.filters.stageId);
    if (stage) {
      filters['stageId'] = stage.id;
      filterParts.push(`estágio ${quoted(clean(stage.label, 80))} (id ${stage.id})`);
    }
  }
  for (const key of ['status', 'period'] as const) {
    const value = context.filters?.[key];
    if (value !== undefined && FILTER_VALUE_RE.test(value)) {
      filters[key] = value;
      filterParts.push(`${key === 'status' ? 'status' : 'período'} ${value}`);
    }
  }
  if (filterParts.length > 0) {
    stored['filters'] = filters;
    summary.push(`Filtros: ${filterParts.join('; ')}.`);
  }

  // Chip: a coisa mais específica que o membro vê.
  let chip: string | null = null;
  if (entity) chip = clean(entity.label, 120);
  else if (selected.length > 0 && context.selection) {
    const type = context.selection.type;
    chip = `${selected.length} ${nounFor(type, selected.length)} ${type === 'conversation' ? 'selecionadas' : 'selecionados'}`;
    if (selected.length === 1 && selected[0]) chip = clean(selected[0].label, 120);
  } else if (pipeline) chip = clean(pipeline.label, 120);

  const label = clean(chip ? `${routeLabel} · ${chip}` : routeLabel, LABEL_MAX);
  const entitySummary = clean(summary.join(' '), SUMMARY_MAX);
  return {
    label,
    ...(summary.length > 1 ? { entitySummary } : {}),
    chipLabel: chip ? clean(`Vendo: ${chip}`, LABEL_MAX) : null,
    stored,
  };
}
