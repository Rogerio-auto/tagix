'use client';

/**
 * Faixa de KPIs da Home: o resultado vem antes de tudo (DS3_ADOCAO, "Overview" da
 * maquete). Uma peça só, de hairline a hairline, em vez de quatro cartões soltos: o
 * olho lê "resultado", não "painel". Número em mono, delta honesto, e cada célula é
 * um link para onde o número nasce (ação primária = clique no corpo, UX §2.1).
 *
 * A grade responde pela largura do PRÓPRIO bloco (container query), não da janela: com
 * a sidebar aberta ou fechada o número nunca estoura a célula.
 *
 * Linha de base: cada célula é um `subgrid` de três trilhas (rótulo, número, rodapé)
 * que herda as linhas da grade-mãe. Células da mesma faixa visual dividem as mesmas
 * trilhas, então um rodapé de duas linhas (a amostra do speed-to-lead) aumenta a
 * trilha de rodapé de todas, em vez de empurrar só o próprio número para cima.
 *
 * Na trilha do número, o alinhamento é `last baseline` (os itens de subgrids irmãos
 * dividem o grupo de linha de base da grade-mãe), não `end`: a manchete tem corpo
 * maior que as outras, e alinhar o FUNDO das caixas deixa as linhas de base a
 * (entrelinha − altura da fonte)/2 + descendente de distância, que muda com o corpo e
 * com a métrica da fonte (1px na Plex Mono, 2px na Liberation Mono do Linux).
 */
import type * as React from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import {
  formatKpiValue,
  kpiDelta,
  KPI_CAPTION,
  KPI_LABEL,
  sampleText,
  type KpiDelta,
} from './home-format';
import type { HomeKpi, HomeScope } from './types';

const COUNT_UP_MS = 700;

/**
 * Conta de zero até o valor, uma vez, na primeira carga. Número chegando é a prova de
 * que o dado é vivo. Sem animação sob `prefers-reduced-motion`, e nunca em cima de
 * atualização (realtime): só o primeiro valor anima.
 */
function useCountUp(target: number | null, enabled: boolean): number | null {
  const [value, setValue] = useState<number | null>(target);
  const played = useRef(false);

  useLayoutEffect(() => {
    if (target === null || !enabled) {
      setValue(target);
      return;
    }
    if (played.current) {
      setValue(target);
      return;
    }
    played.current = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    setValue(0);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);

  return value;
}

const TONE_CLASS: Record<KpiDelta['tone'], string> = {
  good: 'text-success',
  bad: 'text-danger',
  neutral: 'text-text-low',
};

/**
 * Sem delta, a linha não diz "sem comparação" (soaria como defeito): explica o número.
 * Receita e conversões desconhecidas (sem tipo de conversão) dizem o porquê do "—".
 */
function noDeltaText(kpi: HomeKpi): string {
  if (kpi.value === null && (kpi.key === 'revenue' || kpi.key === 'conversions')) {
    return 'Defina o que conta como conversão';
  }
  if (kpi.value === null) return 'Sem dado no período';
  return KPI_CAPTION[kpi.key];
}

/**
 * Sufixos que saem da vista em célula estreita (celular): a seta e o tom já dizem o
 * sentido, e o cabeçalho diz contra qual janela se compara. O leitor de tela ouve a
 * frase inteira; o número não quebra em duas linhas.
 */
const NARROW_SUFFIXES = [' vs. anterior', ' mais rápido', ' mais lento'] as const;

function splitDelta(text: string): { head: string; suffix: string } {
  const suffix = NARROW_SUFFIXES.find((s) => text.endsWith(s)) ?? '';
  return { head: suffix ? text.slice(0, -suffix.length) : text, suffix };
}

function DeltaLine({ delta }: { delta: KpiDelta }): React.JSX.Element {
  const Icon =
    delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus;
  const { head, suffix } = splitDelta(delta.text);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs',
        TONE_CLASS[delta.tone],
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>
        {head}
        {suffix && <span className="sr-only @2xl:not-sr-only">{suffix}</span>}
      </span>
    </span>
  );
}

/**
 * Abaixo de `@3xl` (largura do bloco) a manchete ocupa a linha de cima inteira e as
 * outras três dividem uma linha só: o resultado cabe em meia tela de celular e a lista
 * de atenção começa na primeira dobra. A partir de `@3xl` é uma linha só, na ordem do
 * servidor. A ordem visual é a do DOM (sem `order`), então o Tab segue o que o olho lê.
 */
type KpiSpan = 'lead' | 'cell';

function Kpi({ kpi, span }: { kpi: HomeKpi; span: KpiSpan }): React.JSX.Element {
  const lead = span === 'lead';
  const animated = useCountUp(kpi.value, kpi.unit !== 'seconds');
  const final = formatKpiValue(kpi);
  const shown = formatKpiValue({ unit: kpi.unit, value: animated });
  const delta = kpiDelta(kpi);
  const hasDelta = delta.direction !== 'none';
  const sample = sampleText(kpi.sample);

  return (
    <Link
      href={kpi.href}
      data-kpi={kpi.key}
      className={cn(
        // Três trilhas herdadas da grade-mãe: rótulo · número · rodapé.
        'group row-span-3 grid min-w-0 grid-rows-subgrid bg-surface p-3 -outline-offset-2',
        'hover:bg-surface-2 focus-visible:focus-ring motion-safe:transition-colors @3xl:p-6',
        lead && 'col-span-3 @3xl:col-span-1',
      )}
    >
      <span className="block pb-3 @3xl:pb-4">
        <span className="block font-mono text-xs font-medium uppercase leading-snug tracking-wider text-text-low @2xl:tracking-widest">
          {KPI_LABEL[kpi.key]}
        </span>
        {hasDelta && (
          <span className="mt-0.5 hidden font-body text-xs text-text-low @2xl:block">
            {KPI_CAPTION[kpi.key]}
          </span>
        )}
      </span>
      <span
        data-kpi-value
        className={cn(
          // `last baseline`: os números da faixa assentam na mesma linha de base (o
          // fallback do grupo é `end`, então continuam no pé da trilha).
          'block self-baseline-last truncate font-mono font-medium tabular-nums tracking-tight text-text',
          lead ? 'text-h3 @5xl:text-h2' : 'text-h4 @3xl:text-h3',
        )}
      >
        <span aria-hidden>{shown}</span>
        <span className="sr-only">{final}</span>
      </span>
      <span className="flex flex-col gap-1 pt-2 @3xl:pt-4">
        {hasDelta ? (
          <DeltaLine delta={delta} />
        ) : (
          <span className="font-body text-xs text-text-low">{noDeltaText(kpi)}</span>
        )}
        {sample !== null && (
          // A base da mediana sai da vista em célula estreita; fica para o leitor de
          // tela e volta a partir de `@2xl`.
          <span
            className="sr-only font-body text-xs text-text-low @2xl:not-sr-only"
            data-kpi-sample
          >
            {sample}
          </span>
        )}
      </span>
    </Link>
  );
}

function spanOf(scope: HomeScope, index: number): KpiSpan {
  return scope === 'workspace' && index === 0 ? 'lead' : 'cell';
}

export function KpiStrip({
  kpis,
  scope,
  pending = false,
}: {
  kpis: readonly HomeKpi[];
  scope: HomeScope;
  /** Trocando de janela: os números anteriores ficam, esmaecidos, até os novos chegarem. */
  pending?: boolean;
}): React.JSX.Element {
  return (
    <section
      aria-label="Resultado do período"
      aria-busy={pending || undefined}
      className={cn('@container motion-safe:transition-opacity', pending && 'opacity-60')}
    >
      <div
        className={cn(
          // `gap-px` sobre `bg-border` desenha a hairline entre células sem borda dupla.
          // As linhas são implícitas (`auto`): cada célula ocupa três, e as células de
          // uma mesma faixa compartilham as mesmas três.
          'grid gap-px overflow-hidden rounded-lg border border-border bg-border',
          scope === 'workspace'
            ? 'grid-cols-3 @3xl:grid-cols-[1.35fr_1fr_1fr_1fr]'
            : 'grid-cols-2 @3xl:grid-cols-4',
        )}
      >
        {kpis.map((kpi, i) => (
          <Kpi key={kpi.key} kpi={kpi} span={spanOf(scope, i)} />
        ))}
      </div>
    </section>
  );
}
