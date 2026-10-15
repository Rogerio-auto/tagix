'use client';

/**
 * Seção /settings/dashboard (F8-S04, DASHBOARD §7), no DS 3.0 (F72-S07). ADMIN define:
 *  - cards obrigatórios por papel (o membro não pode escondê-los);
 *  - limites de SLA/alerta que alimentam os alertas do dashboard.
 *
 * Configuração do WORKSPACE (`PUT /api/dashboard/config`): com a empresa em só leitura os
 * dois "Salvar" ficam `aria-disabled` com a explicação (F71-S17).
 */
import { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Button, EmptyState, Input, useToast } from '@hm/ui';
import { ROLES } from '@hm/shared';
import { ReadOnlyGuard } from '@/shared/components/account-banner';
import { roleLabel } from '@/features/invites/types';
import { FieldLabel, Panel, Row, SectionLoading, Toggle, selectClass } from '../personal/components';
import { useDashboardConfig, useUpdateDashboardConfig } from '@/features/dashboard/customization';

export default function DashboardSettingsSection(): React.JSX.Element {
  const { toast } = useToast();
  const configQuery = useDashboardConfig(true);
  const update = useUpdateDashboardConfig();

  const [role, setRole] = useState<string>('AGENT');
  const [required, setRequired] = useState<Record<string, Set<string>>>({});
  const [slaCount, setSlaCount] = useState('');
  const [llmCost, setLlmCost] = useState('');
  const [saving, setSaving] = useState<'required' | 'limits' | null>(null);

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
    setSaving('required');
    try {
      const requiredByRole: Record<string, string[]> = {};
      for (const r of ROLES) requiredByRole[r] = [...(required[r] ?? [])];
      await update.mutateAsync({ requiredByRole });
      toast({ variant: 'success', title: 'Cards obrigatórios salvos.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    } finally {
      setSaving(null);
    }
  };

  const saveLimits = async () => {
    setSaving('limits');
    try {
      const sla = slaCount.trim() === '' ? null : Math.max(0, Math.round(Number(slaCount)));
      const cost = llmCost.trim() === '' ? null : Math.max(0, Number(llmCost));
      await update.mutateAsync({
        alertLimits: { slaViolationCount: sla, llmCostUsdDaily: cost },
      });
      toast({ variant: 'success', title: 'Limites salvos.' });
    } catch (err) {
      toast({ variant: 'error', title: err instanceof Error ? err.message : 'Falha ao salvar.' });
    } finally {
      setSaving(null);
    }
  };

  if (configQuery.isLoading) return <SectionLoading label="Carregando dashboard" />;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Cards obrigatórios por papel"
        description="Cards marcados não podem ser escondidos pelos membros desse papel."
        body="flush"
        action={
          <label className="flex items-center gap-2 font-body text-sm font-bold text-text-mid">
            Papel
            <select value={role} onChange={(e) => setRole(e.target.value)} className={selectClass}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
          </label>
        }
        footer={
          <ReadOnlyGuard>
            <Button
              variant="secondary"
              disabled={update.isPending && saving !== 'required'}
              loading={saving === 'required'}
              onClick={() => void saveRequired()}
            >
              Salvar obrigatórios
            </Button>
          </ReadOnlyGuard>
        }
      >
        {cardsForRole.length === 0 ? (
          <EmptyState
            className="py-8"
            icon={LayoutDashboard}
            title="Nenhum card configurável"
            description={`O papel ${roleLabel(role)} não vê cards configuráveis no dashboard.`}
          />
        ) : (
          <div className="divide-y divide-border px-5">
            {cardsForRole.map((key) => (
              <Row key={key} title={key}>
                <Toggle
                  checked={(required[role] ?? new Set<string>()).has(key)}
                  onChange={() => toggle(key)}
                  label={`Card ${key} obrigatório para ${roleLabel(role)}`}
                />
              </Row>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Limites de alerta"
        description="Alimentam os alertas exibidos no topo do dashboard. Vazio = sem alerta."
        footer={
          <ReadOnlyGuard>
            <Button
              variant="primary"
              disabled={update.isPending && saving !== 'limits'}
              loading={saving === 'limits'}
              onClick={() => void saveLimits()}
            >
              Salvar limites
            </Button>
          </ReadOnlyGuard>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FieldLabel label="Violações de SLA para alertar">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              className="font-mono tabular-nums"
              value={slaCount}
              onChange={(e) => setSlaCount(e.target.value)}
              placeholder="ex.: 5"
            />
          </FieldLabel>
          <FieldLabel label="Custo de IA diário (USD)">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="font-mono tabular-nums"
              value={llmCost}
              onChange={(e) => setLlmCost(e.target.value)}
              placeholder="ex.: 50"
            />
          </FieldLabel>
        </div>
      </Panel>
    </div>
  );
}
