'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { AlertCircle } from 'lucide-react';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { ApiError } from '@/shared/lib/api-client';
import { useCreateEvent } from '@/features/calendar/queries';
import type { CreateEventInput } from '@/features/calendar/types';
import {
  QUICK_DATE_OPTIONS,
  addMinutes,
  fromLocalParts,
  resolveQuickDate,
  toLocalParts,
  DEFAULT_DURATION_MIN,
  type QuickDateShortcut,
} from './quickDates';
import {
  EVENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  type EventPriority,
  type QuickEventType,
  type QuickScheduleCreatePayload,
  type QuickScheduleModalProps,
} from './types';

/** Atalho selecionado por padrão ao abrir — "criar em segundos". */
const DEFAULT_SHORTCUT: QuickDateShortcut = 'tomorrow';
const DEFAULT_TYPE: QuickEventType = 'follow_up';
const DEFAULT_PRIORITY: EventPriority = 'medium';

interface SubmitError {
  readonly reason: string;
  readonly whatToDo: string;
  readonly reference?: string;
}

/** Deriva as 3 partes (o quê implícito / porquê / o que fazer) de um erro da API. */
function describeError(err: unknown): SubmitError {
  if (err instanceof ApiError) {
    const reason = err.issues?.[0]?.message ?? err.message;
    const whatToDo =
      err.status === 400 || err.status === 422
        ? 'Revise os campos destacados e tente novamente.'
        : 'Aguarde um instante e tente novamente.';
    return { reason, whatToDo, reference: err.ref };
  }
  return {
    reason: 'Ocorreu um erro inesperado ao salvar.',
    whatToDo: 'Aguarde um instante e tente novamente.',
  };
}

export function QuickScheduleModal(props: QuickScheduleModalProps): React.JSX.Element {
  const { open, contactId, conversationId, onClose, onCreated } = props;
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const create = useCreateEvent();

  const [shortcut, setShortcut] = useState<QuickDateShortcut>(DEFAULT_SHORTCUT);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [type, setType] = useState<QuickEventType>(DEFAULT_TYPE);
  const [priority, setPriority] = useState<EventPriority>(DEFAULT_PRIORITY);
  const [description, setDescription] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  // Reset + default ao (re)abrir: pré-seleciona "Amanhã" e preenche os pickers.
  useEffect(() => {
    if (!open) return;
    setShortcut(DEFAULT_SHORTCUT);
    setType(DEFAULT_TYPE);
    setPriority(DEFAULT_PRIORITY);
    setDescription('');
    setFieldError(null);
    setSubmitError(null);
    const resolved = resolveQuickDate(DEFAULT_SHORTCUT, new Date());
    if (resolved) {
      const parts = toLocalParts(resolved.startAt);
      setDate(parts.date);
      setTime(parts.time);
    }
  }, [open]);

  function applyShortcut(next: QuickDateShortcut): void {
    setShortcut(next);
    setFieldError(null);
    if (next === 'custom') return; // mantém o que está nos pickers; edição manual
    const resolved = resolveQuickDate(next, new Date());
    if (resolved) {
      const parts = toLocalParts(resolved.startAt);
      setDate(parts.date);
      setTime(parts.time);
    }
  }

  // Edição manual dos pickers tira a seleção dos chips (vira "Personalizar").
  function onEditDate(value: string): void {
    setDate(value);
    setShortcut('custom');
    setFieldError(null);
  }
  function onEditTime(value: string): void {
    setTime(value);
    setShortcut('custom');
    setFieldError(null);
  }

  const pending = create.isPending;

  function submit(): void {
    const startAt = fromLocalParts(date, time);
    if (!startAt) {
      setFieldError('Informe data e hora válidas.');
      return;
    }
    setFieldError(null);
    setSubmitError(null);

    const typeLabel = EVENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? 'Compromisso';
    const trimmed = description.trim();
    const payload: QuickScheduleCreatePayload = {
      title: trimmed ? trimmed.slice(0, 300) : typeLabel,
      startAt,
      endAt: addMinutes(startAt, DEFAULT_DURATION_MIN),
      type,
      priority,
      description: trimmed || null,
      contactId,
      conversationId,
    };

    // Único ponto de estreitamento: o `CreateEventInput` de features/calendar ainda
    // não expõe `priority` nem os `type` comerciais (fronteira proibida do slot),
    // mas a API (F53-S02) os aceita. O payload é montado de forma estrita acima.
    create.mutate(payload as CreateEventInput, {
      onSuccess: () => {
        toast({ variant: 'success', title: 'Compromisso agendado.' });
        onCreated?.();
        onClose();
      },
      onError: (err) => {
        setSubmitError(describeError(err));
        toast({ variant: 'error', title: 'Não foi possível agendar.' });
      },
    });
  }

  const title = 'Agendar compromisso';

  const ctaSize = isMobile ? 'lg' : 'md';
  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" size={ctaSize} onClick={onClose} disabled={pending}>
        Cancelar
      </Button>
      <Button variant="primary" size={ctaSize} onClick={submit} disabled={pending} loading={pending}>
        Agendar
      </Button>
    </div>
  );

  const body = (
    <div className="flex flex-col gap-4">
      {/* Atalhos de data (chips) — ação rápida acima dos pickers (UX §3.5). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-low">Quando</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Atalhos de data">
          {QUICK_DATE_OPTIONS.map((opt) => {
            const active = shortcut === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyShortcut(opt.id)}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-pill border px-3.5 text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
                  active
                    ? 'border-border-brand bg-brand-soft text-text'
                    : 'border-border bg-surface-2 text-text-mid hover:text-text',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <Field label="Data" className="flex-1">
          <Input
            type="date"
            size={isMobile ? 'lg' : 'md'}
            value={date}
            onChange={(e) => onEditDate(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
          />
        </Field>
        <Field label="Hora" className="flex-1">
          <Input
            type="time"
            size={isMobile ? 'lg' : 'md'}
            value={time}
            onChange={(e) => onEditTime(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
          />
        </Field>
      </div>
      {fieldError ? (
        <p className="-mt-2 text-xs text-danger" role="alert">
          {fieldError}
        </p>
      ) : null}

      <Field label="Tipo">
        <Select value={type} onChange={(v) => setType(v as QuickEventType)} ariaLabel="Tipo">
          {EVENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {/* Prioridade — chips segmentados (alvo ≥ 44px). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-low">Prioridade</span>
        <div className="flex gap-2" role="group" aria-label="Prioridade">
          {PRIORITY_OPTIONS.map((o) => {
            const active = priority === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                onClick={() => setPriority(o.value)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center rounded-md border px-3 text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
                  active
                    ? 'border-border-brand bg-surface-3 text-text'
                    : 'border-border bg-surface-2 text-text-mid hover:text-text',
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="Descrição (opcional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder="Ex.: confirmar interesse na proposta…"
          className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors duration-200 focus-visible:border-border-brand"
        />
      </Field>

      {/* Erro do submit em 3 partes (o quê / porquê / o que fazer) — UX §2.11. */}
      {submitError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium text-text">Não foi possível agendar</span>
            <span className="text-text-mid">{submitError.reason}</span>
            <span className="text-xs text-text-low">{submitError.whatToDo}</span>
            {submitError.reference ? (
              <span className="mt-0.5 font-price text-xs text-text-low">
                Ref: {submitError.reference}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onClose={onClose} variant="bottom" title={title} footer={footer}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer} className="max-w-lg">
      {body}
    </Modal>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs text-text-low">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 rounded-md border border-border bg-surface-2 px-3 text-sm text-text outline-none transition-colors duration-200 focus-visible:border-border-brand"
    >
      {children}
    </select>
  );
}
