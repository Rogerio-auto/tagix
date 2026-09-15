'use client';

/**
 * Leads dos anúncios (F69-S03).
 *
 * Responde, nesta ordem: **de quais páginas os leads entram**, **os últimos leads
 * chegaram?** e **algum travou, e por quê?**. Lead com falha mostra o motivo em
 * linguagem de dono — é a garantia de que lead pago não some em silêncio.
 */

import type * as React from 'react';
import Link from 'next/link';
import { CircleAlert, CircleCheck, Clock, Megaphone } from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { ApiError } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/cn';
import { useLeadSources, useStopLeadPage, useSubscribeLeadPage } from './queries';
import type { RecentLeadView } from './types';

function mensagemDe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Tente de novo.';
}

const horario = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

function quando(iso: string | null): string {
  if (iso === null) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : horario.format(d);
}

function EstadoLead({ lead }: { lead: RecentLeadView }): React.JSX.Element {
  if (lead.status === 'processed') {
    return (
      <span className="flex items-center gap-1.5 text-small text-brand">
        <CircleCheck className="size-4" aria-hidden="true" /> Entrou
      </span>
    );
  }
  if (lead.status === 'failed') {
    return (
      <span className="flex items-center gap-1.5 text-small text-danger">
        <CircleAlert className="size-4" aria-hidden="true" /> Travou
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-small text-text-2">
      <Clock className="size-4" aria-hidden="true" /> Chegando
    </span>
  );
}

export function LeadSourcesPanel(): React.JSX.Element {
  const { toast } = useToast();
  const dados = useLeadSources();
  const assinar = useSubscribeLeadPage();
  const parar = useStopLeadPage();

  const ativas = dados.data?.sources.filter((s) => s.status === 'active') ?? [];
  const disponiveis = dados.data?.available ?? [];
  const recentes = dados.data?.recent ?? [];
  const nomeDaPagina = new Map(dados.data?.sources.map((s) => [s.pageId, s.pageName]) ?? []);
  const travados = recentes.filter((r) => r.status === 'failed').length;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="leads-anuncios">
      <header>
        <h2 id="leads-anuncios" className="flex items-center gap-2 font-head text-h3 text-text">
          <Megaphone className="size-5 text-text-2" aria-hidden="true" />
          Leads dos anúncios
        </h2>
        <p className="mt-1 text-body text-text-2">
          Quem preenche o formulário do anúncio entra na inbox em segundos, vira card no funil e você é avisado no celular.
        </p>
      </header>

      {dados.isLoading && <p className="text-body text-text-2">Carregando…</p>}
      {dados.isError && (
        <p className="text-body text-danger">Não foi possível carregar os leads. {mensagemDe(dados.error)}</p>
      )}

      {dados.data !== undefined && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-border bg-surface p-5">
            <h3 className="font-semibold text-text">Páginas recebendo</h3>
            {ativas.length === 0 ? (
              <p className="mt-2 text-small text-text-2">
                Nenhuma página ainda. Escolha abaixo de qual página os leads devem entrar.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {ativas.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-body text-text">{s.pageName ?? `Página ${s.pageId}`}</p>
                      <p className="text-small text-text-3">Conferida pela última vez: {quando(s.lastReconciledAt)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={parar.isPending && parar.variables === s.id}
                      onClick={() =>
                        parar.mutate(s.id, {
                          onError: (err) =>
                            toast({ variant: 'error', title: 'Não foi possível parar', description: mensagemDe(err) }),
                        })
                      }
                    >
                      Parar de receber
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {disponiveis.length > 0 && (
              <>
                <h3 className="mt-5 font-semibold text-text">Adicionar página</h3>
                <ul className="mt-3 flex flex-col gap-2">
                  {disponiveis.map((p) => (
                    <li key={`${p.connectionId}:${p.pageId}`} className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-body text-text">{p.pageName ?? `Página ${p.pageId}`}</p>
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
                                toast({ variant: 'error', title: 'Não foi possível conectar', description: mensagemDe(err) }),
                            },
                          )
                        }
                      >
                        Receber leads
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {ativas.length === 0 && disponiveis.length === 0 && (
              <p className="mt-3 text-small text-text-2">
                Conecte a Meta acima marcando “Leads dos anúncios” para escolher as páginas.
              </p>
            )}
          </div>

          <div className="rounded-md border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-text">Últimos leads</h3>
              {travados > 0 && (
                <p className="text-small font-medium text-danger">
                  {travados} {travados === 1 ? 'travado' : 'travados'}
                </p>
              )}
            </div>
            {recentes.length === 0 ? (
              <p className="mt-2 text-small text-text-2">Os leads aparecem aqui assim que chegarem.</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border">
                {recentes.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-small text-text">
                        {nomeDaPagina.get(r.pageId) ?? `Página ${r.pageId}`}
                        <span className="text-text-3"> · {quando(r.createdAt)}</span>
                      </p>
                      <EstadoLead lead={r} />
                    </div>
                    {r.status === 'failed' && r.error !== null && (
                      <p className="text-small text-text-2">{r.error}</p>
                    )}
                    {r.conversationId !== null && (
                      <Link
                        href={`/conversations/${r.conversationId}`}
                        className={cn('text-small text-brand underline-offset-2 hover:underline')}
                      >
                        Abrir conversa
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
