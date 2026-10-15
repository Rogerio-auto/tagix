'use client';

/**
 * Conexões Meta do workspace (F69-S02; DS 3.0 na F72-S07).
 *
 * A tela responde três perguntas, nesta ordem: **está funcionando?**, **o que
 * parou?** e **o que eu faço?**. Por isso cada conexão mostra a saúde em
 * linguagem de dono, cada caso de uso diz o que falta, e o botão de reconectar
 * pede de novo só as permissões desses casos de uso.
 *
 * Nenhum token passa por aqui: o login devolve um `code`, o servidor troca e guarda.
 *
 * UX: §2.7 loading por botão; §2.9 remover confirma em linha; §2.11 erro em 3 partes.
 * Só leitura: conectar, reconectar, atualizar e remover ficam `aria-disabled`.
 */

import type * as React from 'react';
import { useState } from 'react';
import { Check, Link2Off, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button, ErrorState, StatusPill, useToast, type BadgeTone } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { Skeleton } from '@/shared/components/feedback';
import { PageHeader } from '@/shared/components/layout/PageHeader';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { formatNumber } from '@/shared/lib/locale';
import { metaLoginConfig, startMetaConnect } from '@/features/channels/fb-login';
import {
  useCreateMetaConnection,
  useMetaConnections,
  useMetaUseCases,
  useRefreshMetaConnection,
  useRemoveMetaConnection,
} from './queries';
import type { MetaConnectionHealth, MetaConnectionView, MetaUseCaseId } from './types';

const SAUDE: Readonly<Record<MetaConnectionHealth, { label: string; tom: BadgeTone }>> = {
  ok: { label: 'Funcionando', tom: 'success' },
  expiring: { label: 'Expira em breve — reconecte', tom: 'warning' },
  missing_permissions: { label: 'Falta permissão', tom: 'warning' },
  expired: { label: 'Expirada — reconecte', tom: 'danger' },
  revoked: { label: 'Acesso removido — reconecte', tom: 'danger' },
};

/** O que começa marcado: o que muda o dia do cliente (leads) e o que mostra resultado. */
const PADRAO: readonly MetaUseCaseId[] = ['leads', 'ads_read'];

const eyebrow = 'font-mono text-xs font-medium uppercase tracking-widest text-text-low';

function mensagemDe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Tente de novo.';
}

const TITLE = 'Meta — Facebook e Instagram';

export function MetaConnectionsPanel(): React.JSX.Element {
  const { toast } = useToast();
  const config = metaLoginConfig();
  const casos = useMetaUseCases();
  const conexoes = useMetaConnections();
  const criar = useCreateMetaConnection();
  const reler = useRefreshMetaConnection();
  const remover = useRemoveMetaConnection();

  const [escolhidos, setEscolhidos] = useState<MetaUseCaseId[]>([...PADRAO]);
  const [conectando, setConectando] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);

  const opcoes = casos.data?.useCases ?? [];

  // As permissões pedidas vêm da configuração do Facebook Login for Business (F69-S12); os casos de
  // uso escolhidos continuam indo ao servidor, que confere o que foi concedido e diz o que falta.
  const conectar = async (useCases: MetaUseCaseId[]): Promise<void> => {
    if (useCases.length === 0) return;
    setConectando(true);
    try {
      const { code } = await startMetaConnect();
      await criar.mutateAsync({ code, useCases });
      toast({ variant: 'success', title: 'Meta conectada' });
    } catch (err) {
      toast({ variant: 'error', title: 'Não foi possível conectar', description: mensagemDe(err) });
    } finally {
      setConectando(false);
    }
  };

  if (!config.configured) {
    return (
      <div className="flex flex-col">
        <PageHeader title={TITLE} />
        <div className="flex items-start gap-3 rounded-lg border border-warn/25 bg-warn/10 px-5 py-4">
          <Link2Off className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-head text-base font-semibold text-text">
              O login da Meta ainda não está configurado nesta instalação.
            </p>
            <p className="font-body text-sm text-text-mid">
              Falta a configuração do Facebook Login for Business do app. Peça ao administrador da
              plataforma.
            </p>
            <p className="mt-1 font-mono text-xs text-text-mid">Ausente: {config.missing.join(', ')}</p>
          </div>
        </div>
      </div>
    );
  }

  const lista = conexoes.data?.connections ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={TITLE}
        description="Escolha o que o Leadium pode fazer na sua conta da Meta. Você pode acrescentar mais depois."
      />

      <div className="flex flex-col gap-6">
        {/* ── Nova conexão ─────────────────────────────────────────────────── */}
        <section aria-labelledby="meta-conectar" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="meta-conectar" className="font-head text-h4 text-text">
            Conectar
          </h2>
          <fieldset className="mt-4 grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Casos de uso</legend>
            {casos.isLoading &&
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
            {opcoes.map((o) => {
              const marcado = escolhidos.includes(o.id);
              return (
                <label
                  key={o.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3',
                    'transition-colors duration-(--dur-fast) ease-ds focus-within:focus-ring',
                    marcado
                      ? 'border-brand-text/40 bg-brand-text/[0.06]'
                      : 'border-border bg-surface hover:border-border-2 hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-brand-text"
                    checked={marcado}
                    onChange={(e) =>
                      setEscolhidos((atual) =>
                        e.target.checked ? [...atual, o.id] : atual.filter((x) => x !== o.id),
                      )
                    }
                  />
                  <span className="font-body text-sm font-bold text-text">{o.label}</span>
                </label>
              );
            })}
          </fieldset>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <ReadOnlyGuard align="start">
              <Button
                variant="primary"
                loading={conectando}
                disabled={escolhidos.length === 0 || opcoes.length === 0}
                onClick={() => void conectar(escolhidos)}
              >
                Conectar com a Meta
              </Button>
            </ReadOnlyGuard>
            <span className="font-body text-sm text-text-low">
              <span className="font-mono tabular-nums text-text-mid">{formatNumber(escolhidos.length)}</span>{' '}
              {escolhidos.length === 1 ? 'caso de uso escolhido' : 'casos de uso escolhidos'}
            </span>
          </div>
        </section>

        {/* ── Conexões existentes ──────────────────────────────────────────── */}
        <section aria-labelledby="meta-conexoes" className="flex flex-col gap-3">
          <h2 id="meta-conexoes" className={eyebrow}>
            Conexões
          </h2>
          {conexoes.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}
          {conexoes.isError && (
            <div className="rounded-lg border border-border bg-surface">
              <ErrorState
                title="Não foi possível carregar as conexões"
                reason={mensagemDe(conexoes.error)}
                whatToDo="Tente de novo em instantes."
                action={
                  <Button variant="secondary" size="sm" onClick={() => void conexoes.refetch()}>
                    Tentar de novo
                  </Button>
                }
              />
            </div>
          )}
          {conexoes.data && lista.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-5 py-6 text-center font-body text-sm text-text-mid">
              Nenhuma conexão ainda. Escolha os casos de uso acima e conecte com a Meta.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {lista.map((c: MetaConnectionView) => {
              const saude = SAUDE[c.health];
              const precisaReconectar = c.health !== 'ok';
              return (
                <li key={c.id} className="rounded-lg border border-border bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-head text-base font-semibold text-text">
                      {c.metaUserName ?? 'Conta da Meta'}
                    </p>
                    <StatusPill tone={saude.tom} size="sm" live={c.health === 'ok'}>
                      {saude.label}
                    </StatusPill>
                  </div>

                  <ul className="mt-3 flex flex-col gap-1.5">
                    {c.useCases.map((u) => (
                      <li key={u.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-sm">
                        {u.missing.length === 0 ? (
                          <Check className="size-4 shrink-0 text-success" aria-hidden />
                        ) : (
                          <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
                        )}
                        <span className="text-text">{u.label}</span>
                        {u.missing.length === 0 ? (
                          <span className="text-text-low">· funcionando</span>
                        ) : (
                          <span className="text-warn">
                            · falta autorizar: <span className="font-mono text-xs">{u.missing.join(', ')}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-3 font-body text-sm text-text-low">
                    <span className="font-mono tabular-nums text-text-mid">{formatNumber(c.assets.pages.length)}</span>{' '}
                    página(s) ·{' '}
                    <span className="font-mono tabular-nums text-text-mid">
                      {formatNumber(c.assets.adAccounts.length)}
                    </span>{' '}
                    conta(s) de anúncio
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                    {precisaReconectar && (
                      <ReadOnlyGuard align="start">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={conectando}
                          // Reabre o login da configuração: com `auth_type: 'rerequest'`, a Meta
                          // pergunta de novo pelo que a pessoa recusou antes.
                          onClick={() => void conectar(c.useCases.map((u) => u.id))}
                        >
                          Reconectar
                        </Button>
                      </ReadOnlyGuard>
                    )}
                    <ReadOnlyGuard align="start">
                      <Button
                        variant="secondary"
                        size="sm"
                        leftIcon={<RefreshCw className="size-3.5" aria-hidden="true" />}
                        loading={reler.isPending && reler.variables === c.id}
                        disabled={c.status === 'revoked'}
                        onClick={() =>
                          reler.mutate(c.id, {
                            onError: (err) =>
                              toast({ variant: 'error', title: 'Não foi possível atualizar', description: mensagemDe(err) }),
                          })
                        }
                      >
                        Atualizar
                      </Button>
                    </ReadOnlyGuard>
                    {confirmandoRemocao === c.id ? (
                      <>
                        <ReadOnlyGuard align="start">
                          <Button
                            variant="danger"
                            size="sm"
                            loading={remover.isPending}
                            onClick={() =>
                              remover.mutate(c.id, {
                                onSettled: () => setConfirmandoRemocao(null),
                                onError: (err) =>
                                  toast({ variant: 'error', title: 'Não foi possível remover', description: mensagemDe(err) }),
                              })
                            }
                          >
                            Confirmar remoção
                          </Button>
                        </ReadOnlyGuard>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmandoRemocao(null)}>
                          Cancelar
                        </Button>
                      </>
                    ) : (
                      <ReadOnlyGuard align="start">
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                          onClick={() => setConfirmandoRemocao(c.id)}
                        >
                          Remover
                        </Button>
                      </ReadOnlyGuard>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
