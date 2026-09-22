'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, FilterX, Plus, RefreshCw, Search } from 'lucide-react';
import { can } from '@hm/shared';
import { Button, Card, CardBody, Input, useToast } from '@hm/ui';
import { EmptyState, ErrorState, SkeletonList } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { cn } from '@/shared/lib/cn';
import { useAuthStore } from '@/shared/stores/auth.store';
import type { Channel } from '../types';
import { CreateTemplateDrawer } from './CreateTemplateDrawer';
import { categoryLabel, displayTemplateName, formatDateTime, languageLabel } from './format';
import { MessageTemplateApiError, useMessageTemplates, useSyncMessageTemplates } from './queries';
import { TemplateDetailDrawer } from './TemplateDetailDrawer';
import { TemplateStatusBadge } from './TemplateStatusBadge';
import type { MessageTemplate, MessageTemplateFilters } from './types';

const selectClass = 'h-10 rounded-sm border border-border bg-surface-inset px-3 font-body text-sm text-text outline-none hover:border-border-2 focus:border-brand focus:shadow-glow-sm disabled:opacity-40';

const STATUS_OPTIONS = [['', 'Todos os status'], ['APPROVED', 'Aprovado'], ['PENDING', 'Em análise'], ['REJECTED', 'Precisa de ajustes'], ['PAUSED', 'Pausado'], ['DISABLED', 'Desativado']] as const;
const CATEGORY_OPTIONS = [['', 'Todas as categorias'], ['MARKETING', 'Marketing'], ['UTILITY', 'Serviço'], ['AUTHENTICATION', 'Autenticação']] as const;
const LANGUAGE_OPTIONS = [['', 'Todos os idiomas'], ['pt_BR', 'Português (Brasil)'], ['pt_PT', 'Português (Portugal)'], ['en_US', 'Inglês (Estados Unidos)'], ['es', 'Espanhol']] as const;

function summaryText(summary: { created: number; updated: number; archived: number; total: number }): string {
  return `${summary.created} novo(s), ${summary.updated} atualizado(s) e ${summary.archived} indisponível(is). ${summary.total} no catálogo.`;
}

function TemplateCard({ template, onOpen }: { template: MessageTemplate; onOpen: () => void }) {
  return (
    <li><button type="button" onClick={onOpen} className="grid w-full gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:shadow-glow-sm sm:grid-cols-[minmax(0,1.7fr)_minmax(110px,0.7fr)_minmax(120px,0.8fr)_auto] sm:items-center" aria-label={`Ver detalhes de ${displayTemplateName(template.name)}`}>
      <span className="min-w-0"><span className="block truncate font-head text-sm font-semibold text-text">{displayTemplateName(template.name)}</span><span className="mt-1 block truncate font-price text-xs text-text-low">{template.name}</span></span>
      <span className="text-sm text-text-mid"><span className="sm:hidden">Idioma: </span>{languageLabel(template.language)}</span>
      <span className="text-sm text-text-mid"><span className="sm:hidden">Categoria: </span>{categoryLabel(template.category)}</span>
      <span className="flex flex-wrap items-center justify-between gap-2 sm:flex-col sm:items-end"><TemplateStatusBadge template={template} /><span className="text-xs text-text-low">Sync {formatDateTime(template.lastSyncedAt)}</span></span>
    </button></li>
  );
}

export function MessageTemplatesCatalog({ channel }: { channel: Channel }) {
  const role = useAuthStore((state) => state.auth?.role);
  const authStatus = useAuthStore((state) => state.status);
  const canView = role ? can(role, 'message_template.view') : false;
  const canManage = role ? can(role, 'message_template.manage') : false;
  const canUseInCampaign = role ? can(role, 'campaign.edit') : false;
  const { toast } = useToast();
  const [filters, setFilters] = useState<MessageTemplateFilters>({ status: '', category: '', language: '', search: '', page: 1, limit: 25 });
  const deferredSearch = useDeferredValue(filters.search);
  const queryFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [deferredSearch, filters]);
  const templates = useMessageTemplates(channel.id, queryFilters, canView && channel.provider === 'meta_whatsapp');
  const sync = useSyncMessageTemplates(channel.id);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<MessageTemplate | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => { setFilters((current) => ({ ...current, page: 1 })); }, [deferredSearch]);
  function patchFilters(value: Partial<MessageTemplateFilters>): void { setFilters((current) => ({ ...current, ...value, page: value.page ?? 1 })); }
  function clearFilters(): void { setFilters((current) => ({ ...current, status: '', category: '', language: '', search: '', page: 1 })); }

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
  if (!canView) return <ErrorState title="Você não tem acesso aos modelos" reason="A Central de Modelos está disponível para quem consulta campanhas." whatToDo="Peça acesso a um administrador do workspace." action={<Link href="/campaigns" className="inline-flex h-10 items-center rounded-md bg-surface-2 px-4 font-head text-sm font-semibold text-text outline-none hover:bg-surface-3 focus-visible:shadow-glow-md">Voltar para campanhas</Link>} />;
  if (channel.provider !== 'meta_whatsapp') return <ErrorState title="Este canal não usa modelos aprovados" reason={channel.provider === 'meta_instagram' ? 'O Instagram usa mensagens diretas e não oferece modelos aprovados do WhatsApp.' : 'O WhatsApp via WAHA usa as regras próprias desse canal e não a aprovação da Meta.'} whatToDo="Escolha um canal oficial do WhatsApp na lista de canais." action={<Link href="/settings/channels" className="inline-flex h-10 items-center rounded-md bg-surface-2 px-4 font-head text-sm font-semibold text-text outline-none hover:bg-surface-3 focus-visible:shadow-glow-md">Ver canais</Link>} />;

  const data = templates.data;
  const hasFilters = Boolean(filters.search || filters.status || filters.category || filters.language);
  const lastSync = data?.syncState.lastSuccessfulSyncAt ?? null;
  const actions = canManage ? <div className="flex flex-wrap gap-2"><Button variant="secondary" loading={sync.isPending} leftIcon={<RefreshCw className="size-4" aria-hidden />} disabled={!channel.isActive} onClick={() => void syncNow()}>Sincronizar agora</Button><Button leftIcon={<Plus className="size-4" aria-hidden />} disabled={!channel.isActive} onClick={() => { setCreateSeed(null); setCreateOpen(true); }}>Criar modelo</Button></div> : null;

  if (!channel.isActive) return <div><PageHeader title="Modelos de mensagem do WhatsApp" actions={actions} /><ErrorState title="Reconecte este canal para usar modelos" reason="O canal está desativado, então a lista pode estar desatualizada e nenhuma ação pode ser enviada à Meta." whatToDo={canManage ? 'Ative ou atualize a conexão do WhatsApp e volte para sincronizar.' : 'Peça a um administrador para atualizar a conexão.'} action={canManage ? <Link href="/settings/channels" className="inline-flex h-10 items-center rounded-md bg-surface-2 px-4 font-head text-sm font-semibold text-text outline-none hover:bg-surface-3 focus-visible:shadow-glow-md">Atualizar conexão</Link> : undefined} /></div>;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/settings/channels" className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-text-mid outline-none hover:text-text focus-visible:shadow-glow-md"><ArrowLeft className="size-4" aria-hidden /> Voltar para canais</Link>
      <PageHeader title="Modelos de mensagem do WhatsApp" actions={actions} />
      <div className="-mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-text-low"><span>Canal: <strong className="font-medium text-text-mid">{channel.name}</strong></span><span>Última sincronização: {formatDateTime(lastSync)}</span></div>
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
      {!canManage ? <div className="rounded-md border border-border-2 bg-surface-2 px-4 py-3 text-sm text-text-mid">Você pode consultar os modelos e seus detalhes. Somente administradores podem criar ou sincronizar.</div> : null}
      {sync.isPending ? <div role="status" className="rounded-md border border-info/30 bg-info-bg px-4 py-3 text-sm text-info">Sincronizando com a Meta. Você pode continuar consultando a lista.</div> : null}
      {templates.isError && data ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn"><span>Não foi possível atualizar a lista. Mostrando os dados da última sincronização bem-sucedida ({formatDateTime(lastSync)}).</span><Button variant="ghost" size="sm" onClick={() => void templates.refetch()}>Tentar novamente</Button></div> : null}
      <section aria-label="Filtros dos modelos" className="grid gap-3 rounded-md border border-border-2 bg-surface p-4 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,0.55fr))_auto]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-text-low" aria-hidden /><Input aria-label="Buscar modelo por nome" className="pl-9" value={filters.search} onChange={(e) => patchFilters({ search: e.target.value })} placeholder="Buscar por nome" /></div>
        <select aria-label="Filtrar por status" className={selectClass} value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>{STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select>
        <select aria-label="Filtrar por categoria" className={selectClass} value={filters.category} onChange={(e) => patchFilters({ category: e.target.value })}>{CATEGORY_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select>
        <select aria-label="Filtrar por idioma" className={selectClass} value={filters.language} onChange={(e) => patchFilters({ language: e.target.value })}>{LANGUAGE_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select>
        <Button variant="ghost" disabled={!hasFilters} leftIcon={<FilterX className="size-4" aria-hidden />} onClick={clearFilters}>Limpar</Button>
      </section>
      {templates.isLoading && !data ? <SkeletonList rows={6} /> : templates.isError && !data ? <ErrorState error={templates.error} title="Não foi possível carregar os modelos" reason="A conexão com o catálogo falhou ou expirou." whatToDo="Tente novamente. Se o erro continuar, atualize a conexão do canal." action={<Button variant="secondary" onClick={() => void templates.refetch()}>Tentar novamente</Button>} /> : data && data.templates.length === 0 ? <Card elevation={1}><CardBody><EmptyState icon={FileText} title={hasFilters ? 'Nenhum modelo corresponde aos filtros' : 'Nenhum modelo encontrado neste canal'} description={hasFilters ? 'Ajuste a busca ou limpe os filtros para ver todo o catálogo.' : 'Crie seu primeiro modelo ou sincronize os modelos que já existem na Meta.'} action={hasFilters ? <Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button> : canManage ? <div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={() => void syncNow()}>Sincronizar modelos</Button><Button onClick={() => setCreateOpen(true)}>Criar modelo</Button></div> : undefined} /></CardBody></Card> : data ? <Card elevation={1}><div className="hidden grid-cols-[minmax(0,1.7fr)_minmax(110px,0.7fr)_minmax(120px,0.8fr)_auto] gap-3 border-b border-border-2 px-5 py-3 text-xs font-semibold text-text-low sm:grid"><span>Modelo</span><span>Idioma</span><span>Categoria</span><span className="text-right">Status</span></div><ul className={cn('divide-y divide-border-2', templates.isFetching && 'opacity-70')} aria-busy={templates.isFetching}>{data.templates.map((template) => <TemplateCard key={template.id} template={template} onOpen={() => setSelected(template)} />)}</ul><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-2 px-5 py-4 text-sm text-text-mid"><span>{data.pagination.total} modelo(s) · página {data.pagination.page} de {Math.max(data.pagination.totalPages, 1)}</span><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={data.pagination.page <= 1 || templates.isFetching} onClick={() => patchFilters({ page: filters.page - 1 })}>Anterior</Button><Button variant="secondary" size="sm" disabled={data.pagination.page >= data.pagination.totalPages || templates.isFetching} onClick={() => patchFilters({ page: filters.page + 1 })}>Próxima</Button></div></div></Card> : null}
      <TemplateDetailDrawer channelId={channel.id} channelName={channel.name} template={selected} canUseInCampaign={canUseInCampaign} canManage={canManage} onClose={() => setSelected(null)} onCreateVersion={(template) => { setSelected(null); setCreateSeed(template); setCreateOpen(true); }} />
      {canManage ? <CreateTemplateDrawer channelId={channel.id} channelName={channel.name} open={createOpen} seed={createSeed} onClose={() => { setCreateOpen(false); setCreateSeed(null); }} /> : null}
    </div>
  );
}
