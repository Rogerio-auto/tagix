'use client';

/**
 * Drawer lateral de drill-down (DASHBOARD §4 — drawer no lugar de modal full-screen,
 * UX §2.3). Abre sobre o dashboard mostrando o detalhe da métrica
 * (`GET /dashboard/metrics/:key`). Se a métrica não tem detalhe próprio (204), o
 * card já navega via Link e este drawer nem é acionado.
 *
 * Usa o `Sheet` compartilhado (mesma base dos detalhes de KB/flows).
 */
import { useState } from 'react';
import Link from 'next/link';
import { Sheet } from '@/shared/components/help/Sheet';
import { SkeletonList } from '@/shared/components/feedback';
import { useMetricDetail } from './queries';
import type { DashboardCard, TableColumn } from './types';
import { readTableValue } from './types';
import { formatInt, formatTableCell, objectionCategoryLabel } from './format';

interface DrillDownDrawerProps {
  card: DashboardCard | null;
  onClose: () => void;
}

export function DrillDownDrawer({ card, onClose }: DrillDownDrawerProps) {
  const detail = useMetricDetail(card?.key ?? null);

  return (
    <Sheet open={card !== null} onClose={onClose} title={card?.label ?? ''} widthClass="w-[480px]">
      <div className="p-5">
        {detail.isLoading && <SkeletonList rows={5} />}
        {detail.isError && (
          <p className="font-body text-sm text-text-low">Não foi possível carregar o detalhe.</p>
        )}
        {detail.data &&
          (card?.key === 'objecoes_rankeadas' ? (
            <ObjectionsDrillBody detail={detail.data.detail} />
          ) : (
            <DetailBody metricKey={detail.data.metricKey} detail={detail.data.detail} />
          ))}
      </div>
    </Sheet>
  );
}

/**
 * Link de drill-down por linha de ranking/performance: navega para a lista filtrada
 * pela entidade da linha (§4 — todo número tem destino). Sem link para linhas sem id.
 */
function rowHref(metricKey: string, row: Record<string, unknown>): string | null {
  const memberId = typeof row['memberId'] === 'string' ? row['memberId'] : null;
  const agentId = typeof row['agentId'] === 'string' ? row['agentId'] : null;
  if (metricKey === 'performance_por_atendente' && memberId) {
    return `/conversations?assigned_to=${memberId}`;
  }
  if (metricKey === 'conversoes_por_atendente_humano' && memberId) {
    return `/conversions?member_id=${memberId}&period=mes`;
  }
  if (metricKey === 'conversoes_por_agente_ia' && agentId) {
    return `/conversions?agent_id=${agentId}&period=mes`;
  }
  return null;
}

/** Tabela column-aware no drawer: cabeçalho + linhas completas, com link por linha. */
function ColumnAwareTable({
  metricKey,
  columns,
  rows,
}: {
  metricKey: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-2">
          {columns.map((col) => (
            <th
              key={col.key}
              scope="col"
              className={
                'pb-2 font-body text-xs font-medium uppercase tracking-wide text-text-low ' +
                (col.align === 'right' ? 'text-right' : 'text-left')
              }
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const href = rowHref(metricKey, r);
          return (
            <tr key={i} className="border-b border-border last:border-0">
              {columns.map((col, ci) => {
                const content = formatTableCell(col.key, r[col.key]);
                const cellCls =
                  'py-2 ' +
                  (col.align === 'right' ? 'text-right font-price text-text' : 'font-body text-text-mid');
                if (ci === 0 && href) {
                  return (
                    <td key={col.key} className={cellCls}>
                      <Link href={href} className="text-text hover:text-brand-bright">
                        {content}
                      </Link>
                    </td>
                  );
                }
                return (
                  <td key={col.key} className={cellCls}>
                    {content}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Renderização genérica do detalhe (série/tabela) sem assumir uma métrica única. */
function DetailBody({ metricKey, detail }: { metricKey: string; detail: Record<string, unknown> }) {
  // Onda A: contrato column-aware { columns, rows } tem prioridade.
  const table = readTableValue(detail);
  if (table) {
    if (table.rows.length === 0) {
      return <p className="font-body text-sm text-text-low">Sem dados no período.</p>;
    }
    return <ColumnAwareTable metricKey={metricKey} columns={table.columns} rows={table.rows} />;
  }

  const series = Array.isArray(detail['series']) ? (detail['series'] as Record<string, unknown>[]) : null;
  const byType = Array.isArray(detail['byType']) ? (detail['byType'] as Record<string, unknown>[]) : null;
  const rows = Array.isArray(detail['rows']) ? (detail['rows'] as Record<string, unknown>[]) : null;
  const list = series ?? byType ?? rows;

  if (!list || list.length === 0) {
    // Escalar (ex.: conversoes_minhas_mes): mostra os pares chave/valor numéricos.
    const entries = Object.entries(detail).filter(([, v]) => typeof v === 'number');
    if (entries.length === 0) {
      return <p className="font-body text-sm text-text-low">Sem detalhe disponível.</p>;
    }
    return (
      <dl className="flex flex-col gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-border py-2">
            <dt className="font-body text-sm text-text-mid">{k}</dt>
            <dd className="font-price text-text">{formatInt(v as number)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <table className="w-full text-sm">
      <tbody>
        {list.map((r, i) => (
          <tr key={i} className="border-b border-border last:border-0">
            <td className="py-2 font-body text-text-mid">
              {String(
                r['bucket_hour'] ??
                  r['direction'] ??
                  r['conversion_type_id'] ??
                  r['status'] ??
                  `Item ${i + 1}`,
              )}
            </td>
            <td className="py-2 text-right font-price text-text">
              {formatInt(
                Number(r['message_count'] ?? r['conversion_count'] ?? r['count'] ?? r['value_cents'] ?? 0),
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * §F29 — drill-down de objeções em dois níveis no MESMO drawer (UX §2.3 — nunca
 * modal): nível 1 = categorias rankeadas (clicáveis); nível 2 = exemplos da
 * categoria escolhida (excerpt + estado resolvida). Voltar retorna ao ranking.
 */
function ObjectionsDrillBody({ detail }: { detail: Record<string, unknown> }) {
  const [category, setCategory] = useState<string | null>(null);
  const examples = useMetricDetail(category !== null ? 'objecoes_rankeadas' : null, category);

  // Nível 1: ranking de categorias (linha clicável abre os exemplos).
  if (category === null) {
    const table = readTableValue(detail);
    if (!table || table.rows.length === 0) {
      return <p className="font-body text-sm text-text-low">Nenhuma objeção no período.</p>;
    }
    return (
      <div className="flex flex-col gap-1">
        <p className="mb-2 font-body text-xs text-text-low">
          Selecione uma categoria para ver exemplos.
        </p>
        {table.rows.map((r, i) => {
          const cat = String(r['categoria'] ?? '');
          const total = Number(r['total'] ?? 0);
          const pct = Number(r['pct_resolvida'] ?? 0);
          return (
            <button
              key={i}
              type="button"
              onClick={() => setCategory(cat)}
              className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-brand hover:bg-surface-2"
            >
              <span className="font-body text-sm text-text">{objectionCategoryLabel(cat)}</span>
              <span className="flex items-center gap-3">
                <span className="font-price text-sm text-text-mid">{formatInt(total)}</span>
                <span className="font-body text-xs text-text-low">{pct}% resolvida</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Nível 2: exemplos da categoria (excerpt + badge resolvida/não-resolvida).
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setCategory(null)}
        className="self-start font-body text-xs text-text-low hover:text-brand-bright"
      >
        ← Voltar às categorias
      </button>
      <h3 className="font-head text-sm text-text">{objectionCategoryLabel(category)}</h3>
      {examples.isLoading && <SkeletonList rows={4} />}
      {examples.isError && (
        <p className="font-body text-sm text-text-low">Não foi possível carregar os exemplos.</p>
      )}
      {examples.data && <ObjectionExamples detail={examples.data.detail} />}
    </div>
  );
}

/** Lista de exemplos de objeção: trecho (excerpt) + estado resolvida. */
function ObjectionExamples({ detail }: { detail: Record<string, unknown> }) {
  const table = readTableValue(detail);
  if (!table || table.rows.length === 0) {
    return <p className="font-body text-sm text-text-low">Sem exemplos nesta categoria.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {table.rows.map((r, i) => {
        const label = typeof r['label'] === 'string' ? r['label'] : '';
        const excerpt = typeof r['excerpt'] === 'string' ? r['excerpt'] : null;
        const resolvida = r['resolvida'] === true;
        return (
          <li key={i} className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="font-body text-sm text-text">{label}</span>
              <span
                className={
                  'inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 font-body text-xs ' +
                  (resolvida ? 'bg-success/15 text-success' : 'bg-warn/15 text-warn')
                }
              >
                {resolvida ? 'Resolvida' : 'Em aberto'}
              </span>
            </div>
            {excerpt && (
              <p className="mt-1.5 font-body text-sm italic text-text-mid">“{excerpt}”</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
