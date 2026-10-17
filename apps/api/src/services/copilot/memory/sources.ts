/**
 * Fontes da memória (F73-S11; A10): o que o Copiloto pode usar além do perfil e dos fatos.
 *
 * A v1 lista as fontes NATIVAS, com o estado lido das tabelas do próprio workspace:
 * Conhecimento, Produtos, Pipeline e Inbox. Integrações entram pela F75 por um seam:
 *
 *   const off = registerMemorySource({ key: 'erp', label: 'ERP', load: async ({ tx, workspaceId }) => [...] });
 *
 * O provider devolve uma ou mais `MemorySource` (validadas aqui; item inválido é descartado).
 * Provider que lança, ou que demora mais que o teto, vira uma linha `warn` — a tela de memória
 * nunca quebra por causa de uma integração.
 */
import { and, count, eq, isNull, max, sql } from 'drizzle-orm';
import { schema, type DbTx } from '@hm/db';
import { MemorySourceSchema, type MemorySource } from '@hm/shared';
import { formatDatePt } from './common';

export interface MemorySourceContext {
  /** Transação RLS do workspace (somente leitura para o provider). */
  readonly tx: DbTx;
  readonly workspaceId: string;
}

export interface MemorySourceProvider {
  /** Prefixo estável das fontes do provider (`^[a-z][a-z0-9_:-]{0,63}$`); único no processo. */
  readonly key: string;
  /** Nome exibido quando o provider falha. */
  readonly label: string;
  load(ctx: MemorySourceContext): Promise<readonly MemorySource[]> | readonly MemorySource[];
}

/** Teto de espera por provider externo. */
export const MEMORY_SOURCE_PROVIDER_TIMEOUT_MS = 2_000;

const NATIVE_KEYS: ReadonlySet<string> = new Set(['knowledge', 'products', 'pipeline', 'inbox']);
const providers = new Map<string, MemorySourceProvider>();

/** Registra uma fonte externa (F75). Devolve a função que a remove. */
export function registerMemorySource(provider: MemorySourceProvider): () => void {
  if (!MemorySourceSchema.shape.key.safeParse(provider.key).success) {
    throw new Error(`copilot memory source: key inválida '${provider.key}'.`);
  }
  if (NATIVE_KEYS.has(provider.key) || providers.has(provider.key)) {
    throw new Error(`copilot memory source: key repetida '${provider.key}'.`);
  }
  providers.set(provider.key, provider);
  return () => {
    if (providers.get(provider.key) === provider) providers.delete(provider.key);
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

async function knowledgeSource(ctx: MemorySourceContext): Promise<MemorySource> {
  const d = schema.kbDocuments;
  const [row] = await ctx.tx
    .select({ n: count(), last: max(sql<Date>`coalesce(${d.updatedAt}, ${d.createdAt})`) })
    .from(d)
    .where(and(eq(d.workspaceId, ctx.workspaceId), eq(d.status, 'active')));
  const n = row?.n ?? 0;
  if (n === 0) {
    return {
      key: 'knowledge',
      label: 'Conhecimento',
      status: 'warn',
      detail: 'Nenhum documento ativo ainda',
    };
  }
  const last = row?.last ? new Date(row.last) : null;
  const when =
    last && !Number.isNaN(last.getTime()) ? ` · atualizado em ${formatDatePt(last)}` : '';
  return {
    key: 'knowledge',
    label: 'Conhecimento',
    status: 'ok',
    detail: `${plural(n, 'documento', 'documentos')}${when}`,
  };
}

async function productsSource(ctx: MemorySourceContext): Promise<MemorySource> {
  const p = schema.products;
  const [row] = await ctx.tx
    .select({ n: count() })
    .from(p)
    .where(and(eq(p.workspaceId, ctx.workspaceId), isNull(p.deletedAt), eq(p.active, true)));
  const n = row?.n ?? 0;
  if (n === 0) {
    return {
      key: 'products',
      label: 'Produtos',
      status: 'warn',
      detail: 'Nenhum produto ativo no catálogo',
    };
  }
  return {
    key: 'products',
    label: 'Produtos',
    status: 'ok',
    detail: `${plural(n, 'produto', 'produtos')} no catálogo`,
  };
}

async function pipelineSource(ctx: MemorySourceContext): Promise<MemorySource> {
  const pl = schema.pipelines;
  const st = schema.stages;
  const pipelines = await ctx.tx
    .select({ id: pl.id, name: pl.name, isDefault: pl.isDefault })
    .from(pl)
    .where(and(eq(pl.workspaceId, ctx.workspaceId), eq(pl.isActive, true)))
    .orderBy(sql`${pl.isDefault} desc`, pl.createdAt);
  const first = pipelines[0];
  if (!first) {
    return { key: 'pipeline', label: 'Pipeline', status: 'warn', detail: 'Nenhum funil ativo' };
  }
  const [stages] = await ctx.tx
    .select({ n: count() })
    .from(st)
    .where(and(eq(st.workspaceId, ctx.workspaceId), eq(st.pipelineId, first.id)));
  const extra =
    pipelines.length > 1 ? ` · mais ${plural(pipelines.length - 1, 'funil', 'funis')}` : '';
  return {
    key: 'pipeline',
    label: 'Pipeline',
    status: 'ok',
    detail: `${first.name.slice(0, 80)} · ${plural(stages?.n ?? 0, 'estágio', 'estágios')}${extra}`,
  };
}

async function inboxSource(ctx: MemorySourceContext): Promise<MemorySource> {
  const c = schema.channels;
  const rows = await ctx.tx
    .select({ active: c.isActive, n: count() })
    .from(c)
    .where(eq(c.workspaceId, ctx.workspaceId))
    .groupBy(c.isActive);
  const active = rows.find((r) => r.active)?.n ?? 0;
  const inactive = rows.find((r) => !r.active)?.n ?? 0;
  if (active === 0 && inactive === 0) {
    return { key: 'inbox', label: 'Inbox', status: 'warn', detail: 'Nenhum canal conectado' };
  }
  if (active === 0) {
    return {
      key: 'inbox',
      label: 'Inbox',
      status: 'danger',
      detail: `${plural(inactive, 'canal inativo', 'canais inativos')}, nenhum ativo`,
    };
  }
  return {
    key: 'inbox',
    label: 'Inbox',
    status: inactive > 0 ? 'warn' : 'ok',
    detail:
      `${plural(active, 'canal ativo', 'canais ativos')}` +
      (inactive > 0 ? ` · ${plural(inactive, 'inativo', 'inativos')}` : ''),
  };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('memory source timeout')), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadProvider(
  provider: MemorySourceProvider,
  ctx: MemorySourceContext,
): Promise<MemorySource[]> {
  try {
    const raw = await withTimeout(
      Promise.resolve(provider.load(ctx)),
      MEMORY_SOURCE_PROVIDER_TIMEOUT_MS,
    );
    const out: MemorySource[] = [];
    for (const item of raw) {
      const parsed = MemorySourceSchema.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [
      {
        key: provider.key,
        label: provider.label.slice(0, 120),
        status: 'warn',
        detail: 'Não consegui ler esta fonte agora',
      },
    ];
  }
}

/** Fontes nativas (com o estado real do workspace) + as externas registradas. */
export async function listMemorySources(tx: DbTx, workspaceId: string): Promise<MemorySource[]> {
  const ctx: MemorySourceContext = { tx, workspaceId };
  const native = [
    await knowledgeSource(ctx),
    await productsSource(ctx),
    await pipelineSource(ctx),
    await inboxSource(ctx),
  ];
  // Providers externos rodam em série: compartilham a transação (o driver não paraleliza nela).
  const external: MemorySource[] = [];
  for (const provider of providers.values()) {
    external.push(...(await loadProvider(provider, ctx)));
  }
  return [...native, ...external].map((s) => MemorySourceSchema.parse(s));
}
