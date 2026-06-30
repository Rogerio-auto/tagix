'use client';

/**
 * Cockpit completo da conversa — painel direito (F30-S03 / LIVECHAT_OPS §3).
 *
 * Regras UX aplicadas:
 *  §2.1 — ação primária = clique no corpo de cada seção.
 *  §2.3 — painel (drawer), não modal full-screen.
 *  §2.5 — sem HelpPanel aqui (está no header do layout pai).
 *  §2.7 — feedback imediato: botões em loading durante mutations.
 *  §2.9 — ação destrutiva (resolver) com confirmação inline (confirmação por
 *          duplo-click — não modal: ação é reversível via "Reabrir").
 *  §2.10 — atalhos de teclado onde aplicável (focus ring visível).
 *  §3 — estados loading/empty/error em todas as seções de dados.
 *
 * DS v2: zero hex hardcoded, só tokens semânticos. Dark + light. Focus ring
 * via `focus-visible:shadow-glow-md`. Verde-neon (`brand`) usado no máximo 1×.
 */

import {
  ArrowRightLeft,
  Bot,
  Info,
  Receipt,
  RefreshCw,
  StickyNote,
  Target,
  User,
  X,
  Zap,
} from 'lucide-react';
import { Button, useToast } from '@hm/ui';
import { can } from '@hm/shared';
import { cn } from '@/shared/lib/cn';
import { Skeleton } from '@/shared/components/feedback';
import { useAuthStore } from '@/shared/stores/auth.store';
import { ContactPanel } from '@/features/contacts/components/ContactPanel';
import { AgendaSection } from '@/features/cockpit-agenda/AgendaSection';
import { DealSection } from './DealSection';
import { ConversionSection } from './ConversionSection';
import { NotesPanel } from './Notes';
import { RoutingMenu } from './RoutingMenu';
import { AgentSelector } from './AgentSelector';
import { ActiveExecutionsSection } from './ActiveExecutionsSection';
import { SnoozeMenu } from './SnoozeMenu';
import { CollapsibleSection } from './CollapsibleSection';
import { useConversationDetail, useChangeStatus, useChangeAiMode } from '../queries';

// ── Helpers de formatação ─────────────────────────────────────────────────────

function statusLabel(status: string): string {
  switch (status) {
    case 'open': return 'Aberta';
    case 'pending': return 'Pendente';
    case 'resolved': return 'Resolvida';
    case 'snoozed': return 'Adiada';
    default: return status;
  }
}

function statusDotClass(status: string): string {
  switch (status) {
    case 'open': return 'bg-success';
    case 'pending': return 'bg-warning';
    case 'resolved': return 'bg-text-low';
    case 'snoozed': return 'bg-text-mid';
    default: return 'bg-text-low';
  }
}

function channelLabel(provider: string | null): string {
  switch (provider) {
    case 'meta_whatsapp': return 'WhatsApp';
    case 'meta_instagram': return 'Instagram';
    case 'waha': return 'WAHA';
    default: return provider ?? 'Canal';
  }
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// ── Sub-componente: seção genérica (colapsável) ───────────────────────────────

/** Deriva uma chave estável de persistência (do collapse) a partir do título. */
function sectionKeyFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Bloco do cockpit. Cada seção é colapsável (header clicável + chevron, estado
 * persistido por seção) — o operador esconde o que não usa e o painel para de
 * virar uma rolagem infinita. Wrapper fino sobre `CollapsibleSection`: os
 * call-sites continuam passando só `title`+`icon` (a chave vem do título).
 */
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <CollapsibleSection title={title} icon={icon} sectionKey={sectionKeyFromTitle(title)}>
      {children}
    </CollapsibleSection>
  );
}

// ── Sub-componente: linha de contexto ─────────────────────────────────────────

function ContextRow({
  label,
  value,
  empty = '—',
}: {
  label: string;
  value: string | null | undefined;
  empty?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 font-body text-xs text-text-low">{label}</span>
      <span className="truncate text-right font-body text-xs font-medium text-text">
        {value ?? empty}
      </span>
    </div>
  );
}

// ── Painel principal ──────────────────────────────────────────────────────────

export function ContactInfoPanel({
  conversationId,
  onClose,
  embedded = false,
}: {
  conversationId: string;
  onClose: () => void;
  /**
   * `true` quando o painel é renderizado dentro de um `Sheet` (mobile): o Sheet
   * já fornece chrome (título, X, scroll, safe-area), então suprimimos o `<aside>`
   * e o cabeçalho próprios — só o conteúdo das seções. Desktop mantém o `<aside>`.
   */
  embedded?: boolean;
}) {
  const auth = useAuthStore((s) => s.auth);
  const { toast } = useToast();

  const { data, isLoading } = useConversationDetail(conversationId);
  const detail = data?.conversation;

  const changeStatus = useChangeStatus();
  const changeAiMode = useChangeAiMode();

  const role = auth?.role ?? null;
  const canResolve = role ? can(role, 'conversation.resolve') : false;
  const canSnooze = role ? can(role, 'conversation.snooze') : false;
  const canAiMode = role ? can(role, 'conversation.ai_mode') : false;
  const canAssignAgent = role ? can(role, 'conversation.assign_agent') : false;
  const canDealEdit = role ? can(role, 'deal.edit') : false;
  const canConvert = role ? can(role, 'deal.convert') : false;

  const status = detail?.status ?? 'open';
  const aiMode = detail?.aiMode ?? 'off';
  const isResolved = status === 'resolved';
  const isAiOn = aiMode === 'on';
  const isAiPaused = aiMode === 'paused';

  function handleStatusChange(nextStatus: 'open' | 'pending' | 'resolved' | 'snoozed'): void {
    if (changeStatus.isPending) return;
    changeStatus.mutate(
      { conversationId, status: nextStatus },
      {
        onSuccess: () =>
          toast({
            title: nextStatus === 'resolved' ? 'Conversa resolvida' :
                   nextStatus === 'open' ? 'Conversa reaberta' :
                   nextStatus === 'pending' ? 'Marcada como pendente' :
                   'Conversa adiada',
            variant: 'success',
          }),
        onError: () => toast({ title: 'Falha ao alterar status', variant: 'error' }),
      },
    );
  }

  function handleToggleAi(): void {
    if (changeAiMode.isPending) return;
    const next = isAiOn ? 'off' : 'on';
    changeAiMode.mutate(
      { conversationId, aiMode: next },
      {
        onSuccess: () =>
          toast({ title: next === 'on' ? 'IA ativada' : 'IA desativada', variant: 'success' }),
        onError: () => toast({ title: 'Falha ao alterar modo IA', variant: 'error' }),
      },
    );
  }

  function handleResumeAi(): void {
    if (changeAiMode.isPending) return;
    changeAiMode.mutate(
      { conversationId, aiMode: 'on' },
      {
        onSuccess: () => toast({ title: 'IA retomada', variant: 'success' }),
        onError: () => toast({ title: 'Falha ao retomar IA', variant: 'error' }),
      },
    );
  }

  const sections = (
    <>
        {/* ── Execuções Ativas (F51): primeiro elemento do cockpit (monitor em ──
            tempo real). A seção se esconde sozinha quando não há flow ativo. ─── */}
        <ActiveExecutionsSection conversationId={conversationId} />

        {/* ── 1. Status operacional ───────────────────────────────────────── */}
        <Section title="Status" icon={Zap}>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* Badge de status atual */}
              <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2">
                <span
                  className={cn('size-2 shrink-0 rounded-full', statusDotClass(status))}
                  aria-hidden
                />
                <span className="font-body text-sm font-medium text-text">
                  {statusLabel(status)}
                </span>
              </div>

              {/* Ações de status */}
              <div className="flex flex-wrap gap-2">
                {canResolve && !isResolved && (
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    loading={changeStatus.isPending}
                    onClick={() => handleStatusChange('resolved')}
                  >
                    Resolver
                  </Button>
                )}
                {canResolve && isResolved && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={changeStatus.isPending}
                    onClick={() => handleStatusChange('open')}
                  >
                    Reabrir
                  </Button>
                )}
                {canResolve && status === 'open' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    loading={changeStatus.isPending}
                    onClick={() => handleStatusChange('pending')}
                  >
                    Pendente
                  </Button>
                )}
                {canSnooze && status === 'open' && (
                  <SnoozeMenu
                    conversationId={conversationId}
                    variant="button"
                    disabled={changeStatus.isPending}
                  />
                )}
              </div>
            </div>
          )}
        </Section>

        {/* ── 1.4 Agenda — próximos compromissos + histórico (F53-S04) ───── */}
        {/* Topo do bloco de contexto comercial: a agenda enquadra Cliente/Card/
            Conversão. Gating (calendar.view/event.edit) e estados vivem dentro da
            própria section; aqui é só o mount. */}
        <AgendaSection
          contactId={detail?.contact?.id ?? null}
          conversationId={conversationId}
        />

        {/* ── 1.5 Cliente — cadastro vivo (F47-S06) ──────────────────────── */}
        {/* Espinha compartilhada com S07 (Card) e S08 (Conversão): mantemos a
            seção Cliente como bloco bem delimitado, sem mexer nas demais. */}
        <Section title="Cliente" icon={User}>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : detail?.contact ? (
            <ContactPanel contactId={detail.contact.id} editable />
          ) : (
            <p className="font-body text-sm text-text-low">
              Esta conversa ainda não tem um contato vinculado.
            </p>
          )}
        </Section>

        {/* ── 1.6 Card/Negócio — deal da pipeline + itens/valor (F47-S07) ── */}
        {/* Ponto de inserção limpo: S08 acrescenta a Conversão logo após esta
            seção, reusando o valor do card. Não mexer nas seções vizinhas. */}
        <Section title="Card / Negócio" icon={Receipt}>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-9 w-1/2" />
            </div>
          ) : (
            <DealSection
              conversationId={conversationId}
              deal={detail?.deal ?? null}
              canEdit={canDealEdit}
            />
          )}
        </Section>

        {/* ── 1.7 Conversão — marcar conversão herdando o valor do card (F47-S08) ── */}
        {/* Reusa o MarkConversionModal; o valor do card vem pré-preenchido. Gate
            `deal.convert` (READONLY não vê). Precisa de contato vinculado. */}
        {canConvert && (
          <Section title="Conversão" icon={Target}>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-9 w-1/2" />
              </div>
            ) : detail?.contact ? (
              <ConversionSection
                contactId={detail.contact.id}
                conversationId={conversationId}
                dealId={detail.deal?.id ?? null}
                valueCents={detail.deal?.valueCents ?? null}
              />
            ) : (
              <p className="font-body text-sm text-text-low">
                Vincule um contato a esta conversa para registrar a conversão.
              </p>
            )}
          </Section>
        )}

        {/* ── 2. IA — toggle + estado de handoff ─────────────────────────── */}
        <Section title="Agente IA" icon={Bot}>
          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              {/* Agente atual + troca manual (F34-S04). Quem pode atribuir vê o
                  seletor; os demais veem o agente atual em read-only. */}
              {canAssignAgent ? (
                <AgentSelector conversationId={conversationId} canAssign={canAssignAgent} />
              ) : detail?.agentName ? (
                <div className="flex flex-col gap-1">
                  <span className="font-body text-xs text-text-low">Agente responsável</span>
                  <div className="flex items-center gap-2 rounded-md border border-border-2 bg-surface-2 px-3 py-2">
                    <Bot className="size-4 shrink-0 text-text-low" aria-hidden />
                    <span className="truncate font-body text-sm font-medium text-text">
                      {detail.agentName}
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Indicador de handoff — destaque quando pausada (atendente assumiu) */}
              {isAiPaused && (
                <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
                  <Bot className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-body text-xs font-semibold text-warning">
                      IA pausada — atendente assumiu
                    </p>
                    {detail?.aiPausedAt && (
                      <p className="font-body text-xs text-text-low">
                        Pausada em{' '}
                        {timeFmt.format(new Date(detail.aiPausedAt))}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Controles de IA */}
              {canAiMode ? (
                <div className="flex items-center gap-2">
                  {/* Toggle on/off (quando não pausada) */}
                  {!isAiPaused && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isAiOn}
                      onClick={handleToggleAi}
                      disabled={changeAiMode.isPending}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                        'outline-none transition-colors focus-visible:shadow-glow-md',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        isAiOn ? 'bg-brand' : 'bg-surface-3',
                      )}
                    >
                      <span
                        className={cn(
                          'pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm',
                          'transition-transform motion-safe:transition-transform',
                          isAiOn ? 'translate-x-5' : 'translate-x-0',
                        )}
                      />
                      <span className="sr-only">{isAiOn ? 'Desativar IA' : 'Ativar IA'}</span>
                    </button>
                  )}

                  <span className="font-body text-sm text-text">
                    {isAiPaused
                      ? 'IA pausada'
                      : isAiOn
                      ? 'IA ativa'
                      : 'IA desativada'}
                  </span>

                  {/* Botão Retomar — só quando pausada */}
                  {isAiPaused && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={changeAiMode.isPending}
                      leftIcon={<RefreshCw className="size-3.5" aria-hidden />}
                      onClick={handleResumeAi}
                    >
                      Retomar
                    </Button>
                  )}
                </div>
              ) : (
                <p className="font-body text-xs text-text-low">
                  Sem permissão para alterar o modo da IA.
                </p>
              )}
            </div>
          )}
        </Section>

        {/* ── 3. Roteamento (Atribuição / Transferência) ─────────────────── */}
        <CollapsibleSection title="Roteamento" icon={ArrowRightLeft} sectionKey="roteamento">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <RoutingMenu
              conversationId={conversationId}
              assignedTo={detail?.assignedTo ?? null}
              departmentId={detail?.departmentId ?? null}
              hideHeader
            />
          )}
        </CollapsibleSection>

        {/* ── 4. Contexto (canal / dept / atendente / estágio) ───────────── */}
        <Section title="Contexto" icon={Info}>
          {isLoading ? (
            <div className="space-y-1.5">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Responsável + Departamento vivem na seção Roteamento (sem duplicar). */}
              <ContextRow
                label="Canal"
                value={channelLabel(detail?.channelProvider ?? null)}
              />
              <ContextRow
                label="Estágio"
                value={detail?.stageName}
              />
              <ContextRow
                label="Criada em"
                value={
                  detail?.createdAt
                    ? timeFmt.format(new Date(detail.createdAt))
                    : null
                }
              />
            </div>
          )}
        </Section>

        {/* ── 5. Notas internas + @menções (F1-S22) ──────────────────────── */}
        <CollapsibleSection title="Notas internas" icon={StickyNote} sectionKey="notas">
          <NotesPanel conversationId={conversationId} hideHeader />
        </CollapsibleSection>
    </>
  );

  // Mobile: o cockpit é renderizado dentro de um `Sheet` (chrome + scroll +
  // safe-area vêm do Sheet, que já padda `px-5 pb-5`). Aqui devolvemos as seções
  // como pilha de cards com respiro vertical.
  if (embedded) {
    return <div className="flex flex-col gap-2.5 pt-4">{sections}</div>;
  }

  // Desktop: terceira coluna fixa com cabeçalho e trilha de cards com scroll.
  // Animação de entrada discreta (slide+fade) ao abrir — motion-safe.
  return (
    <aside
      aria-label="Cockpit da conversa"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface motion-safe:animate-[hm-cockpit-in_280ms_cubic-bezier(0.22,1,0.36,1)]"
    >
      {/* Cabeçalho do painel */}
      <div className="flex h-14 items-center justify-between border-b border-border-2 px-4">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-text-low" aria-hidden />
          <span className="font-head text-sm font-semibold text-text">Cockpit</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar painel"
          className="rounded-sm p-1.5 text-text-low outline-none hover:text-text focus-visible:shadow-glow-md"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Trilha recuada (bg-surface-inset) — os cards "flutuam" acima dela,
          criando profundidade de dashboard. */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-surface-inset p-3">
        {sections}
      </div>
    </aside>
  );
}
