'use client';

/**
 * Conexões Meta do workspace (F69-S02).
 *
 * A tela responde três perguntas, nesta ordem: **está funcionando?**, **o que
 * parou?** e **o que eu faço?**. Por isso cada conexão mostra a saúde em
 * linguagem de dono, cada caso de uso diz o que falta, e o botão de reconectar
 * pede de novo só as permissões desses casos de uso.
 *
 * Nenhum token passa por aqui: o login devolve um `code`, o servidor troca e guarda.
 */

import type * as React from 'react';
import { useState } from 'react';
import { Check, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { metaSignupConfig, startMetaConnect } from '@/features/channels/fb-login';
import {
  useCreateMetaConnection,
  useMetaConnections,
  useMetaUseCases,
  useRefreshMetaConnection,
  useRemoveMetaConnection,
} from './queries';
import type { MetaConnectionHealth, MetaConnectionView, MetaUseCaseId, MetaUseCaseOption } from './types';

const SAUDE: Readonly<Record<MetaConnectionHealth, { label: string; tom: 'ok' | 'aviso' | 'erro' }>> = {
  ok: { label: 'Funcionando', tom: 'ok' },
  expiring: { label: 'Expira em breve — reconecte', tom: 'aviso' },
  missing_permissions: { label: 'Falta permissão', tom: 'aviso' },
  expired: { label: 'Expirada — reconecte', tom: 'erro' },
  revoked: { label: 'Acesso removido — reconecte', tom: 'erro' },
};

const TOM_CLASSE = {
  ok: 'text-brand',
  aviso: 'text-warning',
  erro: 'text-danger',
} as const;

/** O que começa marcado: o que muda o dia do cliente (leads) e o que mostra resultado. */
const PADRAO: readonly MetaUseCaseId[] = ['leads', 'ads_read'];

function permissoesDe(opcoes: readonly MetaUseCaseOption[], ids: readonly MetaUseCaseId[]): string[] {
  const set = new Set<string>();
  for (const o of opcoes) if (ids.includes(o.id)) o.permissions.forEach((p) => set.add(p));
  return [...set];
}

function mensagemDe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Tente de novo.';
}

export function MetaConnectionsPanel(): React.JSX.Element {
  const { toast } = useToast();
  const config = metaSignupConfig();
  const casos = useMetaUseCases();
  const conexoes = useMetaConnections();
  const criar = useCreateMetaConnection();
  const reler = useRefreshMetaConnection();
  const remover = useRemoveMetaConnection();

  const [escolhidos, setEscolhidos] = useState<MetaUseCaseId[]>([...PADRAO]);
  const [conectando, setConectando] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState<string | null>(null);

  const opcoes = casos.data?.useCases ?? [];

  const conectar = async (useCases: MetaUseCaseId[], soEstas?: string[]): Promise<void> => {
    if (useCases.length === 0) return;
    setConectando(true);
    try {
      const escopo =
        soEstas !== undefined && soEstas.length > 0 ? soEstas : permissoesDe(opcoes, useCases);
      const { code } = await startMetaConnect(escopo);
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
      <div className="rounded-md border border-border bg-surface p-5">
        <p className="text-body text-text">O login da Meta ainda não está configurado nesta instalação.</p>
        <p className="mt-1 text-small text-text-2">Peça ao administrador da plataforma para configurar o app da Meta.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-head text-h2 text-text">Meta — Facebook e Instagram</h1>
        <p className="mt-1 text-body text-text-2">
          Escolha o que o Leadium pode fazer na sua conta da Meta. Você pode acrescentar mais depois.
        </p>
      </header>

      {/* ── Nova conexão ─────────────────────────────────────────────────────── */}
      <section className="rounded-md border border-border bg-surface p-5">
        <h2 className="font-head text-h3 text-text">Conectar</h2>
        <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Casos de uso</legend>
          {opcoes.map((o) => {
            const marcado = escolhidos.includes(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border p-3',
                  marcado ? 'border-brand bg-surface-2' : 'border-border',
                )}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={(e) =>
                    setEscolhidos((atual) =>
                      e.target.checked ? [...atual, o.id] : atual.filter((x) => x !== o.id),
                    )
                  }
                />
                <span className="text-body text-text">{o.label}</span>
              </label>
            );
          })}
        </fieldset>
        <div className="mt-4">
          <Button
            variant="primary"
            loading={conectando}
            disabled={escolhidos.length === 0 || opcoes.length === 0}
            onClick={() => void conectar(escolhidos)}
          >
            Conectar com a Meta
          </Button>
        </div>
      </section>

      {/* ── Conexões existentes ──────────────────────────────────────────────── */}
      {conexoes.isLoading && <p className="text-body text-text-2">Carregando conexões…</p>}
      {conexoes.data?.connections.length === 0 && (
        <p className="text-body text-text-2">Nenhuma conexão ainda.</p>
      )}

      <ul className="flex flex-col gap-3">
        {conexoes.data?.connections.map((c: MetaConnectionView) => {
          const saude = SAUDE[c.health];
          const precisaReconectar = c.health !== 'ok';
          return (
            <li key={c.id} className="rounded-md border border-border bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-text">{c.metaUserName ?? 'Conta da Meta'}</p>
                <p className={cn('flex items-center gap-1.5 text-small font-medium', TOM_CLASSE[saude.tom])}>
                  {saude.tom === 'ok' ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="size-4" aria-hidden="true" />
                  )}
                  {saude.label}
                </p>
              </div>

              <ul className="mt-3 flex flex-col gap-1.5">
                {c.useCases.map((u) => (
                  <li key={u.id} className="text-small">
                    <span className="text-text">{u.label}</span>
                    {u.missing.length === 0 ? (
                      <span className="text-text-3"> · funcionando</span>
                    ) : (
                      <span className="text-warning"> · falta autorizar: {u.missing.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-small text-text-3">
                {c.assets.pages.length} página(s) · {c.assets.adAccounts.length} conta(s) de anúncio
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {precisaReconectar && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={conectando}
                    // Pede só o que falta. Token expirado ou revogado não tem nada
                    // faltando, e aí o conjunto inteiro dos casos de uso é pedido.
                    onClick={() =>
                      void conectar(
                        c.useCases.map((u) => u.id),
                        [...new Set(c.useCases.flatMap((u) => u.missing))],
                      )
                    }
                  >
                    Reconectar
                  </Button>
                )}
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
                {confirmandoRemocao === c.id ? (
                  <>
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
                    <Button variant="ghost" size="sm" onClick={() => setConfirmandoRemocao(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<Trash2 className="size-3.5" aria-hidden="true" />}
                    onClick={() => setConfirmandoRemocao(c.id)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
