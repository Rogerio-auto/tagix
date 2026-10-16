'use client';

import { useState } from 'react';
import { Copy, Pencil, Plus, ScrollText, Send, Trash2, Webhook } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  Skeleton,
  StatusPill,
  useToast,
  type BadgeTone,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import { Panel, SectionLoading } from '../personal/components';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
  type OutboundWebhook,
  type WebhookDelivery,
} from './queries';

const STATUS: Record<WebhookDelivery['status'], { label: string; tone: BadgeTone }> = {
  sent: { label: 'Entregue', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  retrying: { label: 'Repetindo', tone: 'warning' },
  pending: { label: 'Na fila', tone: 'neutral' },
};

/**
 * Gestão de webhooks outbound (F9-S06) no DS 3.0 (F72-S07): CRUD + seletor de eventos,
 * testar e log de entregas. Lista em `DataTable` (URL e eventos em mono), log de entregas
 * num Drawer (detalhe lateral, UX §2.3) com status em selo e HTTP/tentativa em mono.
 *
 * Segredo: o segredo de assinatura continua aparecendo UMA vez, só no modal pós-criação.
 * Nada novo é exposto.
 *
 * Só leitura (F71-S17): novo, editar, testar (dispara uma entrega) e remover ficam
 * `aria-disabled` com a explicação; o log de entregas é leitura e segue livre.
 */
export default function WebhooksManager(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const webhooksQuery = useWebhooks();
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const test = useTestWebhook();

  const [editing, setEditing] = useState<OutboundWebhook | null>(null); // null = não-editando
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);

  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OutboundWebhook | null>(null);
  const [logTarget, setLogTarget] = useState<OutboundWebhook | null>(null);

  const availableEvents = webhooksQuery.data?.availableEvents ?? [];
  const webhooks = webhooksQuery.data?.webhooks ?? [];
  const deliveries = useWebhookDeliveries(logTarget?.id ?? null);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setUrl('');
    setEvents([]);
    setFormOpen(true);
  };

  const openEdit = (w: OutboundWebhook) => {
    setEditing(w);
    setName(w.name);
    setUrl(w.url);
    setEvents(w.events);
    setFormOpen(true);
  };

  const toggleEvent = (e: string) =>
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const submit = async () => {
    if (!name.trim() || !url.trim() || events.length === 0) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: name.trim(), url: url.trim(), events });
        toast({ variant: 'success', title: 'Webhook atualizado.' });
        setFormOpen(false);
      } else {
        const res = await create.mutateAsync({ name: name.trim(), url: url.trim(), events });
        setFormOpen(false);
        setCreatedSecret(res.secret); // show-once do segredo
      }
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast({ variant: 'success', title: 'Segredo copiado.' });
    } catch {
      toast({ variant: 'error', title: 'Copie manualmente.' });
    }
  };

  const runTest = async (id: string) => {
    try {
      const res = await test.mutateAsync(id);
      toast({
        variant: res.delivered ? 'success' : 'error',
        title: res.delivered
          ? `Entrega OK (HTTP ${res.status ?? 200}).`
          : `Falha: ${res.error ?? `HTTP ${res.status ?? '?'}`}`,
      });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha no teste.' });
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ variant: 'success', title: 'Webhook removido.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao remover.' });
    }
  };

  if (webhooksQuery.isLoading) return <SectionLoading label="Carregando webhooks" />;

  const createButton = (
    <ReadOnlyGuard>
      <Button variant="secondary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={openCreate}>
        Novo webhook
      </Button>
    </ReadOnlyGuard>
  );

  const rowActions = (w: OutboundWebhook) => (
    // Telas largas: as 4 ações numa linha só (a destrutiva nunca cai sozinha embaixo).
    <div className="flex flex-wrap items-center gap-1 md:justify-end xl:flex-nowrap">
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-11"
          leftIcon={<Send className="size-3.5" aria-hidden />}
          loading={test.isPending && test.variables === w.id}
          aria-label={`Testar o webhook ${w.name}`}
          onClick={() => void runTest(w.id)}
        >
          Testar
        </Button>
      </ReadOnlyGuard>
      <Button
        variant="ghost"
        size="sm"
        className="max-md:h-11"
        leftIcon={<ScrollText className="size-3.5" aria-hidden />}
        aria-label={`Ver o log de entregas de ${w.name}`}
        onClick={() => setLogTarget(w)}
      >
        Log
      </Button>
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="max-md:h-11"
          leftIcon={<Pencil className="size-3.5" aria-hidden />}
          aria-label={`Editar o webhook ${w.name}`}
          onClick={() => openEdit(w)}
        >
          Editar
        </Button>
      </ReadOnlyGuard>
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="hover:text-danger max-md:h-11 max-sm:w-11 max-sm:px-0"
          leftIcon={<Trash2 className="size-3.5 text-danger" aria-hidden />}
          aria-label={`Remover o webhook ${w.name}`}
          onClick={() => setDeleteTarget(w)}
        >
          {/* Celular: só o ícone (o nome acessível segue completo) para as 4 ações caberem numa linha. */}
          <span className="max-sm:sr-only">Remover</span>
        </Button>
      </ReadOnlyGuard>
    </div>
  );

  const nameCell = (w: OutboundWebhook) => (
    // `w-0 min-w-full`: sem largura intrínseca — nome/URL longos truncam na coluna em vez de
    // alargar a tabela (que rolaria na horizontal dentro do painel).
    <span className="flex w-0 min-w-full flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold text-text">{w.name}</span>
        {!w.isActive && (
          <Badge tone="neutral" size="sm">
            Inativo
          </Badge>
        )}
      </span>
      <span className="truncate font-mono text-xs text-text-low">{w.url}</span>
    </span>
  );

  const eventsCell = (w: OutboundWebhook) => (
    <span className="block truncate font-mono text-xs text-text-mid" title={w.events.join(', ')}>
      {w.events.join(' · ')}
    </span>
  );

  const columns: DataTableColumn<OutboundWebhook>[] = [
    { id: 'name', header: 'Webhook', cell: nameCell },
    { id: 'events', header: 'Eventos', width: '14rem', cell: eventsCell },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '23rem',
      cell: rowActions,
    },
  ];

  const empty = (
    <EmptyState
      className="py-8"
      icon={Webhook}
      title="Nenhum webhook"
      description="Receba os eventos do workspace numa URL sua, assinados para você verificar a origem."
    />
  );
  const error = (
    <ErrorState
      title="Não foi possível carregar os webhooks"
      reason="A lista não respondeu."
      whatToDo="Tente de novo em instantes."
      action={
        <Button variant="secondary" loading={webhooksQuery.isFetching} onClick={() => void webhooksQuery.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );

  const deliveryList = deliveries.data?.deliveries ?? [];
  const deliveryColumns: DataTableColumn<WebhookDelivery>[] = [
    {
      id: 'event',
      header: 'Evento',
      cell: (d) => <span className="block truncate font-mono text-xs text-text">{d.event}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      width: '7.5rem',
      cell: (d) => (
        <StatusPill tone={STATUS[d.status].tone} size="sm">
          {STATUS[d.status].label}
        </StatusPill>
      ),
    },
    { id: 'http', header: 'HTTP', numeric: true, width: '4.5rem', cell: (d) => d.responseStatus ?? '—' },
    { id: 'attempt', header: 'Tent.', numeric: true, width: '4rem', cell: (d) => formatNumber(d.attempt) },
    {
      id: 'when',
      header: 'Quando',
      numeric: true,
      width: '10rem',
      cell: (d) => <span className="whitespace-nowrap">{formatDateTime(d.sentAt ?? d.createdAt)}</span>,
    },
  ];

  return (
    <Panel
      title="Webhooks outbound"
      description={
        <>
          Recebem eventos do workspace numa URL sua. Cada entrega é assinada com HMAC-SHA256 de{' '}
          <code className="font-mono text-text-mid">timestamp.corpo</code> (headers{' '}
          <code className="font-mono text-text-mid">x-hm-timestamp</code> e{' '}
          <code className="font-mono text-text-mid">x-hm-signature-256</code>); recuse entregas com mais de 5
          minutos.
        </>
      }
      action={createButton}
      body="flush"
    >
      {isMobile ? (
        webhooksQuery.isError ? (
          error
        ) : webhooks.length === 0 ? (
          empty
        ) : (
          <ul aria-label="Webhooks" className="divide-y divide-border">
            {webhooks.map((w) => (
              <li key={w.id} className="flex flex-col gap-2 px-5 py-3">
                {nameCell(w)}
                {eventsCell(w)}
                <div className="-ml-3">{rowActions(w)}</div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <DataTable<OutboundWebhook>
          caption="Webhooks outbound"
          columns={columns}
          rows={webhooks}
          getRowId={(w) => w.id}
          density="compact"
          getRowState={(w) => (w.isActive ? undefined : 'muted')}
          error={webhooksQuery.isError ? error : undefined}
          empty={empty}
          // Painel `flush`: a tabela recorta as linhas no raio interno do painel (raio − 1 px de
          // borda), senão o fundo da última linha cobre o canto arredondado do card.
          className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
        />
      )}

      {/* Criar / editar */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar webhook' : 'Novo webhook'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <ReadOnlyGuard>
              <Button
                variant="primary"
                disabled={!name.trim() || !url.trim() || events.length === 0}
                loading={create.isPending || update.isPending}
                onClick={() => void submit()}
              >
                {editing ? 'Salvar webhook' : 'Criar webhook'}
              </Button>
            </ReadOnlyGuard>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: CRM externo" />
          <Input
            label="URL de destino"
            type="url"
            className="font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://seu-endpoint.com/webhook"
          />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 font-body text-sm font-bold text-text-mid">Eventos</legend>
            {availableEvents.map((e) => (
              <label
                key={e}
                className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 transition-colors duration-(--dur-fast) hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={events.includes(e)}
                  onChange={() => toggleEvent(e)}
                  className="size-4 accent-brand-text"
                />
                <code className="font-mono text-sm text-text">{e}</code>
              </label>
            ))}
          </fieldset>
        </div>
      </Modal>

      {/* Show-once do segredo */}
      <Modal
        open={createdSecret !== null}
        onClose={() => setCreatedSecret(null)}
        title="Guarde o segredo do webhook"
        description="Use-o para verificar a assinatura das entregas (HMAC-SHA256 de timestamp.corpo). Só será exibido uma vez."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreatedSecret(null)}>
              Fechar
            </Button>
            <Button variant="primary" leftIcon={<Copy className="size-4" aria-hidden />} onClick={() => void copySecret()}>
              Copiar segredo
            </Button>
          </div>
        }
      >
        <code className="block break-all rounded-sm border border-border-2 bg-surface-inset px-3 py-2.5 font-mono text-sm text-text">
          {createdSecret}
        </code>
      </Modal>

      {/* Log de entregas: detalhe lateral (UX §2.3) */}
      <Drawer
        open={logTarget !== null}
        onClose={() => setLogTarget(null)}
        title="Log de entregas"
        description={logTarget ? logTarget.name : undefined}
        className="sm:max-w-2xl"
      >
        {deliveries.isLoading ? (
          <div role="status" aria-busy="true" aria-label="Carregando entregas" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <DataTable<WebhookDelivery>
            caption="Entregas do webhook"
            columns={deliveryColumns}
            rows={deliveryList}
            getRowId={(d) => d.id}
            density="compact"
            getRowState={(d) => (d.status === 'failed' ? 'attention' : undefined)}
            error={
              deliveries.isError ? (
                <ErrorState
                  title="Não foi possível carregar as entregas"
                  reason="O log não respondeu."
                  whatToDo="Feche e abra o log de novo em instantes."
                />
              ) : undefined
            }
            empty={
              <EmptyState
                className="py-8"
                icon={ScrollText}
                title="Nenhuma entrega ainda"
                description="Use “Testar” para enviar uma entrega de exemplo."
              />
            }
          />
        )}
      </Drawer>

      {/* Remover */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Remover webhook"
        description="As entregas associadas também serão removidas. Esta ação é irreversível."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void doDelete()}>
              Remover webhook
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-mid">
          Remover <span className="font-semibold text-text">{deleteTarget?.name}</span>?
        </p>
      </Modal>
    </Panel>
  );
}
