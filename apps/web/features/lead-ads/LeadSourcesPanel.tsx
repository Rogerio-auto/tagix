'use client';

/**
 * Leads dos anúncios (F69-S03; DS 3.0 na F72-S07).
 *
 * Responde, nesta ordem: **de quais páginas os leads entram**, **os últimos leads
 * chegaram?** e **algum travou, e por quê?**. Lead com falha mostra o motivo em
 * linguagem de dono — é a garantia de que lead pago não some em silêncio.
 *
 * UX: §2.6 vazio com o próximo passo; §2.7 cada botão com loading; §2.9 parar de receber
 * pede confirmação em linha (é reversível, então a confirmação é leve); §2.11 erro em 3
 * partes. Só leitura: receber/parar/tentar de novo ficam `aria-disabled` com a explicação.
 */

import type * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Megaphone } from 'lucide-react';
import { Button, ErrorState, StatusPill, useToast } from '@hm/ui';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { Skeleton } from '@/shared/components/feedback';
import { ApiError } from '@/shared/lib/api-client';
import { formatDateTime, formatNumber } from '@/shared/lib/locale';
import {
  useLeadSources,
  useRetrySubscribeLeadPage,
  useStopLeadPage,
  useSubscribeLeadPage,
} from './queries';
import type { RecentLeadView } from './types';

function mensagemDe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Tente de novo.';
}

const eyebrow = 'font-mono text-xs font-medium uppercase tracking-widest text-text-low';

function EstadoLead({ lead }: { lead: RecentLeadView }): React.JSX.Element {
  if (lead.status === 'processed') {
    return (
      <StatusPill tone="success" size="sm">
        Entrou
      </StatusPill>
    );
  }
  if (lead.status === 'failed') {
    return (
      <StatusPill tone="danger" size="sm">
        Travou
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="info" size="sm" live>
      Chegando
    </StatusPill>
  );
}

export function LeadSourcesPanel(): React.JSX.Element {
  const { toast } = useToast();
  const dados = useLeadSources();
  const assinar = useSubscribeLeadPage();
  const assinarDeNovo = useRetrySubscribeLeadPage();
  const parar = useStopLeadPage();
  const [confirmandoParada, setConfirmandoParada] = useState<string | null>(null);

  const ativas = dados.data?.sources.filter((s) => s.status === 'active') ?? [];
  const disponiveis = dados.data?.available ?? [];
  const recentes = dados.data?.recent ?? [];
  const nomeDaPagina = new Map(dados.data?.sources.map((s) => [s.pageId, s.pageName]) ?? []);
  const travados = recentes.filter((r) => r.status === 'failed').length;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="leads-anuncios">
      <header className="flex flex-col gap-1.5">
        <h2 id="leads-anuncios" className="flex items-center gap-2.5 font-head text-h4 text-text">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-sm border border-border bg-surface-2 text-text-mid"
          >
            <Megaphone className="size-4" />
          </span>
          Leads dos anúncios
        </h2>
        <p className="max-w-2xl font-body text-body text-text-mid">
          Quem preenche o formulário do anúncio entra na inbox em segundos, vira card no funil e você
          é avisado no celular.
        </p>
      </header>

      {dados.isLoading && (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy aria-label="Carregando leads">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      )}
      {dados.isError && (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState
            title="Não foi possível carregar os leads"
            reason={mensagemDe(dados.error)}
            whatToDo="Tente de novo em instantes."
            action={
              <Button variant="secondary" size="sm" onClick={() => void dados.refetch()}>
                Tentar de novo
              </Button>
            }
          />
        </div>
      )}

      {dados.data !== undefined && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col rounded-lg border border-border bg-surface p-5">
            <h3 className={eyebrow}>Páginas recebendo</h3>
            {ativas.length === 0 ? (
              <p className="mt-3 font-body text-sm text-text-mid">
                Nenhuma página ainda. Escolha abaixo de qual página os leads devem entrar.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {ativas.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* `items-start`: o selo fica no tamanho do texto, não esticado na coluna. */}
                      <div className="flex min-w-0 flex-col items-start gap-1.5">
                        <p className="max-w-full truncate font-body text-sm font-bold text-text">
                          {s.pageName ?? `Página ${s.pageId}`}
                        </p>
                        {s.delivery === 'webhook' ? (
                          <StatusPill tone="success" size="sm" live>
                            Recebendo em segundos
                          </StatusPill>
                        ) : (
                          <StatusPill tone="warning" size="sm">
                            Conferindo a cada 15 minutos
                          </StatusPill>
                        )}
                        <p className="font-body text-xs text-text-low">
                          Conferida pela última vez:{' '}
                          <span className="font-mono tabular-nums">{formatDateTime(s.lastReconciledAt)}</span>
                        </p>
                      </div>
                      {confirmandoParada === s.id ? (
                        <div className="flex items-center gap-1.5">
                          <ReadOnlyGuard>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={parar.isPending && parar.variables === s.id}
                              onClick={() =>
                                parar.mutate(s.id, {
                                  onSettled: () => setConfirmandoParada(null),
                                  onError: (err) =>
                                    toast({
                                      variant: 'error',
                                      title: 'Não foi possível parar',
                                      description: mensagemDe(err),
                                    }),
                                })
                              }
                            >
                              Confirmar
                            </Button>
                          </ReadOnlyGuard>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmandoParada(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <ReadOnlyGuard>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmandoParada(s.id)}>
                            Parar de receber
                          </Button>
                        </ReadOnlyGuard>
                      )}
                    </div>
                    {s.delivery === 'reconciliation' && (
                      <div className="rounded-md border border-warn/25 bg-warn/10 p-3">
                        <p className="font-body text-sm text-text-mid">
                          {s.subscribeError ?? 'A Meta ainda não liberou a entrega em segundos para esta página.'}
                        </p>
                        <ReadOnlyGuard align="start" className="mt-2.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={assinarDeNovo.isPending && assinarDeNovo.variables === s.id}
                            onClick={() =>
                              assinarDeNovo.mutate(s.id, {
                                onSuccess: () =>
                                  toast({ variant: 'success', title: 'Página passou a receber em segundos' }),
                                onError: (err) =>
                                  toast({ variant: 'error', title: 'Ainda não foi', description: mensagemDe(err) }),
                              })
                            }
                          >
                            Tentar receber em segundos
                          </Button>
                        </ReadOnlyGuard>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {disponiveis.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <h3 className={eyebrow}>Adicionar página</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {disponiveis.map((p) => (
                    <li
                      key={`${p.connectionId}:${p.pageId}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <p className="min-w-0 truncate font-body text-sm text-text">
                        {p.pageName ?? `Página ${p.pageId}`}
                      </p>
                      <ReadOnlyGuard>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={assinar.isPending && assinar.variables?.pageId === p.pageId}
                          onClick={() =>
                            assinar.mutate(
                              { connectionId: p.connectionId, pageId: p.pageId },
                              {
                                onSuccess: () => toast({ variant: 'success', title: 'Página conectada aos leads' }),
                                onError: (err) =>
                                  toast({
                                    variant: 'error',
                                    title: 'Não foi possível conectar',
                                    description: mensagemDe(err),
                                  }),
                              },
                            )
                          }
                        >
                          Receber leads
                        </Button>
                      </ReadOnlyGuard>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {ativas.length === 0 && disponiveis.length === 0 && (
              <p className="mt-3 font-body text-sm text-text-low">
                Conecte a Meta acima marcando “Leads dos anúncios” para escolher as páginas.
              </p>
            )}
          </div>

          <div className="flex flex-col rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={eyebrow}>Últimos leads</h3>
              {travados > 0 && (
                <StatusPill tone="danger" size="sm">
                  <span className="font-mono tabular-nums">{formatNumber(travados)}</span>
                  {travados === 1 ? 'travado' : 'travados'}
                </StatusPill>
              )}
            </div>
            {recentes.length === 0 ? (
              <p className="mt-3 font-body text-sm text-text-mid">Os leads aparecem aqui assim que chegarem.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {recentes.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 font-body text-sm text-text">
                        {nomeDaPagina.get(r.pageId) ?? `Página ${r.pageId}`}
                        <span className="font-mono text-xs tabular-nums text-text-low">
                          {' · '}
                          {formatDateTime(r.createdAt)}
                        </span>
                      </p>
                      <EstadoLead lead={r} />
                    </div>
                    {r.status === 'failed' && r.error !== null && (
                      <p className="font-body text-sm text-text-mid">{r.error}</p>
                    )}
                    {r.conversationId !== null && (
                      <Link
                        href={`/conversations/${r.conversationId}`}
                        className="inline-flex w-fit items-center gap-1 rounded-xs font-body text-sm font-bold text-brand-text underline-offset-4 outline-none hover:underline focus-visible:focus-ring"
                      >
                        Abrir conversa
                        <ArrowUpRight className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
