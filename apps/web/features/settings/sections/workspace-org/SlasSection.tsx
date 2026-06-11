'use client';

import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { FieldLabel } from '../personal/components';
import { useSlaRules, useUpsertSla } from './queries';

function minsFromSecs(secs: number | null): string {
  return secs == null ? '' : String(Math.round(secs / 60));
}
function secsFromMins(value: string): number | null {
  const n = Number(value);
  return value.trim() === '' || Number.isNaN(n) || n <= 0 ? null : Math.round(n * 60);
}

/** SLAs: limites do workspace (em minutos) que alimentam os alertas do dashboard. */
export default function SlasSection(): React.JSX.Element {
  const { toast } = useToast();
  const slaQuery = useSlaRules();
  const upsert = useUpsertSla();
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

  if (slaQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <p className="text-sm text-text-low">
        Limites do workspace, em minutos. Vazio = sem limite. Alimentam os alertas do dashboard.
      </p>
      <FieldLabel label="Primeira resposta (min)">
        <Input
          type="number"
          min={1}
          value={firstResponse}
          onChange={(e) => setFirstResponse(e.target.value)}
          placeholder="ex.: 15"
        />
      </FieldLabel>
      <FieldLabel label="Resolução (min)">
        <Input
          type="number"
          min={1}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="ex.: 240"
        />
      </FieldLabel>
      <div>
        <Button variant="primary" disabled={!dirty || upsert.isPending} onClick={() => void save()}>
          {upsert.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
