'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, FilterX, Plus, RefreshCw, Search } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, DataTable, Input, useToast, type DataTableColumn } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { useAuthStore } from '@/shared/stores/auth.store';
import type { Channel } from '../types';
import { CreateTemplateDrawer } from './CreateTemplateDrawer';
import { categoryLabel, displayTemplateName, formatDateTime, languageLabel } from './format';
import { MessageTemplateApiError, useMessageTemplates, useSyncMessageTemplates } from './queries';
import { TemplateDetailDrawer } from './TemplateDetailDrawer';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import type { MessageTemplate, MessageTemplateFilters } from './types';

/** Controle nativo no desenho do `Input` do DS 3.0. 16px abaixo de `sm` (iOS). */
const selectClass =
  'h-10 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none sm:text-sm ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 focus:border-brand-text ' +
  'focus-visible:focus-ring disabled:opacity-40';

/** Link com cara de botão secundário (o `Button` do @hm/ui não renderiza `<a>`). */
export const linkButtonClass =
  'inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-border bg-surface-2 px-4 font-body text-sm font-bold text-text outline-none ' +
  'transition-[border-color,background-color] duration-(--dur-base) ease-ds hover:border-border-2 hover:bg-surface-3 focus-visible:focus-ring';

const STATUS_OPTIONS = [['', 'Todos os status'], ['APPROVED', 'Aprovado'], ['PENDING', 'Em análise'], ['REJECTED', 'Precisa de ajustes'], ['PAUSED', 'Pausado'], ['DISABLED', 'Desativado']] as const;
const CATEGORY_OPTIONS = [['', 'Todas as categorias'], ['MARKETING', 'Marketing'], ['UTILITY', 'Serviço'], ['AUTHENTICATION', 'Autenticação']] as const;
const LANGUAGE_OPTIONS = [['', 'Todos os idiomas'], ['pt_BR', 'Português (Brasil)'], ['pt_PT', 'Português (Portugal)'], ['en_US', 'Inglês (Estados Unidos)'], ['es', 'Espanhol']] as const;

function summaryText(summary: { created: number; updated: number; archived: number; total: number }): string {
  return `${formatNumber(summary.created)} novo(s), ${formatNumber(summary.updated)} atualizado(s) e ${formatNumber(summary.archived)} indisponível(is). ${formatNumber(summary.total)} no catálogo.`;
}

/** Card do celular: o corpo inteiro abre o detalhe (UX §2.1). */
function TemplateCard({ template, onOpen }: { template: MessageTemplate; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Ver detalhes de ${displayTemplateName(template.name)}`}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left outline-none transition-colors duration-(--dur-fast) hover:bg-surface-2 focus-visible:focus-ring"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-body text-sm font-semibold text-text">{displayTemplateName(template.name)}</span>
            <span className="block truncate font-mono text-xs text-text-low">{template.name}</span>
          </span>
          <TemplateStatusBadge template={template} />
        </span>
        <span className="flex flex-wrap gap-x-3 font-body text-xs text-text-mid">
          <span>{languageLabel(template.language)}</span>
          <span>{categoryLabel(template.category)}</span>
          <span className="font-mono tabular-nums text-text-low">Sync {formatDateTime(template.lastSyncedAt)}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Central de modelos de mensagem do WhatsApp de um canal, no DS 3.0 (F72-S07): filtros
 * no desenho do `Input`, catálogo em `DataTable` no desktop (linha abre o detalhe num
 * Drawer, UX §2.1/§2.3; nome técnico e sync em mono) e cards no celular.
 *
 * Só leitura (F71-S17): "Sincronizar agora" e "Criar modelo" ficam `aria-disabled` com a
 * explicação; consultar e filtrar seguem livres.
 */
export function MessageTemplatesCatalog({ channel }: { channel: Channel }) {
  const role = useAuthStore((state) => state.auth?.role);
  const authStatus = useAuthStore((state) => state.status);
  const canView = role ? can(role, 'message_template.view') : false;
  const canManage = role ? can(role, 'message_template.manage') : false;
  const canUseInCampaign = role ? can(role, 'campaign.edit') : false;
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const [filters, setFilters] = useState<MessageTemplateFilters>({ status: '', category: '', language: '', search: '', page: 1, limit: 25 });
  const deferredSearch = useDeferredValue(filters.search);
  const queryFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [deferredSearch, filters]);
  const templates = useMessageTemplates(channel.id, queryFilters, canView && channel.provider === 'meta_whatsapp');
  const sync = useSyncMessageTemplates(channel.id);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<MessageTemplate | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    setFilters((current) => ({ ...current, page: 1 }));
  }, [deferredSearch]);
  function patchFilters(value: Partial<MessageTemplateFilters>): void {
    setFilters((current) => ({ ...current, ...value, page: value.page ?? 1 }));
  }
  function clearFilters(): void {
    setFilters((current) => ({ ...current, status: '', category: '', language: '', search: '', page: 1 }));
  }

  async function syncNow(): Promise<void> {
    setAnnouncement('Sincronização iniciada. A lista atual continuará disponível.');
    try {
      const result = await sync.mutateAsync();
      const description = summaryText(result.summary);
      setAnnouncement(`Sincronização concluída. ${description}`);
      toast({ variant: 'success', title: 'Modelos sincronizados', description });
    } catch (error) {
      const description = error instanceof MessageTemplateApiError ? error.message : 'Confira sua conexão e tente novamente.';
      setAnnouncement(`Falha na sincronização. ${description}`);
      toast({ variant: 'error', title: 'Não foi possível sincronizar', description });
    }
  }

  if (authStatus === 'idle' || authStatus === 'loading') return <SkeletonList rows={5} />;
  if (!canView) {
    return (
      <ErrorState
        title="Você não tem acesso aos modelos"
        reason="A Central de Modelos está disponível para quem consulta campanhas."
        whatToDo="Peça acesso a um administrador do workspace."
        action={
          <Link href="/campaigns" className={linkButtonClass}>
            Voltar para campanhas
          </Link>
        }
      />
    );
  }
  if (channel.provider !== 'meta_whatsapp') {
    return (
      <ErrorState
        title="Este canal não usa modelos aprovados"
        reason={
          channel.provider === 'meta_instagram'
            ? 'O Instagram usa mensagens diretas e não oferece modelos aprovados do WhatsApp.'
            : 'O WhatsApp via WAHA usa as regras próprias desse canal e não a aprovação da Meta.'
        }
        whatToDo="Escolha um canal oficial do WhatsApp na lista de canais."
        action={
          <Link href="/settings/channels" className={linkButtonClass}>
            Ver canais
          </Link>
        }
      />
    );
  }

  const data = templates.data;
  const hasFilters = Boolean(filters.search || filters.status || filters.category || filters.language);
  const lastSync = data?.syncState.lastSuccessfulSyncAt ?? null;
  const openCreate = () => {
    setCreateSeed(null);
    setCreateOpen(true);
  };
  const actions = canManage ? (
    <div className="flex flex-wrap gap-2">
      <ReadOnlyGuard>
        <Button
          variant="secondary"
          loading={sync.isPending}
          leftIcon={<RefreshCw className="size-4" aria-hidden />}
          disabled={!channel.isActive}
          onClick={() => void syncNow()}
        >
          Sincronizar agora
        </Button>
      </ReadOnlyGuard>
      <ReadOnlyGuard>
        <Button leftIcon={<Plus className="size-4" aria-hidden />} disabled={!channel.isActive} onClick={openCreate}>
          Criar modelo
        </Button>
      </ReadOnlyGuard>
    </div>
  ) : null;

  if (!channel.isActive) {
    return (
      <div>
        <PageHeader title="Modelos de mensagem do WhatsApp" actions={actions} />
        <ErrorState
          title="Reconecte este canal para usar modelos"
          reason="O canal está desativado, então a lista pode estar desatualizada e nenhuma ação pode ser enviada à Meta."
          whatToDo={canManage ? 'Ative ou atualize a conexão do WhatsApp e volte para sincronizar.' : 'Peça a um administrador para atualizar a conexão.'}
          action={
            canManage ? (
              <Link href="/settings/channels" className={linkButtonClass}>
                Atualizar conexão
              </Link>
            ) : undefined
          }
        />
      </div>
    );
  }

  const columns: DataTableColumn<MessageTemplate>[] = [
    {
      id: 'name',
      header: 'Modelo',
      cell: (t) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-text">{displayTemplateName(t.name)}</span>
          <span className="truncate font-mono text-xs text-text-low">{t.name}</span>
        </span>
      ),
    },
    { id: 'language', header: 'Idioma', width: '11rem', cell: (t) => <span className="text-text-mid">{languageLabel(t.language)}</span> },
    { id: 'category', header: 'Categoria', width: '9rem', cell: (t) => <span className="text-text-mid">{categoryLabel(t.category)}</span> },
    { id: 'status', header: 'Status', width: '10rem', cell: (t) => <TemplateStatusBadge template={t} /> },
    { id: 'synced', header: 'Sincronizado', numeric: true, width: '9.5rem', cell: (t) => formatDateTime(t.lastSyncedAt) },
  ];

  const emptyState = (
    <EmptyState
      icon={FileText}
      title={hasFilters ? 'Nenhum modelo corresponde aos filtros' : 'Nenhum modelo encontrado neste canal'}
      description={
        hasFilters
          ? 'Ajuste a busca ou limpe os filtros para ver todo o catálogo.'
          : 'Crie seu primeiro modelo ou sincronize os modelos que já existem na Meta.'
      }
      action={
        hasFilters ? (
          <Button variant="secondary" onClick={clearFilters}>
            Limpar filtros
          </Button>
        ) : canManage ? (
          <div className="flex flex-wrap justify-center gap-2">
            <ReadOnlyGuard align="center">
              <Button variant="secondary" onClick={() => void syncNow()}>
                Sincronizar modelos
              </Button>
            </ReadOnlyGuard>
            <ReadOnlyGuard align="center">
              <Button onClick={openCreate}>Criar modelo</Button>
            </ReadOnlyGuard>
          </div>
        ) : undefined
      }
    />
  );
  const errorState = (
    <ErrorState
      error={templates.error}
      title="Não foi possível carregar os modelos"
      reason="A conexão com o catálogo falhou ou expirou."
      whatToDo="Tente novamente. Se o erro continuar, atualize a conexão do canal."
      action={
        <Button variant="secondary" loading={templates.isFetching} onClick={() => void templates.refetch()}>
          Tentar novamente
        </Button>
      }
    />
  );

  const list = data?.templates ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/settings/channels"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm font-body text-sm font-semibold text-text-mid outline-none transition-colors duration-(--dur-base) hover:text-text focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden /> Voltar para canais
      </Link>
      <PageHeader
        title="Modelos de mensagem do WhatsApp"
        description={
          <span className="flex flex-wrap gap-x-3">
            <span>
              Canal <strong className="font-semibold text-text-mid">{channel.name}</strong>
            </span>
            <span>
              Última sincronização <span className="font-mono tabular-nums text-text-mid">{formatDateTime(lastSync)}</span>
            </span>
          </span>
        }
        actions={actions}
      />
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>
      {!canManage ? (
        <div className="rounded-md border border-border bg-surface px-4 py-3 font-body text-sm text-text-mid">
          Você pode consultar os modelos e seus detalhes. Somente administradores podem criar ou sincronizar.
        </div>
      ) : null}
      {sync.isPending ? (
        <div role="status" className="rounded-md border border-info/30 bg-info/10 px-4 py-3 font-body text-sm text-text">
          Sincronizando com a Meta. Você pode continuar consultando a lista.
        </div>
      ) : null}
      {templates.isError && data ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warn/30 bg-warn/10 px-4 py-3 font-body text-sm text-text"
        >
          <span>
            Não foi possível atualizar a lista. Mostrando os dados da última sincronização bem-sucedida (
            <span className="font-mono tabular-nums">{formatDateTime(lastSync)}</span>).
          </span>
          <Button variant="ghost" size="sm" onClick={() => void templates.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <section
        aria-label="Filtros dos modelos"
        className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,0.55fr))_auto]"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-text-low" aria-hidden />
          <Input
            aria-label="Buscar modelo por nome"
            className="pl-9"
            value={filters.search}
            onChange={(e) => patchFilters({ search: e.target.value })}
            placeholder="Buscar por nome"
          />
        </div>
        <select aria-label="Filtrar por status" className={selectClass} value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por categoria" className={selectClass} value={filters.category} onChange={(e) => patchFilters({ category: e.target.value })}>
          {CATEGORY_OPTIONS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Filtrar por idioma" className={selectClass} value={filters.language} onChange={(e) => patchFilters({ language: e.target.value })}>
          {LANGUAGE_OPTIONS.map(([value, label]) => (
            <option key={value || 'all'} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="ghost" disabled={!hasFilters} leftIcon={<FilterX className="size-4" aria-hidden />} onClick={clearFilters}>
          Limpar
        </Button>
      </section>

      {isMobile ? (
        templates.isLoading && !data ? (
          <SkeletonList rows={6} />
        ) : templates.isError && !data ? (
          errorState
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border-2">{emptyState}</div>
        ) : (
          <ul
            aria-label="Modelos de mensagem"
            aria-busy={templates.isFetching}
            className={cn(
              'divide-y divide-border rounded-lg border border-border bg-surface transition-opacity duration-(--dur-base)',
              templates.isFetching && 'opacity-70',
            )}
          >
            {list.map((template) => (
              <TemplateCard key={template.id} template={template} onOpen={() => setSelected(template)} />
            ))}
          </ul>
        )
      ) : (
        <DataTable<MessageTemplate>
          caption="Modelos de mensagem"
          columns={columns}
          rows={list}
          getRowId={(t) => t.id}
          loading={templates.isLoading && !data}
          loadingRows={6}
          onRowClick={setSelected}
          getRowLabel={(t) => `Ver detalhes de ${displayTemplateName(t.name)}`}
          getRowState={(t) => (selected?.id === t.id ? 'selected' : !t.isAvailable ? 'muted' : undefined)}
          error={templates.isError && !data ? errorState : undefined}
          empty={emptyState}
          className={cn('transition-opacity duration-(--dur-base)', templates.isFetching && data && 'opacity-70')}
        />
      )}

      {data && list.length > 0 ? (
        <nav aria-label="Paginação dos modelos" className="flex flex-wrap items-center justify-between gap-3 font-body text-sm text-text-low">
          <span>
            <span className="font-mono tabular-nums text-text-mid">{formatNumber(data.pagination.total)}</span> modelo(s) · página{' '}
            <span className="font-mono tabular-nums text-text-mid">{formatNumber(data.pagination.page)}</span> de{' '}
            <span className="font-mono tabular-nums text-text-mid">{formatNumber(Math.max(data.pagination.totalPages, 1))}</span>
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<ChevronLeft className="size-4" aria-hidden />}
              disabled={data.pagination.page <= 1 || templates.isFetching}
              onClick={() => patchFilters({ page: filters.page - 1 })}
            >
              Anterior
            </Button>
            <Button
              variant="secondary"
              size="sm"
              rightIcon={<ChevronRight className="size-4" aria-hidden />}
              disabled={data.pagination.page >= data.pagination.totalPages || templates.isFetching}
              onClick={() => patchFilters({ page: filters.page + 1 })}
            >
              Próxima
            </Button>
          </div>
        </nav>
      ) : null}

      <TemplateDetailDrawer
        channelId={channel.id}
        channelName={channel.name}
        template={selected}
        canUseInCampaign={canUseInCampaign}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onCreateVersion={(template) => {
          setSelected(null);
          setCreateSeed(template);
          setCreateOpen(true);
        }}
      />
      {canManage ? (
        <CreateTemplateDrawer
          channelId={channel.id}
          channelName={channel.name}
          open={createOpen}
          seed={createSeed}
          onClose={() => {
            setCreateOpen(false);
            setCreateSeed(null);
          }}
        />
      ) : null}
    </div>
  );
}
