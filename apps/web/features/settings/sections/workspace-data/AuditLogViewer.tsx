'use client';

import { useState } from 'react';
import { Button } from '@hm/ui';
import { useAuditLogs, type AuditFilters } from './queries';

const selectClass =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md';

function dt(value: string): string {
  return new Date(value).toLocaleString('pt-BR');
}

/** Auditoria: lista de audit_logs filtrável (quem/quando/o quê) sob RLS. */
export default function AuditLogViewer(): React.JSX.Element {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
          placeholder="Ação (ex.: member.invite)"
          aria-label="Filtrar por ação"
          className={selectClass}
        />
        <input
          value={resourceType}
          onChange={(e) => {
            setResourceType(e.target.value);
            setPage(1);
          }}
          placeholder="Recurso (ex.: member)"
          aria-label="Filtrar por recurso"
          className={selectClass}
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
          <option value="member">Membro</option>
          <option value="agent">Agente</option>
          <option value="api">API</option>
          <option value="system">Sistema</option>
          <option value="platform_admin">Admin de plataforma</option>
        </select>
      </div>

      {query.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-text-low">Nenhum registro de auditoria.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-text">
                  <span className="font-medium">{log.action}</span>{' '}
                  <span className="text-text-low">· {log.resourceType}</span>
                </p>
                <p className="truncate text-xs text-text-low">
                  {log.actorName ?? log.actorEmail ?? log.actorType}
                  {log.ipAddress ? ` · ${log.ipAddress}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-text-low">{dt(log.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-low">
            Página {data.page} de {data.totalPages} · {data.total} registros
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Anterior
            </Button>
            <Button variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
