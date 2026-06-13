'use client';

/**
 * Grafico de barras do custo LLM (F25-S08). Isolado num componente client para ser
 * carregado via lazy boundary (recharts e pesado — nao regredir bundle das demais
 * rotas). Cores via CSS vars do DS (zero hex).
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { UsageBucket } from '@/features/platform-admin/lib';

export default function UsageChart({ buckets }: { buckets: readonly UsageBucket[] }) {
  const data = buckets.map((b) => ({ label: b.label, cost: Number(b.costUsd.toFixed(2)) }));
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-text-low">
        Sem dados de uso no periodo.
      </div>
    );
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: 'var(--text-low)', fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text-low)', fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Custo']}
            contentStyle={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text)',
            }}
          />
          <Bar dataKey="cost" fill="var(--brand)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
