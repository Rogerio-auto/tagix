'use client';

import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
  type OutboundWebhook,
} from './queries';

const STATUS_TONE: Record<string, string> = {
  sent: 'text-success',
  failed: 'text-danger',
  retrying: 'text-warn',
  pending: 'text-text-low',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Gestão de webhooks outbound: CRUD + seletor de eventos, testar e log de entregas. */
export default function WebhooksManager(): React.JSX.Element {
  const { toast } = useToast();
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
  const [logTarget, setLogTarget] = useState<string | null>(null);

  const availableEvents = webhooksQuery.data?.availableEvents ?? [];
  const webhooks = webhooksQuery.data?.webhooks ?? [];
  const deliveries = useWebhookDeliveries(logTarget);

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

  if (webhooksQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text">Webhooks outbound</h3>
          <p className="text-xs text-text-low">
            Recebem eventos do workspace em uma URL sua, assinados com HMAC (header
            `x-hm-signature-256`).
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          Novo webhook
        </Button>
      </header>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {webhooks.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-text-low">Nenhum webhook.</li>
        )}
        {webhooks.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm text-text">
                <span className="truncate">{w.name}</span>
                {!w.isActive && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-low">
                    inativo
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-text-low">{w.url}</p>
              <p className="mt-0.5 text-xs text-text-low">{w.events.join(', ')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs">
              <button type="button" onClick={() => void runTest(w.id)} className="text-text-low hover:text-text">
                Testar
              </button>
              <button type="button" onClick={() => setLogTarget(w.id)} className="text-text-low hover:text-text">
                Log
              </button>
              <button type="button" onClick={() => openEdit(w)} className="text-text-low hover:text-text">
                Editar
              </button>
              <button type="button" onClick={() => setDeleteTarget(w)} className="text-text-low hover:text-danger">
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>

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
            <Button
              variant="primary"
              disabled={!name.trim() || !url.trim() || events.length === 0 || create.isPending || update.isPending}
              onClick={() => void submit()}
            >
              {editing ? 'Salvar' : 'Criar'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-low">Nome</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: CRM externo" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-low">URL de destino</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://seu-endpoint.com/webhook" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-text-low">Eventos</legend>
            {availableEvents.map((e) => (
              <label key={e} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={events.includes(e)}
                  onChange={() => toggleEvent(e)}
                  className="accent-brand"
                />
                <code className="text-xs">{e}</code>
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
        description="Use-o para verificar a assinatura HMAC das entregas. Só será exibido uma vez."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreatedSecret(null)}>
              Fechar
            </Button>
            <Button variant="primary" onClick={() => void copySecret()}>
              Copiar segredo
            </Button>
          </div>
        }
      >
        <code className="block break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
          {createdSecret}
        </code>
      </Modal>

      {/* Delivery log */}
      <Modal open={logTarget !== null} onClose={() => setLogTarget(null)} title="Log de entregas">
        {deliveries.isLoading ? (
          <p className="text-sm text-text-low">Carregando…</p>
        ) : (deliveries.data?.deliveries.length ?? 0) === 0 ? (
          <p className="text-sm text-text-low">Nenhuma entrega ainda.</p>
        ) : (
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-auto">
            {deliveries.data?.deliveries.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="text-text">{d.event}</span>
                <span className="flex items-center gap-3 text-text-low">
                  <span className={STATUS_TONE[d.status] ?? 'text-text-low'}>{d.status}</span>
                  <span>HTTP {d.responseStatus ?? '—'}</span>
                  <span>tent. {d.attempt}</span>
                  <span>{fmtDate(d.sentAt ?? d.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>

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
            <Button variant="danger" disabled={remove.isPending} onClick={() => void doDelete()}>
              Remover
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-mid">Remover “{deleteTarget?.name}”?</p>
      </Modal>
    </section>
  );
}
