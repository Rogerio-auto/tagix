'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { FieldLabel, Row, Toggle, selectClass } from '../personal/components';
import { useUpdateWorkspace, useWorkspace } from './queries';

type Strategy = 'round_robin' | 'least_busy' | 'manual';

interface AutoAssign {
  strategy: Strategy;
  fallbackToManual: boolean;
}

function readAutoAssign(settings: Record<string, unknown> | undefined): AutoAssign {
  const raw = settings?.['auto_assign'];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const strategy = o['strategy'];
    return {
      strategy:
        strategy === 'round_robin' || strategy === 'least_busy' || strategy === 'manual'
          ? strategy
          : 'manual',
      fallbackToManual: o['fallbackToManual'] !== false,
    };
  }
  return { strategy: 'manual', fallbackToManual: true };
}

/** Auto-assign: estratégia global de roteamento (reusa engine F1-S23 por time). */
export default function AutoAssignSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
  const [cfg, setCfg] = useState<AutoAssign>({ strategy: 'manual', fallbackToManual: true });
  const [initial, setInitial] = useState(cfg);

  useEffect(() => {
    const next = readAutoAssign(wsQuery.data?.workspace.settings);
    setCfg(next);
    setInitial(next);
  }, [wsQuery.data]);

  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial);

  const save = async () => {
    try {
      await update.mutateAsync({ autoAssign: cfg });
      setInitial(cfg);
      toast({ variant: 'success', title: 'Auto-assign salvo.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (wsQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <FieldLabel label="Estratégia de distribuição">
        <select
          value={cfg.strategy}
          onChange={(e) => setCfg((c) => ({ ...c, strategy: e.target.value as Strategy }))}
          className={selectClass}
        >
          <option value="manual">Manual (sem auto-assign)</option>
          <option value="round_robin">Round-robin</option>
          <option value="least_busy">Menos ocupado</option>
        </select>
      </FieldLabel>
      <Row title="Fallback manual" description="Se ninguém estiver disponível, deixa na fila para atribuição manual.">
        <Toggle
          checked={cfg.fallbackToManual}
          onChange={(v) => setCfg((c) => ({ ...c, fallbackToManual: v }))}
          label="Fallback manual"
        />
      </Row>
      <div>
        <Button variant="primary" disabled={!dirty || update.isPending} onClick={() => void save()}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
