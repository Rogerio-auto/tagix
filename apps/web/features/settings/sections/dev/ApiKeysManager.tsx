'use client';

import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
} from './queries';

/** Scopes oferecidos — espelham `API_SCOPES` da API v1 (apps/api). */
const SCOPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'read:conversations', label: 'Ler conversas' },
  { value: 'write:messages', label: 'Enviar mensagens' },
  { value: 'write:templates', label: 'Enviar templates' },
  { value: 'write:contacts', label: 'Gravar contatos' },
  { value: 'write:flows', label: 'Disparar flows' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Gestão de API keys: criar (show-once + copiar), listar, revogar (typing-to-confirm). */
export default function ApiKeysManager(): React.JSX.Element {
  const { toast } = useToast();
  const keysQuery = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [rateLimit, setRateLimit] = useState('60');

  // Token recém-criado (show-once). Permanece só enquanto o modal estiver aberto.
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const keys = keysQuery.data?.apiKeys ?? [];

  const toggleScope = (s: string) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const resetCreate = () => {
    setName('');
    setScopes([]);
    setRateLimit('60');
  };

  const submitCreate = async () => {
    if (!name.trim() || scopes.length === 0) return;
    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        scopes,
        rateLimitPerMinute: Number(rateLimit) || 60,
      });
      setCreating(false);
      resetCreate();
      setCreatedToken(res.token); // abre o modal show-once
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao criar a chave.' });
    }
  };

  const copyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      toast({ variant: 'success', title: 'Token copiado.' });
    } catch {
      toast({ variant: 'error', title: 'Não foi possível copiar — selecione e copie manualmente.' });
    }
  };

  const doRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync(revokeTarget.id);
      setRevokeTarget(null);
      setConfirmText('');
      toast({ variant: 'success', title: 'Chave revogada.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao revogar.' });
    }
  };

  if (keysQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text">API keys</h3>
          <p className="text-xs text-text-low">
            Autenticam a API pública (`Authorization: Bearer hm_...`). O token só aparece na criação.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Nova chave
        </Button>
      </header>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {keys.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-text-low">Nenhuma API key.</li>
        )}
        {keys.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm text-text">
                <span className="truncate">{k.name}</span>
                <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-text-mid">
                  {k.keyPrefix}…
                </code>
                {!k.isActive && (
                  <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">
                    revogada
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-text-low">
                {k.scopes.join(', ') || 'sem scopes'} · {k.rateLimitPerMinute}/min · último uso{' '}
                {fmtDate(k.lastUsedAt)}
              </p>
            </div>
            {k.isActive && (
              <button
                type="button"
                onClick={() => {
                  setRevokeTarget(k);
                  setConfirmText('');
                }}
                className="shrink-0 text-xs text-text-low hover:text-danger"
              >
                Revogar
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* Criar chave */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false);
          resetCreate();
        }}
        title="Nova API key"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                resetCreate();
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || scopes.length === 0 || create.isPending}
              onClick={() => void submitCreate()}
            >
              Criar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-low">Nome</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Integração n8n" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-text-low">Scopes</legend>
            {SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                  className="accent-brand"
                />
                {s.label}
                <code className="text-xs text-text-low">{s.value}</code>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-low">Rate limit (req/min)</span>
            <Input
              type="number"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              min={1}
            />
          </label>
        </div>
      </Modal>

      {/* Show-once do token */}
      <Modal
        open={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        title="Guarde sua API key agora"
        description="Este token só será exibido uma vez. Copie e armazene em local seguro — não há como recuperá-lo depois."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreatedToken(null)}>
              Fechar
            </Button>
            <Button variant="primary" onClick={() => void copyToken()}>
              Copiar token
            </Button>
          </div>
        }
      >
        <code className="block break-all rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
          {createdToken}
        </code>
      </Modal>

      {/* Revogar (typing-to-confirm) */}
      <Modal
        open={revokeTarget !== null}
        onClose={() => {
          setRevokeTarget(null);
          setConfirmText('');
        }}
        title="Revogar API key"
        description={`Digite o nome da chave (“${revokeTarget?.name ?? ''}”) para confirmar. A revogação é imediata e irreversível.`}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setRevokeTarget(null);
                setConfirmText('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={confirmText !== revokeTarget?.name || revoke.isPending}
              onClick={() => void doRevoke()}
            >
              Revogar
            </Button>
          </div>
        }
      >
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={revokeTarget?.name}
          aria-label="Confirmação do nome da chave"
        />
      </Modal>
    </section>
  );
}
