'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Input, useToast } from '@hm/ui';
import {
  useAvailabilityExceptions,
  useAvailabilityRules,
  useAvailabilitySlots,
  useCreateException,
  useDeleteException,
  useSaveAvailabilityRules,
} from './queries';
import type { RuleInput } from './types';

const DAY_LABELS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

interface DayState {
  readonly enabled: boolean;
  readonly start: string; // HH:MM
  readonly end: string; // HH:MM
}

const EMPTY_DAY: DayState = { enabled: false, start: '09:00', end: '18:00' };

function normalizeTime(t: string): string {
  // API retorna HH:MM:SS; input usa HH:MM.
  return t.slice(0, 5);
}

type DaysByWeek = readonly [DayState, DayState, DayState, DayState, DayState, DayState, DayState];

function makeEmptyWeek(): DaysByWeek {
  return [
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
    { ...EMPTY_DAY },
  ] as const;
}

const PRESETS: ReadonlyArray<{ label: string; build: () => DaysByWeek }> = [
  {
    label: 'Horário comercial (Seg–Sex 9–18)',
    build: () => {
      const week = makeEmptyWeek().map((d) => ({ ...d })) as DayState[];
      for (let i = 1; i <= 5; i += 1) week[i] = { enabled: true, start: '09:00', end: '18:00' };
      return week as unknown as DaysByWeek;
    },
  },
  {
    label: 'Apenas tarde (Seg–Sex 14–18)',
    build: () => {
      const week = makeEmptyWeek().map((d) => ({ ...d })) as DayState[];
      for (let i = 1; i <= 5; i += 1) week[i] = { enabled: true, start: '14:00', end: '18:00' };
      return week as unknown as DaysByWeek;
    },
  },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Settings de disponibilidade (F7-S07, /settings/calendar): editor de
 * availability_rules por dia da semana (PUT bulk) com presets, gestão de
 * availability_exceptions e preview de slots (reflete compute_available_slots).
 */
export function AvailabilityRulesSettings(): React.JSX.Element {
  const { toast } = useToast();
  const rulesQuery = useAvailabilityRules();
  const save = useSaveAvailabilityRules();
  const exceptionsQuery = useAvailabilityExceptions();
  const createException = useCreateException();
  const deleteException = useDeleteException();

  const [week, setWeek] = useState<DaysByWeek>(makeEmptyWeek);
  const [dirty, setDirty] = useState(false);

  // Hidrata o estado a partir das regras carregadas (uma regra por dia no MVP).
  useEffect(() => {
    const rules = rulesQuery.data?.rules;
    if (!rules) return;
    const next = makeEmptyWeek().map((d) => ({ ...d })) as DayState[];
    for (const r of rules) {
      if (r.dayOfWeek >= 0 && r.dayOfWeek <= 6 && r.isActive && r.isAvailable) {
        next[r.dayOfWeek] = {
          enabled: true,
          start: normalizeTime(r.startTime),
          end: normalizeTime(r.endTime),
        };
      }
    }
    setWeek(next as unknown as DaysByWeek);
    setDirty(false);
  }, [rulesQuery.data]);

  function patchDay(idx: number, patch: Partial<DayState>): void {
    setWeek((prev) => {
      const next = prev.map((d) => ({ ...d })) as DayState[];
      next[idx] = { ...next[idx], ...patch } as DayState;
      return next as unknown as DaysByWeek;
    });
    setDirty(true);
  }

  function applyPreset(build: () => DaysByWeek): void {
    setWeek(build());
    setDirty(true);
  }

  const invalidDays = useMemo(
    () =>
      week
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => d.enabled && d.start >= d.end)
        .map(({ i }) => i),
    [week],
  );

  function onSave(): void {
    if (invalidDays.length > 0) {
      toast({ variant: 'error', title: 'Há dias com início depois (ou igual) ao fim.' });
      return;
    }
    const payload: RuleInput[] = week
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.enabled)
      .map(({ d, i }) => ({
        name: DAY_LABELS[i] ?? `Dia ${i}`,
        dayOfWeek: i,
        startTime: d.start,
        endTime: d.end,
        isAvailable: true,
        isActive: true,
      }));
    save.mutate(payload, {
      onSuccess: () => {
        setDirty(false);
        toast({ variant: 'success', title: 'Disponibilidade salva.' });
      },
      onError: (e) => toast({ variant: 'error', title: e.message }),
    });
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-5 text-brand" />
        <h1 className="text-lg font-semibold text-text">Disponibilidade</h1>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-text-low">
          <Sparkles className="size-3.5" />
          Presets
        </span>
        {PRESETS.map((p) => (
          <Button key={p.label} variant="ghost" size="sm" onClick={() => applyPreset(p.build)}>
            {p.label}
          </Button>
        ))}
      </div>

      {/* Regras por dia */}
      <Card elevation={1}>
        <CardHeader>
          <span className="text-sm font-medium text-text">Janelas por dia da semana</span>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          {DAY_LABELS.map((label, i) => {
            const day = week[i] as DayState;
            const invalid = invalidDays.includes(i);
            return (
              <div
                key={label}
                className="flex flex-wrap items-center gap-3 border-b border-border-subtle py-2 last:border-0"
              >
                <label className="flex w-32 items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(e) => patchDay(i, { enabled: e.target.checked })}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {label}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    aria-label={`${label} início`}
                    onChange={(e) => patchDay(i, { start: e.target.value })}
                    className="w-32"
                  />
                  <span className="text-text-low">→</span>
                  <Input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    aria-label={`${label} fim`}
                    onChange={(e) => patchDay(i, { end: e.target.value })}
                    className="w-32"
                  />
                </div>
                {invalid && (
                  <span className="text-xs text-danger">início deve ser antes do fim</span>
                )}
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3 pt-2">
            {dirty && <span className="text-xs text-text-low">Alterações não salvas</span>}
            <Button
              variant="primary"
              disabled={!dirty || save.isPending || invalidDays.length > 0}
              onClick={onSave}
            >
              Salvar disponibilidade
            </Button>
          </div>
        </CardBody>
      </Card>

      <ExceptionsSection
        onError={(m) => toast({ variant: 'error', title: m })}
        exceptions={exceptionsQuery.data?.exceptions ?? []}
        creating={createException.isPending}
        onCreate={(input, done) =>
          createException.mutate(input, {
            onSuccess: () => done(),
            onError: (e) => toast({ variant: 'error', title: e.message }),
          })
        }
        deleting={deleteException.isPending}
        onDelete={(id) =>
          deleteException.mutate(id, {
            onError: (e) => toast({ variant: 'error', title: e.message }),
          })
        }
      />

      <SlotsPreview />
    </div>
  );
}

interface ExceptionsSectionProps {
  readonly exceptions: ReadonlyArray<{
    id: string;
    startDate: string;
    endDate: string;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isAvailable: boolean;
    reason: string | null;
  }>;
  readonly creating: boolean;
  readonly deleting: boolean;
  readonly onError: (msg: string) => void;
  readonly onCreate: (
    input: {
      startDate: string;
      endDate: string;
      startTime?: string | null;
      endTime?: string | null;
      isAllDay?: boolean;
      isAvailable?: boolean;
      reason?: string | null;
    },
    done: () => void,
  ) => void;
  readonly onDelete: (id: string) => void;
}

function ExceptionsSection(props: ExceptionsSectionProps): React.JSX.Element {
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [reason, setReason] = useState('');

  function add(): void {
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      props.onError('Data inicial deve ser anterior ou igual à final.');
      return;
    }
    props.onCreate(
      { startDate, endDate, isAllDay: true, isAvailable: false, reason: reason.trim() || null },
      () => {
        setReason('');
      },
    );
  }

  return (
    <Card elevation={1}>
      <CardHeader>
        <span className="text-sm font-medium text-text">Exceções (bloqueios)</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {props.exceptions.length === 0 ? (
          <p className="text-sm text-text-low">Nenhuma exceção cadastrada.</p>
        ) : (
          props.exceptions.map((ex) => (
            <div key={ex.id} className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-text">
                  {ex.startDate === ex.endDate ? ex.startDate : `${ex.startDate} → ${ex.endDate}`}
                  {!ex.isAllDay && ex.startTime && ex.endTime
                    ? ` · ${ex.startTime.slice(0, 5)}–${ex.endTime.slice(0, 5)}`
                    : ' · dia inteiro'}
                </span>
                <span className="text-xs text-text-low">
                  {ex.isAvailable ? 'disponível' : 'bloqueado'}
                  {ex.reason ? ` · ${ex.reason}` : ''}
                </span>
              </div>
              <button
                type="button"
                disabled={props.deleting}
                onClick={() => props.onDelete(ex.id)}
                aria-label="Remover exceção"
                className="text-text-low hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-low" htmlFor="ex-start">
              De
            </label>
            <Input
              id="ex-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-low" htmlFor="ex-end">
              Até
            </label>
            <Input
              id="ex-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <label className="text-xs text-text-low" htmlFor="ex-reason">
              Motivo (opcional)
            </label>
            <Input
              id="ex-reason"
              value={reason}
              placeholder="Ex.: Férias"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button variant="secondary" disabled={props.creating} onClick={add}>
            <Plus className="size-4" />
            Bloquear
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function SlotsPreview(): React.JSX.Element {
  const [date, setDate] = useState(todayIso());
  const slotsQuery = useAvailabilitySlots(date, true);
  const slots = slotsQuery.data?.slots ?? [];

  return (
    <Card elevation={1}>
      <CardHeader>
        <span className="text-sm font-medium text-text">Pré-visualizar horários</span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-text-low" htmlFor="preview-date">
              Data
            </label>
            <Input
              id="preview-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
        {slotsQuery.isLoading ? (
          <p className="text-sm text-text-low">Calculando…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-text-low">Nenhum horário disponível nessa data.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <span
                key={s.startAt}
                className="rounded-md border border-border-subtle bg-surface-raised px-2.5 py-1 text-xs text-text"
              >
                {new Date(s.startAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
