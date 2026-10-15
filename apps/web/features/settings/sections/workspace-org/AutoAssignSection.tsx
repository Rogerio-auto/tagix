'use client';

import { useEffect, useState } from 'react';
import { Button, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { cn } from '@/shared/lib/cn';
import { Panel, Row, SaveFooter, SectionLoading, Toggle } from '../personal/components';
import { useUpdateWorkspace, useWorkspace } from './queries';

type Strategy = 'round_robin' | 'least_busy' | 'manual';

interface AutoAssign {
  strategy: Strategy;
  fallbackToManual: boolean;
}

const STRATEGIES: ReadonlyArray<{ value: Strategy; label: string; description: string }> = [
  { value: 'manual', label: 'Manual', description: 'Sem distribuição automática: alguém da equipe atribui.' },
  { value: 'round_robin', label: 'Rodízio', description: 'Uma conversa para cada pessoa disponível, em ordem.' },
  { value: 'least_busy', label: 'Menos ocupado', description: 'Vai para quem tem menos conversas abertas.' },
];

function readAutoAssign(settings: Record<string, unknown> | undefined): AutoAssign {
  const raw = settings?.['auto_assign'];
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const strategy = o['strategy'];
    return {
      strategy:
        strategy === 'round_robin' || strategy === 'least_busy' || strategy === 'manual' ? strategy : 'manual',
      fallbackToManual: o['fallbackToManual'] !== false,
    };
  }
  return { strategy: 'manual', fallbackToManual: true };
}

/**
 * Auto-assign: estratégia global de roteamento (reusa a engine F1-S23 por time), no DS 3.0
 * (F72-S07): as três estratégias como opções lado a lado (radio), com a frase do que cada
 * uma faz. Só leitura (F71-S17): "Salvar" fica `aria-disabled` com a explicação.
 */
export default function AutoAssignSection(): React.JSX.Element {
  const { toast } = useToast();
  const wsQuery = useWorkspace();
  const update = useUpdateWorkspace();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();
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

  if (wsQuery.isLoading) return <SectionLoading label="Carregando distribuição" />;

  return (
    <Panel
      title="Distribuição de conversas"
      description="Como uma conversa nova encontra um atendente."
      body="flush"
      footer={
        <SaveFooter dirty={dirty}>
          <ReadOnlyGuard>
            <Button variant="primary" disabled={!readOnly && !dirty} loading={update.isPending} onClick={() => void save()}>
              Salvar distribuição
            </Button>
          </ReadOnlyGuard>
        </SaveFooter>
      }
    >
      <fieldset className="flex flex-col gap-2 px-5 py-5">
        <legend className="mb-2 font-body text-sm font-bold text-text-mid">Estratégia</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {STRATEGIES.map((s) => {
            const checked = cfg.strategy === s.value;
            return (
              <label
                key={s.value}
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-[border-color,background-color] duration-(--dur-base) ease-ds',
                  'has-[:focus-visible]:focus-ring',
                  checked
                    ? 'border-brand-text/50 bg-brand-text/[0.06]'
                    : 'border-border bg-surface-2 hover:border-border-2',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="auto-assign-strategy"
                    value={s.value}
                    checked={checked}
                    onChange={() => setCfg((c) => ({ ...c, strategy: s.value }))}
                    className="size-4 accent-brand-text outline-none"
                  />
                  <span className="font-body text-sm font-bold text-text">{s.label}</span>
                </span>
                <span className="font-body text-sm text-text-low">{s.description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="border-t border-border px-5">
        <Row title="Fallback manual" description="Se ninguém estiver disponível, deixa na fila para atribuição manual.">
          <Toggle
            checked={cfg.fallbackToManual}
            onChange={(v) => setCfg((c) => ({ ...c, fallbackToManual: v }))}
            label="Fallback manual"
          />
        </Row>
      </div>
    </Panel>
  );
}
