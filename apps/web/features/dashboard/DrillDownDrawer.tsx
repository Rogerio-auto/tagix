'use client';

/**
 * Drawer lateral de drill-down (DASHBOARD §4 — drawer no lugar de modal full-screen,
 * UX §2.3). Abre sobre o dashboard mostrando o detalhe da métrica
 * (`GET /dashboard/metrics/:key`). Se a métrica não tem detalhe próprio (204), o
 * card já navega via Link e este drawer nem é acionado.
 *
 * Usa o `Sheet` compartilhado (mesma base dos detalhes de KB/flows).
 */
import { Sheet } from '@/shared/components/help/Sheet';
import { SkeletonList } from '@/shared/components/feedback';
import { useMetricDetail } from './queries';
import type { DashboardCard } from './types';
import { formatInt } from './format';

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
        {detail.data && <DetailBody detail={detail.data.detail} />}
      </div>
    </Sheet>
  );
}

/** Renderização genérica do detalhe (série/tabela) sem assumir uma métrica única. */
function DetailBody({ detail }: { detail: Record<string, unknown> }) {
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
