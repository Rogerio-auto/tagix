'use client';

/**
 * PlatformSecrets (F25-S08) — lista de keys de plataforma (key_version/updated_at,
 * NUNCA o valor) e rotação com confirmação explícita (§2.9 botao-suicida: pode
 * derrubar a integracao se o valor estiver errado). Cada key tem help inline (§2.5).
 * Consome F25-S04 via hooks. DS v2 dark-first.
 */
import { useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/shared/lib/api-client';
import { Skeleton } from '@/shared/components/feedback';
import type { PlatformSecretMeta } from '@/features/platform-admin/lib';
import { useRotateSecret, useSecrets } from './queries';

const SECRET_HELP: Record<string, string> = {
  openrouter_api_key: 'Key da OpenRouter usada por TODOS os agentes (chat). Valor errado derruba os agentes de todos os workspaces.',
  openai_api_key: 'Key OpenAI direta (embeddings, transcricao, visao).',
  meta_app_id: 'Meta App ID compartilhado (WhatsApp + Instagram).',
  meta_app_secret: 'App Secret para HMAC dos webhooks Meta. Valor errado quebra a verificacao de webhook.',
  meta_webhook_verify_token: 'Token de verificacao do handshake de webhook da Meta.',
};

function RotateModal({ secret, onClose }: { secret: PlatformSecretMeta; onClose: () => void }) {
  const rotate = useRotateSecret();
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const submit = async () => {
    if (value.trim() === '') return;
    try {
      const r = await rotate.mutateAsync({ key: secret.key, value: value.trim() });
      toast({
        variant: 'success',
        title: 'Secret rotacionado',
        description: `${secret.key} -> versao ${r.secret.keyVersion}. Auditado.`,
      });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Tente novamente.';
      toast({ variant: 'error', title: 'Falha na rotacao', description: msg });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Rotacionar ${secret.key}`}
      description="O valor antigo sera substituido. A rotacao e auditada."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={!confirmed || value.trim() === '' || rotate.isPending}>
            {rotate.isPending ? 'Rotacionando...' : 'Rotacionar agora'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-sm text-text">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <span>{SECRET_HELP[secret.key] ?? 'Operacao sensivel: confirme o valor antes de salvar.'}</span>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Novo valor</span>
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            placeholder="cole o novo valor"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-text-mid">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-4 accent-[var(--warn)]" />
          Entendo que um valor errado pode derrubar a integracao.
        </label>
      </div>
    </Modal>
  );
}

export function SecretsManager() {
  const { data, isLoading, isError } = useSecrets();
  const [rotating, setRotating] = useState<PlatformSecretMeta | null>(null);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h1 className="font-head text-xl font-semibold text-text">Secrets</h1>
        <p className="mt-1 text-sm text-text-mid">
          Chaves de plataforma. O valor nunca e exibido — apenas a versao e a data da ultima rotacao.
        </p>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <p className="rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-text">
          Nao foi possivel carregar os secrets.
        </p>
      )}

      {data && (
        <ul className="flex flex-col gap-2">
          {data.secrets.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex min-w-0 items-center gap-3">
                <KeyRound className="size-5 shrink-0 text-text-low" aria-hidden />
                <div className="min-w-0">
                  <div className="font-mono text-sm text-text">{s.key}</div>
                  <div className="text-xs text-text-low">
                    {s.isSet ? `versao ${s.keyVersion}` : 'nao configurado'}
                    {s.updatedAt ? ` - atualizado ${new Date(s.updatedAt).toLocaleString('pt-BR')}` : ''}
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setRotating(s)}>
                {s.isSet ? 'Rotacionar' : 'Definir'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {rotating && <RotateModal secret={rotating} onClose={() => setRotating(null)} />}
    </section>
  );
}
