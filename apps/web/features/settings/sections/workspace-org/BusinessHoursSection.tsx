'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { Row, Toggle } from '../personal/components';
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

/** Horário comercial: janelas por dia + mensagem fora do horário. */
export default function BusinessHoursSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
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

  if (wsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-lg flex-col gap-3">
      <Row title="Ativar horário comercial" description="Define janelas de atendimento por dia.">
        <Toggle checked={bh.enabled} onChange={(v) => setBh((s) => ({ ...s, enabled: v }))} label="Ativar horário comercial" />
      </Row>
      <div className="flex flex-col gap-2">
        {bh.days.map((d, i) => (
          <div key={DAY_LABELS[i]} className="flex items-center gap-3 border-b border-border/40 py-2">
            <span className="w-10 text-sm text-text-mid">{DAY_LABELS[i]}</span>
            <Toggle checked={d.open} onChange={(v) => setDay(i, { open: v })} label={`${DAY_LABELS[i]} aberto`} />
            <input
              type="time"
              value={d.from}
              disabled={!d.open || !bh.enabled}
              onChange={(e) => setDay(i, { from: e.target.value })}
              aria-label={`${DAY_LABELS[i]} início`}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text disabled:opacity-40"
            />
            <span className="text-text-low">–</span>
            <input
              type="time"
              value={d.to}
              disabled={!d.open || !bh.enabled}
              onChange={(e) => setDay(i, { to: e.target.value })}
              aria-label={`${DAY_LABELS[i]} fim`}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text disabled:opacity-40"
            />
          </div>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-sm text-text-mid">
        Mensagem fora do horário
        <textarea
          value={bh.awayMessage}
          onChange={(e) => setBh((s) => ({ ...s, awayMessage: e.target.value }))}
          rows={2}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:shadow-glow-md"
          placeholder="Estamos fora do horário de atendimento. Retornaremos em breve."
        />
      </label>
      <div>
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
