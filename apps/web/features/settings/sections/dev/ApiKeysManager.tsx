'use client';

import { useState } from 'react';
import { Copy, KeyRound, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  useToast,
  type DataTableColumn,
} from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import { Panel, SectionLoading } from '../personal/components';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, type ApiKey } from './queries';

/** Scopes oferecidos — espelham `API_SCOPES` da API v1 (apps/api). */
const SCOPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'read:conversations', label: 'Ler conversas' },
  { value: 'write:messages', label: 'Enviar mensagens' },
  { value: 'write:templates', label: 'Enviar templates' },
  { value: 'write:contacts', label: 'Gravar contatos' },
  { value: 'write:flows', label: 'Disparar flows' },
];

/** "Último uso": data e hora no idioma da interface; nunca usada → texto, não traço. */
function lastUsed(iso: string | null): string {
  return iso ? formatDateTime(iso) : 'Nunca usada';
}

/**
 * Gestão de API keys (F9-S06) no DS 3.0 (F72-S07): criar (show-once + copiar), listar,
 * revogar (digitar o nome para confirmar, UX §2.9). Desktop em `DataTable` (prefixo, limite
 * e último uso em mono), celular em cards.
 *
 * Segredo: o token continua aparecendo UMA vez, só no modal pós-criação; a lista mostra só
 * o prefixo (`keyPrefix…`), como antes. Nada novo é exposto.
 *
 * Só leitura (F71-S17): "Nova chave" e "Revogar" ficam `aria-disabled` com a explicação.
 */
export default function ApiKeysManager(): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
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

  if (keysQuery.isLoading) return <SectionLoading label="Carregando API keys" />;

  const createButton = (
    <ReadOnlyGuard>
      <Button variant="secondary" leftIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
        Nova chave
      </Button>
    </ReadOnlyGuard>
  );

  const revokeButton = (k: ApiKey) =>
    k.isActive ? (
      <ReadOnlyGuard>
        <Button
          variant="ghost"
          size="sm"
          className="hover:text-danger max-md:h-11"
          aria-label={`Revogar a chave ${k.name}`}
          onClick={() => {
            setRevokeTarget(k);
            setConfirmText('');
          }}
        >
          Revogar
        </Button>
      </ReadOnlyGuard>
    ) : null;

  const nameCell = (k: ApiKey) => (
    // `w-0 min-w-full`: sem largura intrínseca — nome/URL longos truncam na coluna em vez de
    // alargar a tabela (que rolaria na horizontal dentro do painel).
    <span className="flex w-0 min-w-full flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-semibold text-text">{k.name}</span>
        {!k.isActive && (
          <Badge tone="danger" size="sm">
            Revogada
          </Badge>
        )}
      </span>
      <span className="truncate font-mono text-xs text-text-low">{k.scopes.join(' · ') || 'sem scopes'}</span>
    </span>
  );

  const columns: DataTableColumn<ApiKey>[] = [
    { id: 'name', header: 'Chave', cell: nameCell },
    {
      id: 'prefix',
      header: 'Prefixo',
      width: '9rem',
      cell: (k) => <code className="font-mono text-sm text-text-mid">{k.keyPrefix}…</code>,
    },
    {
      id: 'rate',
      header: 'Limite',
      numeric: true,
      width: '7rem',
      cell: (k) => `${formatNumber(k.rateLimitPerMinute)}/min`,
    },
    { id: 'lastUsed', header: 'Último uso', numeric: true, width: '10rem', cell: (k) => <span className="whitespace-nowrap">{lastUsed(k.lastUsedAt)}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '7rem',
      cell: revokeButton,
    },
  ];

  const empty = (
    <EmptyState
      className="py-8"
      icon={KeyRound}
      title="Nenhuma API key"
      description="Crie uma chave para integrar n8n, seu CRM ou um script à API pública."
    />
  );
  const error = (
    <ErrorState
      title="Não foi possível carregar as chaves"
      reason="A lista de API keys não respondeu."
      whatToDo="Tente de novo em instantes."
      action={
        <Button variant="secondary" loading={keysQuery.isFetching} onClick={() => void keysQuery.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );

  return (
    <Panel
      title="API keys"
      description={
        <>
          Autenticam a API pública (<code className="font-mono text-text-mid">Authorization: Bearer hm_…</code>). O
          token só aparece na criação.
        </>
      }
      action={createButton}
      body="flush"
    >
      {isMobile ? (
        keysQuery.isError ? (
          error
        ) : keys.length === 0 ? (
          empty
        ) : (
          <ul aria-label="API keys" className="divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 px-5 py-3">
                {nameCell(k)}
                <p className="flex flex-wrap gap-x-3 font-mono text-xs tabular-nums text-text-mid">
                  <span>{k.keyPrefix}…</span>
                  <span>{formatNumber(k.rateLimitPerMinute)}/min</span>
                  <span>{lastUsed(k.lastUsedAt)}</span>
                </p>
                {k.isActive && <div className="-ml-3">{revokeButton(k)}</div>}
              </li>
            ))}
          </ul>
        )
      ) : (
        <DataTable<ApiKey>
          caption="API keys"
          columns={columns}
          rows={keys}
          getRowId={(k) => k.id}
          density="compact"
          getRowState={(k) => (k.isActive ? undefined : 'muted')}
          error={keysQuery.isError ? error : undefined}
          empty={empty}
          // Painel `flush`: a tabela recorta as linhas no raio interno do painel (raio − 1 px de
          // borda), senão o fundo da última linha cobre o canto arredondado do card.
          className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
        />
      )}

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
            <ReadOnlyGuard>
              <Button
                variant="primary"
                disabled={!name.trim() || scopes.length === 0}
                loading={create.isPending}
                onClick={() => void submitCreate()}
              >
                Criar chave
              </Button>
            </ReadOnlyGuard>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Integração n8n" />
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-2 font-body text-sm font-bold text-text-mid">Scopes</legend>
            {SCOPES.map((s) => (
              <label
                key={s.value}
                className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 font-body text-sm text-text transition-colors duration-(--dur-fast) hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                  className="size-4 accent-brand-text"
                />
                <span className="flex-1">{s.label}</span>
                <code className="font-mono text-xs text-text-low">{s.value}</code>
              </label>
            ))}
          </fieldset>
          <Input
            label="Rate limit (req/min)"
            type="number"
            inputMode="numeric"
            className="font-mono tabular-nums"
            value={rateLimit}
            onChange={(e) => setRateLimit(e.target.value)}
            min={1}
          />
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
            <Button variant="primary" leftIcon={<Copy className="size-4" aria-hidden />} onClick={() => void copyToken()}>
              Copiar token
            </Button>
          </div>
        }
      >
        <code className="block break-all rounded-sm border border-border-2 bg-surface-inset px-3 py-2.5 font-mono text-sm text-text">
          {createdToken}
        </code>
      </Modal>

      {/* Revogar (digitar o nome para confirmar) */}
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
              disabled={confirmText !== revokeTarget?.name}
              loading={revoke.isPending}
              onClick={() => void doRevoke()}
            >
              Revogar chave
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
    </Panel>
  );
}
