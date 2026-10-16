'use client';

/**
 * Gráfico de barras do custo LLM (F25-S08) no DS 3.0 (F72-S08). Isolado num componente
 * client carregado via lazy boundary (recharts é pesado — não regredir o bundle das
 * demais rotas). Cores só por CSS var do DS (zero hex).
 *
 * Barras na marca de TEXTO (`--brand-text`, legível nos dois temas) a 40%: o gráfico não
 * compete com o CTA da tela. A barra sob o cursor (ou foco de teclado) vai a 100%.
 * Eixos e tooltip em mono tabular; valores pelo `shared/lib/locale`.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { UsageBucket } from '@/features/platform-admin/lib';
import { usd } from '../lib/labels';

const TICK = { fill: 'var(--text-low)', fontSize: 11, fontFamily: 'var(--font-mono)' } as const;

export default function UsageChart({ buckets }: { buckets: readonly UsageBucket[] }) {
  const data = buckets.map((b) => ({ label: b.label, cost: Number(b.costUsd.toFixed(2)) }));
  if (data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="size-5 text-text-low" aria-hidden />
        <p className="font-body text-sm text-text-low">Sem uso no período.</p>
      </div>
    );
  }
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={64}
            tickFormatter={(v: number) => usd(v, 0)}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            formatter={(v) => [usd(Number(v)), 'Custo']}
            labelStyle={{ color: 'var(--text-mid)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            itemStyle={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--border-2)',
              borderRadius: 10,
              boxShadow: 'var(--shadow-2)',
            }}
          />
          <Bar
            dataKey="cost"
            fill="var(--brand-text)"
            fillOpacity={0.4}
            activeBar={{ fillOpacity: 1 }}
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
