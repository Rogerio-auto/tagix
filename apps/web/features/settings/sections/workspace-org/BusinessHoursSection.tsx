'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { Panel, Row, SaveFooter, SectionLoading, Toggle, controlClass, textareaClass } from '../personal/components';
import { useUpdateWorkspace, useWorkspace } from './queries';

interface DayCfg {
  open: boolean;
  from: string;
  to: string;
}
interface BusinessHours {
  enabled: boolean;
  days: DayCfg[];
  awayMessage: string;
}

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function defaultDays(): DayCfg[] {
  return DAY_LABELS.map((_, i) => ({ open: i >= 1 && i <= 5, from: '09:00', to: '18:00' }));
}

function readBusinessHours(settings: Record<string, unknown> | undefined): BusinessHours {
  const raw = settings?.['business_hours'];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const days = Array.isArray(o['days']) ? (o['days'] as unknown[]) : null;
    return {
      enabled: o['enabled'] === true,
      awayMessage: typeof o['awayMessage'] === 'string' ? (o['awayMessage'] as string) : '',
      days:
        days && days.length === 7
          ? days.map((d) => {
              const dd = (d ?? {}) as Record<string, unknown>;
              return {
                open: dd['open'] === true,
                from: typeof dd['from'] === 'string' ? (dd['from'] as string) : '09:00',
                to: typeof dd['to'] === 'string' ? (dd['to'] as string) : '18:00',
              };
            })
          : defaultDays(),
    };
  }
  return { enabled: false, days: defaultDays(), awayMessage: '' };
}

/**
 * Horário comercial: janelas por dia + mensagem fora do horário, no DS 3.0 (F72-S07):
 * a semana como grade (dia, aberto, das, até) com horários em mono. Só leitura (F71-S17):
 * "Salvar" fica `aria-disabled` com a explicação.
 */
export default function BusinessHoursSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();
  const [bh, setBh] = useState<BusinessHours>({ enabled: false, days: defaultDays(), awayMessage: '' });
  const [initial, setInitial] = useState(bh);

  useEffect(() => {
    const next = readBusinessHours(wsQuery.data?.workspace.settings);
    setBh(next);
    setInitial(next);
  }, [wsQuery.data]);

  const dirty = JSON.stringify(bh) !== JSON.stringify(initial);

  const setDay = (i: number, patch: Partial<DayCfg>) =>
    setBh((s) => ({ ...s, days: s.days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) }));

  const save = async () => {
    try {
      await update.mutateAsync({
        businessHours: {
          enabled: bh.enabled,
          awayMessage: bh.awayMessage,
          days: bh.days.map((d) => ({ open: d.open, from: d.from, to: d.to })),
        },
      });
      setInitial(bh);
      toast({ variant: 'success', title: 'Horário salvo.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (wsQuery.isLoading) return <SectionLoading rows={7} label="Carregando horário comercial" />;

  const timeClass = cn(controlClass, 'w-28 px-2 font-mono tabular-nums');

  return (
    <Panel
      body="flush"
      footer={
        <SaveFooter dirty={dirty}>
          <ReadOnlyGuard>
            <Button variant="primary" disabled={!readOnly && !dirty} loading={update.isPending} onClick={() => void save()}>
              Salvar horário
            </Button>
          </ReadOnlyGuard>
        </SaveFooter>
      }
    >
      <div className="border-b border-border px-5">
        <Row title="Ativar horário comercial" description="Define janelas de atendimento por dia.">
          <Toggle
            checked={bh.enabled}
            onChange={(v) => setBh((s) => ({ ...s, enabled: v }))}
            label="Ativar horário comercial"
          />
        </Row>
      </div>
      <ul
        aria-label="Janelas por dia da semana"
        className="divide-y divide-border px-5"
      >
        {bh.days.map((d, i) => {
          const day = DAY_LABELS[i] ?? '';
          const off = !d.open || !bh.enabled;
          return (
            <li key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <span className="w-10 font-mono text-sm font-semibold uppercase tracking-wider text-text-mid">{day}</span>
              <Toggle checked={d.open} onChange={(v) => setDay(i, { open: v })} label={`${day} aberto`} disabled={!bh.enabled} />
              {d.open ? (
                <span className="flex items-center gap-2">
                  <input
                    type="time"
                    value={d.from}
                    disabled={off}
                    onChange={(e) => setDay(i, { from: e.target.value })}
                    aria-label={`${day} início`}
                    className={timeClass}
                  />
                  <span className="text-text-low" aria-hidden>
                    –
                  </span>
                  <input
                    type="time"
                    value={d.to}
                    disabled={off}
                    onChange={(e) => setDay(i, { to: e.target.value })}
                    aria-label={`${day} fim`}
                    className={timeClass}
                  />
                </span>
              ) : (
                <span className="font-body text-sm text-text-low">Fechado</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border px-5 py-5">
        <label className="flex flex-col gap-1.5 font-body text-sm font-bold text-text-mid">
          Mensagem fora do horário
          <textarea
            value={bh.awayMessage}
            onChange={(e) => setBh((s) => ({ ...s, awayMessage: e.target.value }))}
            rows={3}
            className={cn(textareaClass, 'font-normal')}
            placeholder="Estamos fora do horário de atendimento. Retornaremos em breve."
          />
        </label>
      </div>
    </Panel>
  );
}
