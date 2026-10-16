'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ReadOnlyGuard, useIsReadOnly } from '@/shared/components/account-banner';
import { Panel, SaveFooter, SectionLoading } from '../personal/components';
import { useSlaRules, useUpsertSla } from './queries';

function minsFromSecs(secs: number | null): string {
  return secs == null ? '' : String(Math.round(secs / 60));
}
function secsFromMins(value: string): number | null {
  const n = Number(value);
  return value.trim() === '' || Number.isNaN(n) || n <= 0 ? null : Math.round(n * 60);
}

/**
 * SLAs: limites do workspace (em minutos) que alimentam os alertas do dashboard. DS 3.0
 * (F72-S07): valores em mono. Só leitura (F71-S17): "Salvar" fica `aria-disabled`.
 */
export default function SlasSection(): React.JSX.Element {
  const { toast } = useToast();
  const slaQuery = useSlaRules();
  const upsert = useUpsertSla();
  // Só leitura: o botão fica focável (aria-disabled + explicação) mesmo sem alterações;
  // `disabled` tiraria o botão do Tab e a explicação nunca seria encontrada.
  const readOnly = useIsReadOnly();
  const [firstResponse, setFirstResponse] = useState('');
  const [resolution, setResolution] = useState('');
  const [initial, setInitial] = useState({ firstResponse: '', resolution: '' });

  useEffect(() => {
    const ws = (slaQuery.data?.rules ?? []).find((r) => r.scopeType === 'workspace');
    const next = {
      firstResponse: minsFromSecs(ws?.firstResponseSecs ?? null),
      resolution: minsFromSecs(ws?.resolutionSecs ?? null),
    };
    setFirstResponse(next.firstResponse);
    setResolution(next.resolution);
    setInitial(next);
  }, [slaQuery.data]);

  const dirty = firstResponse !== initial.firstResponse || resolution !== initial.resolution;

  const save = async () => {
    try {
      await upsert.mutateAsync({
        scopeType: 'workspace',
        scopeId: null,
        firstResponseSecs: secsFromMins(firstResponse),
        resolutionSecs: secsFromMins(resolution),
      });
      setInitial({ firstResponse, resolution });
      toast({ variant: 'success', title: 'SLA salvo.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (slaQuery.isLoading) return <SectionLoading rows={2} label="Carregando SLAs" />;

  return (
    <Panel
      title="Limites do workspace"
      description="Em minutos. Vazio = sem limite. Alimentam os alertas do dashboard."
      footer={
        <SaveFooter dirty={dirty}>
          <ReadOnlyGuard>
            <Button variant="primary" disabled={!readOnly && !dirty} loading={upsert.isPending} onClick={() => void save()}>
              Salvar SLA
            </Button>
          </ReadOnlyGuard>
        </SaveFooter>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          label="Primeira resposta (min)"
          type="number"
          inputMode="numeric"
          min={1}
          className="font-mono tabular-nums"
          value={firstResponse}
          onChange={(e) => setFirstResponse(e.target.value)}
          placeholder="ex.: 15"
        />
        <Input
          label="Resolução (min)"
          type="number"
          inputMode="numeric"
          min={1}
          className="font-mono tabular-nums"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="ex.: 240"
        />
      </div>
    </Panel>
  );
}
