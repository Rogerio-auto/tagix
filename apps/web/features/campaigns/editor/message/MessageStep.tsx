'use client';

/**
 * Etapa **Mensagem** do criador de campanha (F58-S09).
 *
 * Substitui o campo de texto onde se digitava o nome técnico do modelo. Agora:
 *
 * 1. **Escolher** — catálogo de modelos aprovados do número, em Drawer, com
 *    busca pelo que a mensagem diz, categoria e idioma.
 * 2. **Ver** — prévia de celular com cabeçalho, mídia, texto, rodapé e botões,
 *    já com os valores de um contato de exemplo.
 * 3. **Preencher** — cada espaço `{{n}}` vira "o que vai aqui?", com texto
 *    reserva obrigatório para dado de contato.
 * 4. **Testar** — manda para o próprio celular pelo pipeline real.
 *
 * Em sequência, as mensagens se adicionam, reordenam (botões ou Alt+↑/↓) e a
 * espera entre elas é uma frase: "2 dias depois da mensagem anterior".
 *
 * A etapa não fala com `PUT /steps`: publica `onReadinessChange` com o payload
 * pronto e o orquestrador (F58-S13) decide quando salvar.
 *
 * UX_PRINCIPLES aplicados: §2.1 (clicar no corpo do cartão foca a mensagem e a
 * prévia), §2.3 (catálogo em Drawer, não modal), §2.5 (HelpPanel `?`), §2.6
 * (vazio do catálogo leva à central de modelos), §2.7 (skeleton, botões com
 * loading), §2.9 (remover mensagem montada pede confirmação no próprio botão),
 * §2.10 (Alt+↑/↓ reordena, `/` busca no catálogo, setas na lista), §2.11 (erro
 * em três partes com nova tentativa), §3.6 (skeleton no lugar do conteúdo).
 */
import type * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@hm/ui';
import { HelpPanel } from '@/shared/components/help';
import { Skeleton } from '@/shared/components/feedback';
import { cn } from '@/shared/lib/cn';
import { categoryLabel, languageLabel } from '@/features/channels/message-templates/format';
import {
  MAX_SEQUENCE_MESSAGES,
  UNIT_SECONDS,
  addMessage,
  attachResolvedTemplates,
  bindingsForRequest,
  delayToSeconds,
  describeDelay,
  friendlyTemplateName,
  messagesForMode,
  moveMessage,
  parseTemplate,
  patchMessage,
  removeMessage,
  resolveTemplate,
  selectTemplate,
  toStepsPayload,
  unitWord,
  updateBinding,
  validateMessages,
  variableSlots,
  type CampaignMode,
  type ContactSample,
  type DelayUnit,
  type MessageDraft,
  type MessageIssue,
  type MessageStepValue,
  type SlotKey,
  type StepPayload,
  type TemplateOption,
} from './model';
import { MessageHelp } from './MessageHelp';
import { PhonePreview } from './PhonePreview';
import { TemplatePicker } from './TemplatePicker';
import { TemplateUnavailable } from './TemplateUnavailable';
import { TestSendPanel } from './TestSendPanel';
import { useApprovedTemplates, useSendTest, type BuilderChannel } from './queries';
import { VariableMapper } from './VariableMapper';

export interface MessageStepReadiness {
  /** `true` só com catálogo carregado, modelos aprovados e campos completos. */
  readonly canAdvance: boolean;
  readonly issues: readonly MessageIssue[];
  /** Corpo do `PUT /api/campaigns/:id/steps` — `null` enquanto houver pendência. */
  readonly payload: readonly StepPayload[] | null;
}

export interface MessageStepProps {
  readonly value: MessageStepValue;
  readonly onChange: (next: MessageStepValue) => void;
  readonly mode: CampaignMode;
  readonly channelId: string;
  /** Rascunho já salvo. Sem ele o teste fica bloqueado (a API precisa da campanha). */
  readonly campaignId: string | null;
  /** Nome que aparece no topo da prévia. Padrão: o nome do canal. */
  readonly senderName?: string;
  /** Contato real para o exemplo da prévia (ex.: primeiro do público). */
  readonly sampleContact?: ContactSample | null;
  readonly customFieldKeys?: readonly string[];
  readonly defaultTestPhone?: string;
  readonly readOnly?: boolean;
  /** Mostra todos os erros (o orquestrador liga depois de tentar avançar). */
  readonly showAllErrors?: boolean;
  readonly onReadinessChange?: (readiness: MessageStepReadiness) => void;
}

const UNITS: readonly DelayUnit[] = ['minutes', 'hours', 'days'];

/* ── Espera entre mensagens ──────────────────────────────────────────────── */

function DelayControl({
  draft,
  disabled,
  error,
  onChange,
}: {
  draft: MessageDraft;
  disabled: boolean;
  error: string | undefined;
  onChange: (next: MessageDraft['delay']) => void;
}): React.JSX.Element {
  const amount = Math.round(draft.delay.amount);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-text-mid">
        <span>Enviar</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.floor((90 * UNIT_SECONDS.days) / UNIT_SECONDS[draft.delay.unit])}
          value={Number.isFinite(amount) && amount > 0 ? String(amount) : ''}
          disabled={disabled}
          aria-label="Quanto esperar"
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange({ ...draft.delay, amount: Number(e.target.value) })}
          className={cn(
            'h-9 w-16 rounded-sm border bg-surface-inset px-2 text-center text-sm text-text outline-none',
            'focus:border-brand focus:shadow-glow-sm disabled:opacity-40',
            error ? 'border-danger' : 'border-border hover:border-border-2',
          )}
        />
        <select
          value={draft.delay.unit}
          disabled={disabled}
          aria-label="Unidade da espera"
          onChange={(e) => onChange({ ...draft.delay, unit: e.target.value as DelayUnit })}
          className="h-9 rounded-sm border border-border bg-surface-inset px-2 text-sm text-text outline-none hover:border-border-2 focus-visible:shadow-glow-md disabled:opacity-40"
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unitWord(unit, amount)}
            </option>
          ))}
        </select>
        <span>depois da mensagem anterior</span>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ── Remover com confirmação proporcional (§2.9) ─────────────────────────── */

function RemoveButton({
  needsConfirm,
  onRemove,
  label,
}: {
  needsConfirm: boolean;
  onRemove: () => void;
  label: string;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 4_000);
    return () => window.clearTimeout(id);
  }, [armed]);

  if (armed) {
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={onRemove}
        onBlur={() => setArmed(false)}
        autoFocus
      >
        Confirmar remoção
      </Button>
    );
  }
  return (
    <IconButton
      size="sm"
      variant="danger"
      aria-label={label}
      icon={<Trash2 aria-hidden />}
      onClick={() => (needsConfirm ? setArmed(true) : onRemove())}
    />
  );
}

/* ── Cartão de uma mensagem ──────────────────────────────────────────────── */

interface CardProps {
  readonly draft: MessageDraft;
  readonly position: number;
  readonly total: number;
  readonly mode: CampaignMode;
  readonly template: TemplateOption | null;
  readonly catalogReady: boolean;
  readonly channel: BuilderChannel | null;
  readonly channelId: string;
  readonly campaignId: string | null;
  readonly contact: ContactSample | null;
  readonly customFieldKeys: readonly string[];
  readonly defaultTestPhone: string | undefined;
  readonly issues: readonly MessageIssue[];
  readonly showAllErrors: boolean;
  readonly readOnly: boolean;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onPick: () => void;
  readonly onPatch: (patch: (draft: MessageDraft) => MessageDraft) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
}

function MessageCard({
  draft,
  position,
  total,
  mode,
  template,
  catalogReady,
  channel,
  channelId,
  campaignId,
  contact,
  customFieldKeys,
  defaultTestPhone,
  issues,
  showAllErrors,
  readOnly,
  active,
  onActivate,
  onPick,
  onPatch,
  onMove,
  onRemove,
}: CardProps): React.JSX.Element {
  const [touched, setTouched] = useState<ReadonlySet<SlotKey>>(new Set());
  const sendTest = useSendTest(campaignId, channelId);

  const parsed = template ? parseTemplate(template.components) : null;
  const slots = parsed ? variableSlots(parsed) : [];
  const hasTemplate = draft.templateId !== null || draft.templateName.length > 0;
  const unavailable = hasTemplate && catalogReady && template === null;
  const checking = hasTemplate && !catalogReady && template === null;
  const sequence = mode === 'sequence';
  // Feedback imediato: a espera é um campo só, o erro aparece enquanto digita.
  const delayError = issues.find((i) => i.code === 'delay_invalid')?.text;

  const slotIssues = issues.filter((i) => i.slot !== undefined);
  const hasButtonVariable = slots.some((s) => s.component === 'button');

  const blockedReason = readOnly
    ? 'A campanha está em leitura.'
    : campaignId === null
      ? 'Salve o rascunho da campanha para liberar o teste.'
      : channel !== null && !channel.capabilities.testSend
        ? 'Este canal não aceita envio de teste.'
        : template === null
          ? 'Escolha um modelo aprovado para testar.'
          : slotIssues.length > 0
            ? 'Preencha os campos acima para testar.'
            : hasButtonVariable
              ? 'O teste ainda não cobre botão com link variável. Confira este modelo direto no WhatsApp por enquanto.'
              : null;

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (!sequence || readOnly || !event.altKey) return;
    if (event.key === 'ArrowUp' && position > 0) {
      event.preventDefault();
      onMove(-1);
    } else if (event.key === 'ArrowDown' && position < total - 1) {
      event.preventDefault();
      onMove(1);
    }
  }

  return (
    <article
      aria-label={sequence ? `Mensagem ${position + 1} de ${total}` : 'Mensagem'}
      data-active={active ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onFocusCapture={onActivate}
      onClick={onActivate}
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-surface p-4 transition-colors duration-150 motion-reduce:transition-none',
        active && sequence ? 'border-border-2 shadow-elev-1' : 'border-border',
      )}
    >
      {sequence ? (
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-head text-sm font-semibold text-text">Mensagem {position + 1}</h3>
            <p className="text-xs text-text-low">
              {position === 0
                ? 'Sai quando a campanha começar'
                : delayToSeconds(draft.delay) > 0
                  ? describeDelay(draft.delay)
                  : 'Defina a espera'}
            </p>
          </div>
          {!readOnly ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                size="sm"
                aria-label={`Subir mensagem ${position + 1} (Alt+↑)`}
                icon={<ArrowUp aria-hidden />}
                disabled={position === 0}
                onClick={() => onMove(-1)}
              />
              <IconButton
                size="sm"
                aria-label={`Descer mensagem ${position + 1} (Alt+↓)`}
                icon={<ArrowDown aria-hidden />}
                disabled={position === total - 1}
                onClick={() => onMove(1)}
              />
              {total > 1 ? (
                <RemoveButton
                  label={`Remover mensagem ${position + 1}`}
                  needsConfirm={hasTemplate}
                  onRemove={onRemove}
                />
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      {sequence && position > 0 ? (
        <DelayControl
          draft={draft}
          disabled={readOnly}
          error={delayError}
          onChange={(delay) => onPatch((d) => ({ ...d, delay }))}
        />
      ) : null}

      {/* Modelo escolhido */}
      {!hasTemplate ? (
        <button
          type="button"
          disabled={readOnly}
          onClick={onPick}
          className={cn(
            'flex flex-col items-center gap-1 rounded-md border border-dashed px-4 py-6 text-center outline-none transition-colors duration-150',
            'hover:border-border-2 hover:bg-surface-2 focus-visible:shadow-glow-md motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50',
            showAllErrors && issues.some((i) => i.code === 'template_missing')
              ? 'border-danger'
              : 'border-border',
          )}
        >
          <span className="text-sm font-medium text-text">Escolher modelo aprovado</span>
          <span className="text-xs text-text-low">Veja o texto de cada um antes de decidir.</span>
        </button>
      ) : checking ? (
        <div
          aria-busy
          aria-label="Conferindo o modelo"
          className="flex flex-col gap-2 rounded-md border border-border p-3"
        >
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ) : unavailable ? (
        <TemplateUnavailable
          channelId={channelId}
          templateName={draft.templateName}
          languageCode={draft.languageCode}
          onChooseAnother={onPick}
          disabled={readOnly}
        />
      ) : template ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-text">
              {friendlyTemplateName(template.name)}
            </p>
            <p className="text-xs text-text-low">
              {categoryLabel(template.category)} · {languageLabel(template.language)}
            </p>
          </div>
          {!readOnly ? (
            <Button variant="ghost" size="sm" onClick={onPick}>
              Trocar modelo
            </Button>
          ) : null}
        </div>
      ) : null}

      {template && parsed ? (
        <section className="flex flex-col gap-2" aria-label="Campos da mensagem">
          <h4 className="text-xs font-medium uppercase tracking-wide text-text-low">
            O que vai em cada campo
          </h4>
          <VariableMapper
            slots={slots}
            bindings={draft.bindings}
            contact={contact}
            customFieldKeys={customFieldKeys}
            issues={slotIssues}
            showAllErrors={showAllErrors}
            touched={touched}
            onTouch={(key) =>
              setTouched((current) => (current.has(key) ? current : new Set(current).add(key)))
            }
            onChange={(key, source) => onPatch((d) => updateBinding(d, key, source))}
            disabled={readOnly}
          />
        </section>
      ) : null}

      {template ? (
        <TestSendPanel
          templateId={template.id}
          bindings={bindingsForRequest(draft, template)}
          blockedReason={blockedReason}
          {...(defaultTestPhone ? { defaultPhone: defaultTestPhone } : {})}
          pending={sendTest.isPending}
          onSend={(input) => sendTest.mutateAsync(input)}
        />
      ) : null}
    </article>
  );
}

/* ── Etapa ───────────────────────────────────────────────────────────────── */

export function MessageStep({
  value,
  onChange,
  mode,
  channelId,
  campaignId,
  senderName,
  sampleContact = null,
  customFieldKeys = [],
  defaultTestPhone,
  readOnly = false,
  showAllErrors = false,
  onReadinessChange,
}: MessageStepProps): React.JSX.Element {
  const catalog = useApprovedTemplates(channelId);
  const approved = useMemo(() => catalog.data?.templates ?? [], [catalog.data]);
  const catalogReady = catalog.isSuccess;
  const channel = catalog.data?.channel ?? null;

  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Rascunho do servidor chega só com nome + idioma: amarra ao catálogo.
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!catalogReady) return;
    const next = attachResolvedTemplates(valueRef.current, approved);
    if (next !== valueRef.current) onChange(next);
  }, [catalogReady, approved, onChange]);

  const messages = messagesForMode(value, mode);
  const issues = useMemo(
    () => validateMessages(value, { mode, approved, catalogReady }),
    [value, mode, approved, catalogReady],
  );

  const canAdvance = catalogReady && issues.length === 0 && !readOnly;
  const payloadKey = canAdvance ? JSON.stringify(toStepsPayload(value, mode, approved)) : null;
  const issuesKey = JSON.stringify(issues.map((i) => [i.code, i.messageKey, i.slot]));

  // Publica só quando muda de fato — o orquestrador não pode entrar em laço.
  const publishRef = useRef(onReadinessChange);
  publishRef.current = onReadinessChange;
  useEffect(() => {
    publishRef.current?.({
      canAdvance: payloadKey !== null,
      issues,
      payload: payloadKey === null ? null : (JSON.parse(payloadKey) as StepPayload[]),
    });
    // `issues` entra pela chave estável `issuesKey` (a lista é recriada a cada render).
  }, [payloadKey, issuesKey]);

  const active = messages.find((m) => m.key === activeKey) ?? messages[0] ?? null;
  const activeTemplate = active ? resolveTemplate(active, approved) : null;
  const pickingDraft = messages.find((m) => m.key === pickerFor) ?? null;
  const sender = senderName ?? channel?.displayHandle ?? channel?.name ?? 'Sua empresa';

  function patch(key: string, fn: (draft: MessageDraft) => MessageDraft): void {
    onChange(patchMessage(value, key, fn));
  }

  const globalIssue = issues.find((i) => i.messageKey === null);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-head text-base font-semibold text-text">
            {mode === 'sequence' ? 'Monte as mensagens da sequência' : 'Escolha a mensagem'}
          </h2>
          <p className="text-sm text-text-mid">
            No WhatsApp oficial, campanhas saem com modelos aprovados pela Meta. Você vê exatamente
            o que chega antes de continuar.
          </p>
        </div>
        <HelpPanel title="Como funciona a mensagem">
          <MessageHelp />
        </HelpPanel>
      </header>

      {catalog.isError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-danger/30 bg-danger-bg px-4 py-3"
        >
          <p className="text-sm font-medium text-text">
            Não conseguimos carregar os modelos aprovados
          </p>
          <p className="text-xs text-text-mid">{catalog.error.message}</p>
          <p className="text-xs text-text-low">
            Sem a lista, não dá para conferir se o modelo pode ser usado. Tente de novo.
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              loading={catalog.isFetching}
              onClick={() => void catalog.refetch()}
            >
              Tentar de novo
            </Button>
          </div>
        </div>
      ) : channel !== null && !channel.eligible ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warn/30 bg-warn-bg px-4 py-3"
        >
          <p className="text-sm font-medium text-text">Este canal não envia campanhas agora</p>
          <p className="text-xs text-text-mid">{channel.ineligibleMessage}</p>
          <Link
            href="/settings/channels"
            className="w-fit rounded-xs text-xs font-medium text-text underline-offset-4 outline-none hover:underline focus-visible:shadow-glow-md"
          >
            Resolver nas configurações de canais
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          {messages.map((draft, position) => (
            <MessageCard
              key={draft.key}
              draft={draft}
              position={position}
              total={messages.length}
              mode={mode}
              template={resolveTemplate(draft, approved)}
              catalogReady={catalogReady}
              channel={channel}
              channelId={channelId}
              campaignId={campaignId}
              contact={sampleContact}
              customFieldKeys={customFieldKeys}
              defaultTestPhone={defaultTestPhone}
              issues={issues.filter((i) => i.messageKey === draft.key)}
              showAllErrors={showAllErrors}
              readOnly={readOnly}
              active={active?.key === draft.key}
              onActivate={() => setActiveKey(draft.key)}
              onPick={() => setPickerFor(draft.key)}
              onPatch={(fn) => patch(draft.key, fn)}
              onMove={(direction) => onChange(moveMessage(value, draft.key, direction))}
              onRemove={() => {
                onChange(removeMessage(value, draft.key));
                if (activeKey === draft.key) setActiveKey(null);
              }}
            />
          ))}

          {mode === 'sequence' && !readOnly ? (
            <div className="flex flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={messages.length >= MAX_SEQUENCE_MESSAGES}
                leftIcon={<Plus className="size-4" aria-hidden />}
                onClick={() => onChange(addMessage(value))}
              >
                Adicionar mensagem
              </Button>
              {messages.length >= MAX_SEQUENCE_MESSAGES ? (
                <p className="text-xs text-text-low">
                  Até {MAX_SEQUENCE_MESSAGES} mensagens por sequência — mais que isso costuma virar
                  descadastro.
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === 'sequence' ? (
            <label className="flex items-start gap-2 rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-text-mid">
              <input
                type="checkbox"
                checked={value.stopOnReply}
                disabled={readOnly}
                onChange={(e) => onChange({ ...value, stopOnReply: e.target.checked })}
                className="mt-0.5 accent-current"
              />
              <span>
                <span className="block text-text">Parar a sequência para quem responder</span>
                <span className="block text-xs text-text-low">
                  Quem já conversou com você não recebe as próximas mensagens automáticas.
                </span>
              </span>
            </label>
          ) : null}

          {globalIssue && showAllErrors ? (
            <p role="alert" className="text-sm text-danger">
              {globalIssue.text}
            </p>
          ) : null}
        </div>

        <aside className="flex flex-col gap-2 lg:sticky lg:top-6" aria-label="Prévia">
          <p className="text-xs font-medium uppercase tracking-wide text-text-low">
            {mode === 'sequence' && active
              ? `Prévia · mensagem ${messages.indexOf(active) + 1}`
              : 'Prévia'}
          </p>
          {catalog.isPending && channelId ? (
            <Skeleton className="h-[22rem] w-full max-w-[20rem] rounded-lg" />
          ) : (
            <PhonePreview
              template={activeTemplate}
              bindings={active?.bindings ?? []}
              contact={sampleContact}
              senderName={sender}
            />
          )}
          <p className="text-center text-xs text-text-low">
            {sampleContact
              ? `Com os dados de ${sampleContact.displayName?.trim() || 'um contato do público'}.`
              : 'Sem contato de exemplo: os campos mostram o texto reserva.'}
          </p>
        </aside>
      </div>

      <TemplatePicker
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        channelId={channelId}
        templates={approved}
        loading={catalog.isPending}
        error={catalog.isError ? catalog.error : null}
        onRetry={() => void catalog.refetch()}
        retrying={catalog.isFetching}
        truncated={catalog.data?.truncated ?? false}
        selectedId={pickingDraft ? (resolveTemplate(pickingDraft, approved)?.id ?? null) : null}
        onSelect={(template) => {
          if (pickerFor !== null) patch(pickerFor, (d) => selectTemplate(d, template));
          setActiveKey(pickerFor);
          setPickerFor(null);
        }}
      />
    </div>
  );
}
