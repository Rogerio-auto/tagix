'use client';

/**
 * Seção /settings/dashboard (F8-S04, DASHBOARD §7). ADMIN define:
 *  - cards obrigatórios por role (member não pode escondê-los);
 *  - limites de SLA/alerta que alimentam os alertas do dashboard.
 */
import { useEffect, useState } from 'react';
import { Button, Input, useToast } from '@hm/ui';
import { ROLES } from '@hm/shared';
import { FieldLabel, selectClass } from '../personal/components';
import {
  useDashboardConfig,
  useUpdateDashboardConfig,
} from '@/features/dashboard/customization';

export default function DashboardSettingsSection(): React.JSX.Element {
  const { toast } = useToast();
  const configQuery = useDashboardConfig(true);
  const update = useUpdateDashboardConfig();

  const [role, setRole] = useState<string>('AGENT');
  const [required, setRequired] = useState<Record<string, Set<string>>>({});
  const [slaCount, setSlaCount] = useState('');
  const [llmCost, setLlmCost] = useState('');

  useEffect(() => {
    const cfg = configQuery.data?.config;
    if (!cfg) return;
    const map: Record<string, Set<string>> = {};
    for (const r of ROLES) map[r] = new Set(cfg.requiredByRole[r] ?? []);
    setRequired(map);
    setSlaCount(cfg.alertLimits.slaViolationCount == null ? '' : String(cfg.alertLimits.slaViolationCount));
    setLlmCost(cfg.alertLimits.llmCostUsdDaily == null ? '' : String(cfg.alertLimits.llmCostUsdDaily));
  }, [configQuery.data]);

  const catalog = configQuery.data?.catalog ?? {};
  const cardsForRole = catalog[role] ?? [];

  const toggle = (key: string) => {
    setRequired((prev) => {
      const next = { ...prev };
      const set = new Set(next[role] ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[role] = set;
      return next;
    });
  };

  const saveRequired = async () => {
    try {
      const requiredByRole: Record<string, string[]> = {};
      for (const r of ROLES) requiredByRole[r] = [...(required[r] ?? [])];
      await update.mutateAsync({ requiredByRole });
      toast({ variant: 'success', title: 'Cards obrigatórios salvos.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  const saveLimits = async () => {
    try {
      const sla = slaCount.trim() === '' ? null : Math.max(0, Math.round(Number(slaCount)));
      const cost = llmCost.trim() === '' ? null : Math.max(0, Number(llmCost));
      await update.mutateAsync({
        alertLimits: { slaViolationCount: sla, llmCostUsdDaily: cost },
      });
      toast({ variant: 'success', title: 'Limites salvos.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    }
  };

  if (configQuery.isLoading) return <p className="text-sm text-text-low">Carregando…</p>;

  return (
    <div className="flex max-w-lg flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium text-text">Cards obrigatórios por papel</h3>
          <p className="text-xs text-text-low">
            Cards marcados não podem ser escondidos pelos membros desse papel.
          </p>
        </div>
        <FieldLabel label="Papel">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FieldLabel>
        <ul className="flex flex-col gap-1">
          {cardsForRole.length === 0 && (
            <li className="text-sm text-text-low">Este papel não vê cards configuráveis.</li>
          )}
          {cardsForRole.map((key) => (
            <li key={key} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <input
                type="checkbox"
                id={`req-${key}`}
                checked={(required[role] ?? new Set()).has(key)}
                onChange={() => toggle(key)}
                className="accent-brand"
              />
              <label htmlFor={`req-${key}`} className="flex-1 text-sm text-text">
                {key}
              </label>
            </li>
          ))}
        </ul>
        <div>
          <Button variant="primary" disabled={update.isPending} onClick={() => void saveRequired()}>
            Salvar obrigatórios
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium text-text">Limites de alerta</h3>
          <p className="text-xs text-text-low">
            Alimentam os alertas exibidos no topo do dashboard.
          </p>
        </div>
        <FieldLabel label="SLA: nº de violações para alertar">
          <Input type="number" min={0} value={slaCount} onChange={(e) => setSlaCount(e.target.value)} placeholder="ex.: 5" />
        </FieldLabel>
        <FieldLabel label="Custo de IA diário (USD) para alertar">
          <Input type="number" min={0} step="0.01" value={llmCost} onChange={(e) => setLlmCost(e.target.value)} placeholder="ex.: 50" />
        </FieldLabel>
        <div>
          <Button variant="primary" disabled={update.isPending} onClick={() => void saveLimits()}>
            Salvar limites
          </Button>
        </div>
      </section>
    </div>
  );
}
