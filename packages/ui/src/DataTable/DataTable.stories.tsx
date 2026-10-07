import { useMemo, useState } from 'react';
import { Inbox, WifiOff } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar';
import { Badge } from '../Badge/Badge';
import { Button } from '../Button/Button';
import { EmptyState } from '../EmptyState/EmptyState';
import { ErrorState } from '../ErrorState/ErrorState';
import { ThemePair } from '../lib/ThemePair';
import { DataTable, type DataTableColumn, type DataTableSort } from './DataTable';

type Stage = 'booked' | 'proposal' | 'qualified' | 'new';

interface Lead {
  id: string;
  name: string;
  stage: Stage;
  value: number | null;
  lastSignal: string;
}

const LEADS: Lead[] = [
  { id: '1', name: 'Maria Santos', stage: 'booked', value: 18400, lastSignal: '2m' },
  { id: '2', name: 'John Lewis', stage: 'proposal', value: 12800, lastSignal: '16m' },
  { id: '3', name: 'Carla Reis', stage: 'qualified', value: 7500, lastSignal: '32m' },
  { id: '4', name: 'Robert Brown', stage: 'new', value: null, lastSignal: '1h' },
];

const STAGE: Record<Stage, { label: string; tone: 'brand' | 'warning' | 'info' | 'neutral' }> = {
  booked: { label: 'Agendado', tone: 'brand' },
  proposal: { label: 'Proposta', tone: 'warning' },
  qualified: { label: 'Qualificado', tone: 'info' },
  new: { label: 'Novo', tone: 'neutral' },
};

/* Valores de catálogo já formatados: formatação real (locale/moeda) é do consumidor, via o formatador do app. */
const LABEL: Record<string, string> = { '1': '$18,400', '2': '$12,800', '3': '$7,500' };

const columns: DataTableColumn<Lead>[] = [
  {
    id: 'name',
    header: 'Contato',
    sortable: true,
    cell: (r) => (
      <span className="inline-flex items-center gap-2.5 text-text">
        <Avatar name={r.name} size="sm" />
        {r.name}
      </span>
    ),
  },
  {
    id: 'stage',
    header: 'Estágio',
    cell: (r) => (
      <Badge tone={STAGE[r.stage].tone} dot>
        {STAGE[r.stage].label}
      </Badge>
    ),
  },
  {
    id: 'value',
    header: 'Valor',
    numeric: true,
    sortable: true,
    cell: (r) => LABEL[r.id] ?? (r.value === null ? '—' : String(r.value)),
  },
  { id: 'signal', header: 'Último sinal', numeric: true, cell: (r) => r.lastSignal },
];

const getId = (r: Lead): string => r.id;

export const Default = () => (
  <DataTable caption="Leads recentes" columns={columns} rows={LEADS} getRowId={getId} />
);

export const Compact = () => (
  <DataTable caption="Leads recentes" columns={columns} rows={LEADS} getRowId={getId} density="compact" />
);

export const Clickable = () => {
  const [selected, setSelected] = useState<string | null>('2');
  return (
    <DataTable
      caption="Leads recentes"
      columns={columns}
      rows={LEADS}
      getRowId={getId}
      onRowClick={(r) => setSelected(r.id)}
      getRowLabel={(r) => `Abrir ${r.name}`}
      getRowState={(r) => (r.id === selected ? 'selected' : r.id === '4' ? 'attention' : undefined)}
    />
  );
};

export const Sortable = () => {
  const [sort, setSort] = useState<DataTableSort | null>({ columnId: 'value', direction: 'desc' });
  const rows = useMemo(() => {
    if (!sort) return LEADS;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...LEADS].sort((a, b) =>
      sort.columnId === 'name' ? a.name.localeCompare(b.name) * dir : ((a.value ?? -1) - (b.value ?? -1)) * dir,
    );
  }, [sort]);
  return (
    <DataTable
      caption="Leads recentes"
      columns={columns}
      rows={rows}
      getRowId={getId}
      sort={sort}
      onSortChange={setSort}
    />
  );
};

export const StickyHeaderScroll = () => {
  const many = Array.from({ length: 24 }, (_, i): Lead => ({
    id: `m${i}`,
    name: `Contato ${i + 1}`,
    stage: 'new',
    value: 1000 + i * 137,
    lastSignal: `${i + 1}h`,
  }));
  return (
    <DataTable caption="Muitos leads" columns={columns} rows={many} getRowId={getId} maxHeight="20rem" density="compact" />
  );
};

export const Loading = () => (
  <DataTable caption="Leads recentes" columns={columns} rows={[]} getRowId={getId} loading />
);

export const Empty = () => (
  <DataTable
    caption="Leads recentes"
    columns={columns}
    rows={[]}
    getRowId={getId}
    empty={
      <EmptyState
        icon={Inbox}
        title="Nenhum lead ainda"
        description="Quando um contato entrar no funil, ele aparece aqui."
        action={<Button>Conectar canal</Button>}
      />
    }
  />
);

export const ErrorStateRow = () => (
  <DataTable
    caption="Leads recentes"
    columns={columns}
    rows={[]}
    getRowId={getId}
    error={
      <ErrorState
        title="Não foi possível carregar os leads"
        reason="O servidor demorou a responder."
        whatToDo="Tente de novo em instantes."
        action={<Button variant="secondary">Tentar de novo</Button>}
      />
    }
  />
);

export const BothThemes = () => (
  <ThemePair>
    <div className="flex flex-col gap-4">
      <DataTable
        caption="Leads recentes"
        columns={columns}
        rows={LEADS}
        getRowId={getId}
        onRowClick={() => undefined}
        getRowLabel={(r) => `Abrir ${r.name}`}
        getRowState={(r) => (r.id === '2' ? 'selected' : r.id === '4' ? 'attention' : undefined)}
      />
      <DataTable caption="Carregando" columns={columns} rows={[]} getRowId={getId} loading loadingRows={2} />
      <DataTable
        caption="Vazio"
        columns={columns}
        rows={[]}
        getRowId={getId}
        empty={<EmptyState variant="error-adjacent" icon={WifiOff} title="Sem conexão" />}
      />
    </div>
  </ThemePair>
);
