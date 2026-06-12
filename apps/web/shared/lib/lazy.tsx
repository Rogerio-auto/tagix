'use client';

import dynamic from 'next/dynamic';
import type { ComponentType, ReactNode } from 'react';

/**
 * Helpers de code-splitting (`next/dynamic`) para boundaries de lazy-load das libs
 * pesadas do app (@xyflow/react ~flow editor, recharts ~charts, @fullcalendar ~agenda,
 * @dnd-kit ~drag-and-drop). Tirar essas libs do bundle de First Load das rotas que
 * NÃO as usam reduz o JS inicial e melhora o Lighthouse Performance/TBT.
 *
 * Regra de UX §3.6: TODO boundary lazy renderiza um skeleton (`loading`), nunca tela
 * branca. Por isso `loading` é OBRIGATÓRIO na assinatura — não há default vazio.
 *
 * Estes helpers vivem em `shared/` (boundary permitida). Os componentes pesados moram
 * em `features/**` (boundary read-only): o swap real é um follow-up documentado em
 * `docs/performance/REPORT.md`. Quem montar um widget pesado a partir de `shared/`
 * deve usar `lazyClient` com o skeleton apropriado.
 */

type LoaderFn<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;

interface LazyOptions {
  /** Skeleton exibido enquanto o chunk carrega (UX §3.6 — nunca tela branca). */
  loading: () => ReactNode;
  /**
   * SSR do componente. Libs client-only (canvas WebGL/SVG interativo, calendário com
   * medição de DOM) devem usar `ssr: false` para não pagar custo de hidratação dupla
   * nem quebrar no server. Default `false` — o caso comum aqui é widget client-only.
   */
  ssr?: boolean;
}

/**
 * Cria um boundary lazy (client-side) para um componente pesado, preservando o tipo
 * das props. Use para libs que só fazem sentido no cliente (flow canvas, charts,
 * calendar, dnd). O `loading` é obrigatório (skeleton, não tela branca).
 *
 * @example
 *   const LazyFlowCanvas = lazyClient(
 *     () => import('@/features/flow-builder/canvas/FlowCanvas').then((m) => m.FlowCanvas),
 *     { loading: () => <CanvasSkeleton /> },
 *   );
 */
export function lazyClient<P extends object>(
  loader: LoaderFn<P>,
  options: LazyOptions,
): ComponentType<P> {
  // `next/dynamic` exige as options como OBJETO LITERAL na própria call site: o
  // transform SWC `next-dynamic` precisa detectar `ssr: false` estaticamente, então
  // NÃO se pode extrair para uma variável (gera "options must be an object literal").
  // Como todos os usos aqui são libs client-only, `ssr` é sempre `false`; por isso
  // este helper só é válido dentro de Client Components ('use client'). O loader
  // normaliza para `{ default }` para satisfazer a tipagem sem `any`.
  return dynamic<P>(
    async () => {
      const mod = await loader();
      return 'default' in mod ? mod : { default: mod };
    },
    { ssr: false, loading: () => <>{options.loading()}</> },
  );
}
