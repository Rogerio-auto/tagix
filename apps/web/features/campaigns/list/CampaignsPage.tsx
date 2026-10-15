'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Plus, SearchX } from 'lucide-react';
import {
  AnchoredHelpHint,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  type DataTableColumn,
} from '@hm/ui';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import {
  ResponsiveTable,
  type ActiveFilterChip,
  type ResponsiveColumn,
} from '@/shared/components/ResponsiveTable';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatNumber } from '@/shared/lib/locale';
import { CampaignActions, CancelCampaignDialog, useCampaignPermissions } from './CampaignActions';
import { useCampaigns } from './queries';
import { CampaignStatusPill } from './status';
import type { Campaign, CampaignType } from './types';

/** Data compacta para coluna de tabela (mono, uma linha). */
const TABLE_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

const TYPE_LABEL: Record<CampaignType, string> = {
  broadcast: 'Disparo único',
  drip: 'Sequência',
  triggered: 'Por gatilho',
};

const FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Todas' },
  { value: 'running', label: 'Em execução' },
  { value: 'scheduled', label: 'Agendadas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'completed', label: 'Concluídas' },
];

/**
 * Página /campaigns (CAMPAIGNS.md 12.1) no DS 3.0 (F72-S07).
 *
 * Desktop: filtro de status segmentado + `DataTable` operacional (ritmo e limite diário
 * em mono à direita). Mobile: `ResponsiveTable` (cards, filtro no bottom-sheet).
 *
 * UX: §2.1 clique na linha abre o detalhe; §2.5 `?` ancorado no título; §2.6 vazio
 * acionável (primeiro uso vs. filtro sem resultado); §2.7 skeleton no formato da
 * tabela e botão em loading; §2.9 cancelar pede confirmação (é irreversível);
 * §2.10 Tab/Enter/setas na tabela; §2.11 erro em 3 partes com "Tentar de novo".
 * Só leitura: criar, pausar, retomar, editar e cancelar ficam `aria-disabled`.
 */
export function CampaignsPage(): React.JSX.Element {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const perms = useCampaignPermissions();

  const [status, setStatus] = useState('');
  const listQuery = useCampaigns(status);
  const campaigns = useMemo(() => listQuery.data?.campaigns ?? [], [listQuery.data]);
  const isFiltering = status !== '';

  const [toCancel, setToCancel] = useState<Campaign | null>(null);

  const open = (c: Campaign): void => router.push(`/campaigns/${c.id}`);

  const createButton = (label: string): React.JSX.Element => (
    <ReadOnlyGuard>
      <Button
        variant="primary"
        leftIcon={<Plus className="size-4" aria-hidden />}
        onClick={() => router.push('/campaigns/new')}
      >
        {label}
      </Button>
    </ReadOnlyGuard>
  );

  // O invólucro só para a propagação do clique (a linha é a ação primária, UX §2.1);
  // o teclado de cada botão segue intacto e a linha ignora teclas vindas de dentro.
  const actionsCell = (c: Campaign): React.JSX.Element => (
    <div className="flex flex-wrap items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
      <CampaignActions campaign={c} perms={perms} onCancel={setToCancel} labelled />
    </div>
  );

  // ── Desktop: DataTable ────────────────────────────────────────────────────
  const tableColumns: DataTableColumn<Campaign>[] = [
    {
      id: 'name',
      header: 'Campanha',
      cell: (c) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-bold text-text">{c.name}</span>
          <span className="truncate text-xs text-text-low">{TYPE_LABEL[c.type]}</span>
        </span>
      ),
    },
    { id: 'status', header: 'Status', width: '10rem', cell: (c) => <CampaignStatusPill status={c.status} /> },
    {
      id: 'rate',
      header: 'Ritmo',
      numeric: true,
      width: '8rem',
      cell: (c) => (
        <span className="text-text-mid">
          {formatNumber(c.rateLimitPerMinute)}
          <span className="text-text-low">/min</span>
        </span>
      ),
    },
    {
      id: 'daily',
      header: 'Limite diário',
      numeric: true,
      width: '9rem',
      cell: (c) => <span className="text-text-mid">{formatNumber(c.dailyLimit)}</span>,
    },
    {
      id: 'createdAt',
      header: 'Criada em',
      numeric: true,
      width: '8rem',
      cell: (c) => <span className="whitespace-nowrap text-text-mid">{formatDate(c.createdAt, TABLE_DATE)}</span>,
    },
    { id: 'actions', header: <span className="sr-only">Ações</span>, headerLabel: 'Ações', align: 'right', cell: actionsCell },
  ];

  // ── Mobile: cards ─────────────────────────────────────────────────────────
  const cardColumns: ResponsiveColumn<Campaign>[] = [
    { id: 'name', card: 'primary', cell: (c) => c.name },
    {
      id: 'type',
      card: 'secondary',
      cell: (c) => (
        <span>
          {TYPE_LABEL[c.type]} ·{' '}
          <span className="font-mono tabular-nums">{formatNumber(c.rateLimitPerMinute)}/min</span>
        </span>
      ),
    },
    { id: 'status', card: 'badge', cell: (c) => <CampaignStatusPill status={c.status} /> },
    // Sem ações no card: ele inteiro é um botão (não se aninha botão). Pausar, retomar e
    // cancelar ficam no detalhe, a um toque.
    {
      id: 'createdAt',
      card: 'meta',
      cell: (c) => <span className="font-mono tabular-nums">Criada em {formatDate(c.createdAt)}</span>,
    },
  ];

  const activeFilters: ActiveFilterChip[] = isFiltering
    ? [
        {
          id: 'status',
          label: `Status: ${FILTERS.find((x) => x.value === status)?.label ?? status}`,
          onClear: () => setStatus(''),
        },
      ]
    : [];

  const filterControls = (
    <div role="group" aria-label="Filtrar por status" className="flex flex-wrap gap-1.5">
      {FILTERS.map((f) => {
        const active = status === f.value;
        return (
          <button
            key={f.value || 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => setStatus(f.value)}
            className={cn(
              // 44px no toque (o filtro mora no bottom-sheet); compacto no desktop.
              'h-11 rounded-pill border px-3 font-body text-sm font-medium outline-none md:h-8',
              'transition-colors duration-(--dur-fast) ease-ds focus-visible:focus-ring motion-reduce:transition-none',
              active
                ? 'border-brand-text/30 bg-brand-text/10 text-brand-text'
                : 'border-border bg-surface text-text-mid hover:border-border-2 hover:text-text',
            )}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );

  const errorCopy = {
    title: 'Não foi possível carregar as campanhas',
    reason: 'A lista de campanhas não respondeu.',
    whatToDo: 'Verifique a conexão e tente novamente.',
  };
  const retry = (
    <Button variant="secondary" size="sm" loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>
      Tentar de novo
    </Button>
  );

  const firstUse = {
    title: 'Nenhuma campanha ainda',
    description: 'Campanhas enviam um template aprovado pela Meta para uma lista de contatos, no ritmo que você definir.',
  };
  const noResults = {
    title: 'Nenhuma campanha com este status',
    description: 'Escolha outro status ou veja todas as campanhas.',
  };

  const count = listQuery.data ? campaigns.length : undefined;
  const description =
    count === undefined ? (
      'Disparos e sequências de mensagens para listas de contatos.'
    ) : (
      <span>
        <span className="font-mono tabular-nums text-text-mid">{formatNumber(count)}</span>{' '}
        {count === 1 ? 'campanha' : 'campanhas'}
        {isFiltering ? ' com este status' : ' no workspace'}
      </span>
    );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Campanhas"
        description={description}
        helpSlot={<AnchoredHelpHint anchorKey="campaigns.list" />}
        actions={perms.edit ? createButton('Nova campanha') : undefined}
      />

      {isMobile ? (
        <ResponsiveTable<Campaign>
          ariaLabel="Campanhas"
          rows={campaigns}
          columns={cardColumns}
          getRowId={(c) => c.id}
          onRowClick={open}
          rowLabel={(c) => `Abrir campanha ${c.name}`}
          filters={filterControls}
          filtersTitle="Filtrar campanhas"
          activeFilters={activeFilters}
          onClearFilters={isFiltering ? () => setStatus('') : undefined}
          isLoading={listQuery.isLoading}
          isError={listQuery.isError}
          error={{ ...errorCopy, action: retry }}
          empty={{
            icon: isFiltering ? SearchX : Megaphone,
            ...(isFiltering ? noResults : firstUse),
            action: isFiltering ? undefined : perms.edit ? createButton('Criar campanha') : undefined,
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {filterControls}
          <DataTable<Campaign>
            caption="Campanhas"
            columns={tableColumns}
            rows={campaigns}
            getRowId={(c) => c.id}
            loading={listQuery.isLoading}
            loadingRows={6}
            onRowClick={open}
            getRowLabel={(c) => `Abrir campanha ${c.name}`}
            getRowState={(c) =>
              c.status === 'paused' ? 'attention' : c.status === 'cancelled' || c.status === 'completed' ? 'muted' : undefined
            }
            error={listQuery.isError ? <ErrorState {...errorCopy} action={retry} /> : undefined}
            empty={
              isFiltering ? (
                <EmptyState
                  variant="no-results"
                  icon={SearchX}
                  {...noResults}
                  secondaryAction={
                    <Button variant="ghost" size="sm" onClick={() => setStatus('')}>
                      Ver todas
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Megaphone}
                  {...firstUse}
                  action={perms.edit ? createButton('Criar campanha') : undefined}
                />
              )
            }
          />
        </div>
      )}

      <CancelCampaignDialog campaign={toCancel} onClose={() => setToCancel(null)} />
    </div>
  );
}
