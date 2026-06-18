'use client';

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Button, Input, Modal, useToast } from '@hm/ui';
import { cn } from '@hm/ui/cn';
import { Sheet } from '@/shared/components/Sheet';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useCalendarMembers, useCreateEvent, useUpdateEvent } from './queries';
import {
  WEEKDAY_CODES,
  buildRecurrenceRule,
  masterEventId,
  parseRecurrenceForForm,
  type CalendarRow,
  type EventRow,
  type EventType,
  type RecurrenceMode,
  type WeekdayCode,
} from './types';

const EVENT_TYPES: ReadonlyArray<{ value: EventType; label: string }> = [
  { value: 'meeting', label: 'Reunião' },
  { value: 'demo', label: 'Demo' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'task', label: 'Tarefa' },
  { value: 'reminder', label: 'Lembrete' },
  { value: 'other', label: 'Outro' },
];

const RECURRENCE_OPTIONS: ReadonlyArray<{ value: RecurrenceMode; label: string }> = [
  { value: 'none', label: 'Não se repete' },
  { value: 'daily', label: 'Todos os dias' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'weekdays', label: 'Dias úteis (seg–sex)' },
  { value: 'custom', label: 'Dias específicos…' },
];

const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  SU: 'D',
  MO: 'S',
  TU: 'T',
  WE: 'Q',
  TH: 'Q',
  FR: 'S',
  SA: 'S',
};
const WEEKDAY_FULL: Record<WeekdayCode, string> = {
  SU: 'Domingo',
  MO: 'Segunda',
  TU: 'Terça',
  WE: 'Quarta',
  TH: 'Quinta',
  FR: 'Sexta',
  SA: 'Sábado',
};

/** Schema Zod inline (UX: validação na borda, mensagens em PT-BR). */
const formSchema = z
  .object({
    calendarId: z.string().uuid({ message: 'Selecione um calendário.' }),
    title: z.string().trim().min(1, 'Informe um título.').max(300),
    type: z.enum(['meeting', 'demo', 'follow_up', 'task', 'reminder', 'other']),
    start: z.string().min(1, 'Informe o início.'),
    end: z.string().min(1, 'Informe o fim.'),
    location: z.string().trim().max(500),
    meetingUrl: z
      .string()
      .trim()
      .max(1000)
      .refine((v) => v === '' || /^https?:\/\//i.test(v), 'URL deve começar com http(s)://'),
    description: z.string().trim().max(5000),
  })
  .refine((d) => new Date(d.start) < new Date(d.end), {
    message: 'O fim deve ser depois do início.',
    path: ['end'],
  });

/** Converte ISO → valor para <input type="datetime-local"> (no tz local do browser). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

/** datetime-local (local) → ISO com offset, para a API persistir em UTC. */
function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** `YYYY-MM-DD` (date input) → ISO no fim do dia local, para UNTIL inclusivo. */
function untilFromDate(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T23:59:59`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function untilToDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

export interface EventFormProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly calendars: readonly CalendarRow[];
  readonly defaultCalendarId?: string;
  readonly defaultStart?: string | null;
  readonly defaultEnd?: string | null;
  /** Edição: evento existente (mestre ou ocorrência — edita a SÉRIE na v1). */
  readonly event?: EventRow | null;
}

export function EventForm(props: EventFormProps): React.JSX.Element {
  const { toast } = useToast();
  const { isMobile } = useBreakpoint();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const membersQuery = useCalendarMembers();
  const members = useMemo(() => membersQuery.data?.members ?? [], [membersQuery.data]);
  const isEdit = Boolean(props.event);

  const [calendarId, setCalendarId] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<EventType>('meeting');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [location, setLocation] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [description, setDescription] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [recurrenceMode, setRecurrenceMode] = useState<RecurrenceMode>('none');
  const [weekDays, setWeekDays] = useState<WeekdayCode[]>([]);
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!props.open) return;
    const ev = props.event;
    setCalendarId(ev?.calendarId ?? props.defaultCalendarId ?? props.calendars[0]?.id ?? '');
    setTitle(ev?.title ?? '');
    setType(ev?.type ?? 'meeting');
    setStart(toLocalInput(ev?.startAt ?? props.defaultStart ?? null));
    setEnd(toLocalInput(ev?.endAt ?? props.defaultEnd ?? null));
    setLocation(ev?.location ?? '');
    setMeetingUrl(ev?.meetingUrl ?? '');
    setDescription(ev?.description ?? '');
    setParticipantIds([]);
    const rec = parseRecurrenceForForm(ev?.recurrenceRule ?? null);
    setRecurrenceMode(rec.mode);
    setWeekDays(rec.weekDays);
    setRecurrenceUntil(untilToDateInput(ev?.recurrenceUntil ?? null));
    setErrors({});
  }, [
    props.open,
    props.event,
    props.defaultCalendarId,
    props.defaultStart,
    props.defaultEnd,
    props.calendars,
  ]);

  const pending = create.isPending || update.isPending;

  function toggleParticipant(id: string): void {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleWeekDay(code: WeekdayCode): void {
    setWeekDays((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  }

  function submit(): void {
    const parsed = formSchema.safeParse({
      calendarId,
      title,
      type,
      start,
      end,
      location,
      meetingUrl,
      description,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast({ variant: 'error', title: 'Revise os campos destacados.' });
      return;
    }
    setErrors({});
    const d = parsed.data;

    const recurrenceRule = buildRecurrenceRule({
      mode: recurrenceMode,
      weekDays,
      until: untilFromDate(recurrenceUntil),
    });
    const recurrenceUntilIso = untilFromDate(recurrenceUntil);

    if (isEdit && props.event) {
      // Ocorrência → edita a SÉRIE (opera sobre o mestre). v1 documentado.
      const targetId = masterEventId(props.event);
      update.mutate(
        {
          id: targetId,
          patch: {
            title: d.title,
            startAt: fromLocalInput(d.start),
            endAt: fromLocalInput(d.end),
            type: d.type,
            description: d.description.trim() || null,
            location: d.location.trim() || null,
            meetingUrl: d.meetingUrl.trim() || null,
            recurrenceRule,
            recurrenceUntil: recurrenceUntilIso,
          },
        },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Evento atualizado.' });
            props.onClose();
          },
          onError: (e) => toast({ variant: 'error', title: e.message }),
        },
      );
    } else {
      create.mutate(
        {
          calendarId: d.calendarId,
          title: d.title,
          startAt: fromLocalInput(d.start),
          endAt: fromLocalInput(d.end),
          type: d.type,
          description: d.description.trim() || null,
          location: d.location.trim() || null,
          meetingUrl: d.meetingUrl.trim() || null,
          memberIds: participantIds.length > 0 ? participantIds : undefined,
          recurrenceRule,
          recurrenceUntil: recurrenceUntilIso,
        },
        {
          onSuccess: () => {
            toast({ variant: 'success', title: 'Evento criado.' });
            props.onClose();
          },
          onError: (e) => toast({ variant: 'error', title: e.message }),
        },
      );
    }
  }

  const formTitle = isEdit ? 'Editar evento' : 'Novo evento';

  const footer = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={props.onClose} disabled={pending}>
        Cancelar
      </Button>
      <Button variant="primary" onClick={submit} disabled={pending} loading={pending}>
        {isEdit ? 'Salvar' : 'Criar'}
      </Button>
    </div>
  );

  const body = (
    <div className="flex flex-col gap-3">
      <Field label="Título" error={errors['title']}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Reunião com…"
          autoFocus
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Calendário" className="flex-1" error={errors['calendarId']}>
          <Select value={calendarId} onChange={setCalendarId} disabled={isEdit}>
            {props.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo" className="flex-1">
          <Select value={type} onChange={(v) => setType(v as EventType)}>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex gap-3">
        <Field label="Início" className="flex-1" error={errors['start']}>
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fim" className="flex-1" error={errors['end']}>
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      {/* Recorrência */}
      <Field label="Repetir">
        <Select value={recurrenceMode} onChange={(v) => setRecurrenceMode(v as RecurrenceMode)}>
          {RECURRENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {recurrenceMode === 'custom' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-low">Dias da semana</span>
          <div className="flex gap-1.5">
            {WEEKDAY_CODES.map((code) => {
              const on = weekDays.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_FULL[code]}
                  title={WEEKDAY_FULL[code]}
                  onClick={() => toggleWeekDay(code)}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
                    on
                      ? 'bg-brand-soft text-text'
                      : 'border border-border bg-surface-2 text-text-low hover:text-text',
                  )}
                >
                  {WEEKDAY_LABELS[code]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {recurrenceMode !== 'none' && (
        <Field label="Repetir até (opcional)">
          <Input
            type="date"
            value={recurrenceUntil}
            onChange={(e) => setRecurrenceUntil(e.target.value)}
          />
        </Field>
      )}

      {/* Participantes (apenas na criação — vínculo definido no insert do service) */}
      {!isEdit && (
        <Field label="Participantes (opcional)">
          {membersQuery.isLoading ? (
            <p className="text-xs text-text-low">Carregando membros…</p>
          ) : members.length === 0 ? (
            <p className="text-xs text-text-low">Nenhum membro disponível.</p>
          ) : (
            <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-surface-2 p-1">
              {members.map((m) => {
                const on = participantIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleParticipant(m.id)}
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none transition-colors duration-200 focus-visible:shadow-glow-md',
                      on ? 'bg-surface-3 text-text' : 'text-text-mid hover:bg-surface-3/60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded border',
                        on ? 'border-border-brand bg-brand-soft' : 'border-border',
                      )}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span className="truncate">{m.name?.trim() || m.email}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Field>
      )}

      <div className="flex gap-3">
        <Field label="Local (opcional)" className="flex-1">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Sala / endereço"
          />
        </Field>
        <Field label="Link da reunião (opcional)" className="flex-1" error={errors['meetingUrl']}>
          <Input
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field label="Descrição (opcional)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text outline-none focus-visible:border-border-brand"
        />
      </Field>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={props.open} onClose={props.onClose} variant="full" title={formTitle} footer={footer}>
        {body}
      </Sheet>
    );
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={formTitle}
      footer={footer}
      className="max-w-xl"
    >
      {body}
    </Modal>
  );
}

function Field({
  label,
  className,
  error,
  children,
}: {
  label: string;
  className?: string;
  error?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-xs text-text-low">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-md border border-border bg-surface-2 px-3 text-sm text-text outline-none focus-visible:border-border-brand disabled:opacity-40"
    >
      {children}
    </select>
  );
}
