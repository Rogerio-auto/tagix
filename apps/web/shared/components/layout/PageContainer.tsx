import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Largura do conteúdo (DESIGN_SYSTEM "Largura de conteúdo").
 *
 * - `default`  → centra e limita em `max-w-content` (1600px). Padrão de toda página
 *                de fluxo (listas, detalhe, dashboard, settings).
 * - `narrow`   → `max-w-content-narrow` (900px), para formulários/leitura focada.
 * - `full`     → no-op de largura (edge-to-edge), para telas full-bleed: livechat
 *                3-col, pipeline kanban, flow canvas, calendar.
 *
 * O gutter lateral (`px-*`) vive no `<main>` do AppLayout; aqui só limitamos e
 * centramos o fluxo. Server-component-safe (sem estado/efeito, sem 'use client').
 */
export type PageContainerVariant = 'default' | 'narrow' | 'full';

export interface PageContainerProps {
  children: ReactNode;
  variant?: PageContainerVariant;
  className?: string;
}

const VARIANT_CLASS: Record<PageContainerVariant, string> = {
  default: 'mx-auto w-full max-w-content',
  narrow: 'mx-auto w-full max-w-content-narrow',
  // Full-bleed: sem max-width nem centragem — a tela ocupa toda a área disponível.
  full: 'w-full',
};

export function PageContainer({
  children,
  variant = 'default',
  className,
}: PageContainerProps): React.JSX.Element {
  return <div className={cn(VARIANT_CLASS[variant], className)}>{children}</div>;
}
