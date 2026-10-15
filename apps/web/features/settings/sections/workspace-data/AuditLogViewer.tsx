'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, FilterX, ScrollText, Search } from 'lucide-react';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  type DataTableColumn,
} from '@hm/ui';
import { ResponsiveTable, type ResponsiveColumn } from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import { selectClass } from '../personal/components';
import { useAuditLogs, type AuditFilters, type AuditLog } from './queries';

const ACTOR_LABEL: Record<string, string> = {
  member: 'Membro',
  agent: 'Agente',
  api: 'API',
  system: 'Sistema',
  platform_admin: 'Admin de plataforma',
};

function actorName(log: AuditLog): string {
  return log.actorName ?? log.actorEmail ?? ACTOR_LABEL[log.actorType] ?? log.actorType;
}

/**
 * Auditoria: audit_logs filtráveis (quem/quando/o quê) sob RLS, no DS 3.0 (F72-S07).
 * Desktop em `DataTable` (ação e IP em mono, data em mono à direita), celular em cards.
 * Leitura pura: nada aqui escreve, então nada fica bloqueado no modo só leitura.
 * UX: §2.6 vazio diferencia "sem registros" de "nenhum resultado para o filtro";
 * §2.7 esqueleto no formato da tabela; §2.11 erro em 3 partes com retry.
 */
export default function AuditLogViewer(): React.JSX.Element {
  const { isMobile } = useBreakpoint();
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actorType, setActorType] = useState('');
  const [page, setPage] = useState(1);

  const filters: AuditFilters = {
    action: action || undefined,
    resourceType: resourceType || undefined,
    actorType: actorType || undefined,
    page,
    pageSize: 50,
  };
  const query = useAuditLogs(filters);
  const data = query.data;
  const logs = data?.logs ?? [];
  const hasFilters = Boolean(action || resourceType || actorType);

  const clear = () => {
    setAction('');
    setResourceType('');
    setActorType('');
    setPage(1);
  };

  const columns: DataTableColumn<AuditLog>[] = [
    {
      id: 'action',
      header: 'Ação',
      cell: (log) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-sm text-text">{log.action}</span>
          <span className="truncate text-xs text-text-low">{log.resourceType}</span>
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Quem',
      cell: (log) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-text">{actorName(log)}</span>
          <span className="truncate text-xs text-text-low">{ACTOR_LABEL[log.actorType] ?? log.actorType}</span>
        </span>
      ),
    },
    {
      id: 'ip',
      header: 'IP',
      width: '9rem',
      cell: (log) => <span className="font-mono text-sm tabular-nums text-text-mid">{log.ipAddress ?? '—'}</span>,
    },
    { id: 'when', header: 'Quando', numeric: true, width: '10rem', cell: (log) => <span className="whitespace-nowrap">{formatDateTime(log.createdAt)}</span> },
  ];

  const cardColumns: readonly ResponsiveColumn<AuditLog>[] = [
    { id: 'action', card: 'primary', cell: (log) => <span className="font-mono">{log.action}</span> },
    { id: 'actor', card: 'secondary', cell: (log) => `${actorName(log)} · ${log.resourceType}` },
    {
      id: 'when',
      card: 'meta',
      cell: (log) => <span className="font-mono tabular-nums">{formatDateTime(log.createdAt)}</span>,
    },
    {
      id: 'ip',
      card: 'meta',
      cell: (log) => (log.ipAddress ? <span className="font-mono tabular-nums">{log.ipAddress}</span> : null),
    },
  ];

  const empty = hasFilters
    ? {
        icon: Search,
        title: 'Nenhum registro para estes filtros',
        description: 'Ajuste a ação, o recurso ou o tipo de ator, ou limpe os filtros.',
        action: (
          <Button variant="secondary" size="sm" onClick={clear}>
            Limpar filtros
          </Button>
        ),
      }
    : {
        icon: ScrollText,
        title: 'Nenhum registro de auditoria',
        description: 'Ações administrativas (convites, papéis, integrações) aparecem aqui com quem e quando.',
      };
  const error = {
    title: 'Não foi possível carregar a auditoria',
    reason: 'A consulta dos registros não respondeu.',
    whatToDo: 'Tente de novo em instantes.',
    action: (
      <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
        Tentar de novo
      </Button>
    ),
  };

  const filtersBar = (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
      <Input
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        placeholder="Ação (ex.: member.invite)"
        aria-label="Filtrar por ação"
        className="font-mono"
      />
      <Input
        value={resourceType}
        onChange={(e) => {
          setResourceType(e.target.value);
          setPage(1);
        }}
        placeholder="Recurso (ex.: member)"
        aria-label="Filtrar por recurso"
        className="font-mono"
      />
      <select
        value={actorType}
        onChange={(e) => {
          setActorType(e.target.value);
          setPage(1);
        }}
        aria-label="Filtrar por tipo de ator"
        className={selectClass}
      >
        <option value="">Qualquer ator</option>
        {Object.entries(ACTOR_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <Button variant="ghost" disabled={!hasFilters} leftIcon={<FilterX className="size-4" aria-hidden />} onClick={clear}>
        Limpar
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {filtersBar}

      {isMobile ? (
        <ResponsiveTable<AuditLog>
          ariaLabel="Registros de auditoria"
          rows={logs}
          columns={cardColumns}
          getRowId={(log) => log.id}
          isLoading={query.isLoading}
          isError={query.isError}
          empty={empty}
          error={error}
          skeletonRows={5}
        />
      ) : (
        <DataTable<AuditLog>
          caption="Registros de auditoria"
          columns={columns}
          rows={logs}
          getRowId={(log) => log.id}
          density="compact"
          loading={query.isLoading}
          loadingRows={6}
          error={query.isError ? <ErrorState {...error} /> : undefined}
          empty={<EmptyState {...empty} />}
        />
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Paginação da auditoria" className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-body text-sm text-text-low">
            Página <span className="font-mono tabular-nums text-text-mid">{formatNumber(data.page)}</span> de{' '}
            <span className="font-mono tabular-nums text-text-mid">{formatNumber(data.totalPages)}</span> ·{' '}
            <span className="font-mono tabular-nums text-text-mid">{formatNumber(data.total)}</span> registros
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ChevronLeft className="size-4" aria-hidden />}
              disabled={page <= 1 || query.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              size="sm"
              rightIcon={<ChevronRight className="size-4" aria-hidden />}
              disabled={page >= data.totalPages || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
