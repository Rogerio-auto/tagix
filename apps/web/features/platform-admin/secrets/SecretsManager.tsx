'use client';

/**
 * PlatformSecrets (F25-S08) no DS 3.0 (F72-S08) — lista de chaves de plataforma
 * (versão e data da última rotação, NUNCA o valor) e rotação com confirmação explícita
 * (§2.9 botão-suicida: valor errado derruba a integração). Consome F25-S04 via hooks.
 *
 * SEGURANÇA (repintura, sem mudança de fluxo): a listagem continua só com metadados
 * (`key`, `keyVersion`, `updatedAt`, `isSet`); o valor novo só existe no campo `password`
 * do modal (sem autocomplete), vai uma vez em `useRotateSecret` e não é exibido, copiado
 * nem guardado. O botão de rotação continua exigindo valor + a caixa "Entendo…".
 */
import { useId, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { Badge, Button, DataTable, ErrorState, Input, Modal, Skeleton, useToast, type DataTableColumn } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import type { PlatformSecretMeta } from '@/features/platform-admin/lib';
import { PlatformPageHeader } from '../ui/PlatformPageHeader';
import { Panel } from '../ui/kit';
import { useRotateSecret, useSecrets } from './queries';

const SECRET_HELP: Record<string, string> = {
  openrouter_api_key:
    'Chave da OpenRouter usada por TODOS os agentes (chat). Valor errado derruba os agentes de todos os workspaces.',
  openai_api_key: 'Chave OpenAI direta (embeddings, transcrição, visão).',
  meta_app_id: 'Meta App ID compartilhado (WhatsApp + Instagram).',
  meta_app_secret: 'App Secret para o HMAC dos webhooks Meta. Valor errado quebra a verificação de webhook.',
  meta_webhook_verify_token: 'Token de verificação do handshake de webhook da Meta.',
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function RotateModal({ secret, onClose }: { secret: PlatformSecretMeta; onClose: () => void }) {
  const rotate = useRotateSecret();
  const { toast } = useToast();
  const confirmId = useId();
  const [value, setValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    if (value.trim() === '') return;
    try {
      const r = await rotate.mutateAsync({ key: secret.key, value: value.trim() });
      toast({
        variant: 'success',
        title: 'Segredo rotacionado',
        description: `${secret.key} → versão ${r.secret.keyVersion}. Registrado na auditoria.`,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha na rotação', description: msg });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rotacionar ${secret.key}`}
      description="O valor atual será substituído. A rotação é auditada."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            loading={rotate.isPending}
            disabled={!confirmed || value.trim() === ''}
          >
            {rotate.isPending ? 'Rotacionando…' : 'Rotacionar agora'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/10 px-3 py-2.5 font-body text-sm text-text">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <span>{SECRET_HELP[secret.key] ?? 'Operação sensível: confirme o valor antes de salvar.'}</span>
        </p>
        <Input
          label="Novo valor"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          placeholder="Cole o novo valor"
          className="font-mono"
        />
        <label htmlFor={confirmId} className="flex cursor-pointer items-start gap-3 font-body text-sm text-text-mid">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-warn"
          />
          Entendo que um valor errado pode derrubar a integração.
        </label>
      </div>
    </Modal>
  );
}

export function SecretsManager() {
  const { isMobile } = useBreakpoint();
  const query = useSecrets();
  const [rotating, setRotating] = useState<PlatformSecretMeta | null>(null);
  const secrets = query.data?.secrets ?? [];

  const versionLabel = (s: PlatformSecretMeta) =>
    s.isSet ? (
      <Badge tone="success" size="sm" dot>
        Configurado
      </Badge>
    ) : (
      <Badge tone="warning" size="sm" dot>
        Não configurado
      </Badge>
    );

  const rotateButton = (s: PlatformSecretMeta) => (
    <Button
      variant="outline"
      size="sm"
      className="max-md:h-11"
      aria-label={`${s.isSet ? 'Rotacionar' : 'Definir'} ${s.key}`}
      onClick={() => setRotating(s)}
    >
      {s.isSet ? 'Rotacionar' : 'Definir'}
    </Button>
  );

  const columns: DataTableColumn<PlatformSecretMeta>[] = [
    {
      id: 'key',
      header: 'Chave',
      cell: (s) => (
        <span className="flex min-w-0 items-center gap-3">
          <KeyRound className="size-4 shrink-0 text-text-low" aria-hidden />
          <span className="truncate font-mono text-sm text-text">{s.key}</span>
        </span>
      ),
    },
    { id: 'state', header: 'Estado', width: '10rem', cell: versionLabel },
    {
      id: 'version',
      header: 'Versão',
      numeric: true,
      width: '6rem',
      cell: (s) => <span className="text-text-mid">{s.isSet ? `v${formatNumber(s.keyVersion)}` : '—'}</span>,
    },
    {
      id: 'updatedAt',
      header: 'Última rotação',
      numeric: true,
      width: '10.5rem',
      cell: (s) => <span className="whitespace-nowrap text-text-mid">{formatDateTime(s.updatedAt, DATE_TIME)}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Ações</span>,
      headerLabel: 'Ações',
      align: 'right',
      width: '8rem',
      cell: rotateButton,
    },
  ];

  const error = (
    <ErrorState
      title="Não foi possível carregar os segredos"
      reason="A lista de chaves de plataforma não respondeu."
      whatToDo="Verifique se você tem acesso de plataforma e tente novamente."
      reference={query.error instanceof ApiError ? query.error.ref : undefined}
      action={
        <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col">
      <PlatformPageHeader
        href="/platform/secrets"
        title="Segredos"
        description="Chaves de plataforma. O valor nunca é exibido: só a versão e a data da última rotação."
        help={<p>Rotacionar substitui o valor na hora. Confira o valor novo antes: não há como ver o antigo.</p>}
      />

      <Panel
        title="Chaves de plataforma"
        titleId="secrets-list"
        icon={ShieldAlert}
        tone="warn"
        description="Valor errado derruba integrações de todos os workspaces."
        body="flush"
      >
        {isMobile ? (
          query.isLoading ? (
            <div role="status" aria-busy="true" aria-label="Carregando segredos" className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </div>
          ) : query.isError ? (
            error
          ) : (
            <ul aria-label="Chaves de plataforma" className="divide-y divide-border">
              {secrets.map((s) => (
                <li key={s.key} className="flex flex-col gap-2 px-5 py-4">
                  <span className="flex min-w-0 items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-text-low" aria-hidden />
                    <span className="truncate font-mono text-sm text-text">{s.key}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums text-text-low">
                    {versionLabel(s)}
                    {s.isSet && <span>v{formatNumber(s.keyVersion)}</span>}
                    {s.updatedAt && <span>{formatDateTime(s.updatedAt, DATE_TIME)}</span>}
                  </span>
                  <span>{rotateButton(s)}</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <DataTable<PlatformSecretMeta>
            caption="Chaves de plataforma"
            columns={columns}
            rows={secrets}
            getRowId={(s) => s.key}
            density="compact"
            loading={query.isLoading}
            loadingRows={5}
            getRowState={(s) => (s.isSet ? undefined : 'attention')}
            error={query.isError ? error : undefined}
            className="rounded-t-none rounded-b-[calc(var(--radius-lg)-1px)] border-0"
          />
        )}
      </Panel>

      {rotating && <RotateModal secret={rotating} onClose={() => setRotating(null)} />}
    </div>
  );
}
