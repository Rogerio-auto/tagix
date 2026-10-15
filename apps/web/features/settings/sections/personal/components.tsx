'use client';

import type { ReactNode } from 'react';
import { Skeleton, Switch, type SwitchProps } from '@hm/ui';
import { cn } from '@/shared/lib/cn';

/**
 * Kit visual das seções de Configurações no DS 3.0 (F72-S07). Todas as seções (pessoais,
 * do workspace, dados e dev) montam a tela com estas peças, então o ritmo é um só:
 *
 *  - `Panel`: superfície com hairline (borda antes de sombra), cabeçalho opcional e rodapé
 *    de ação. `body="rows"` empilha `Row`s separadas por hairline; `body="form"` empilha
 *    campos com respiro.
 *  - `Row`: rótulo + apoio à esquerda, controle à direita (no celular o controle desce).
 *  - `FieldLabel`: rótulo acima do campo, no desenho do `Input` do `@hm/ui`.
 *  - `Toggle`: o `Switch` do `@hm/ui` com a API antiga (`checked`/`onChange`/`label`);
 *    repassa o resto das props ao botão, então `ReadOnlyGuard` funciona sobre ele.
 *  - `controlClass`/`selectClass`/`textareaClass`: controles nativos no desenho do `Input`.
 *  - `SectionLoading`: esqueleto no formato do painel (nunca "Carregando…" solto).
 *  - `SaveFooter`: estado das alterações + o botão de salvar (feedback imediato, UX §2.7).
 */

/** Rótulo de grupo em mono caixa-alta (ritmo editorial do DS 3.0). */
export const eyebrowClass = 'font-mono text-xs font-medium uppercase tracking-widest text-text-low';

/** Controle nativo (select/time) no mesmo desenho do `Input` do DS 3.0. 16px abaixo de `sm` (iOS). */
export const controlClass =
  'h-10 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 ' +
  'focus:border-brand-text focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40 sm:text-sm';

/** Alias histórico: as seções importam `selectClass`. */
export const selectClass = controlClass;

export const textareaClass =
  'w-full rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none ' +
  'placeholder:text-text-low transition-[border-color,box-shadow] duration-(--dur-base) ease-ds ' +
  'hover:border-border-2 focus:border-brand-text focus-visible:focus-ring disabled:opacity-40 sm:text-sm';

export type ToggleProps = Omit<SwitchProps, 'checked' | 'onCheckedChange' | 'onChange' | 'label'> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Nome acessível do interruptor (o rótulo visível fica na `Row`). */
  label: string;
};

/** Interruptor on/off (Switch do DS 3.0). */
export function Toggle({ checked, onChange, label, ...rest }: ToggleProps): React.JSX.Element {
  return <Switch {...rest} checked={checked} onCheckedChange={onChange} aria-label={label} />;
}

/** Linha de configuração: rótulo + apoio à esquerda, controle à direita. */
export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="font-body text-sm font-bold text-text">{title}</p>
        {description && <p className="mt-0.5 font-body text-sm text-text-low">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function FieldLabel({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5 font-body text-sm font-bold text-text-mid">
      {label}
      {children}
      {hint && <span className="font-normal text-text-low">{hint}</span>}
    </label>
  );
}

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Ação no canto do cabeçalho (ex.: "Nova chave"). */
  action?: ReactNode;
  /** `rows`: `Row`s separadas por hairline · `form`: campos empilhados · `flush`: sem respiro (listas). */
  body?: 'rows' | 'form' | 'flush';
  footer?: ReactNode;
  /** Painel de atenção (ex.: trava desligada): borda no tom de aviso. */
  tone?: 'default' | 'warn' | 'danger';
  className?: string;
  children?: ReactNode;
  'aria-labelledby'?: string;
}

const PANEL_TONE: Record<NonNullable<PanelProps['tone']>, string> = {
  default: 'border-border',
  warn: 'border-warn/40',
  danger: 'border-danger/40',
};

const PANEL_BODY: Record<NonNullable<PanelProps['body']>, string> = {
  rows: 'divide-y divide-border px-5',
  // Campos de formulário não esticam além de uma medida legível, mesmo com a seção larga.
  form: 'flex flex-col gap-5 px-5 py-5 [&>*]:max-w-2xl',
  flush: '',
};

/** Superfície de uma seção (hairline, sem sombra: repousa no fundo). */
export function Panel({
  title,
  description,
  action,
  body = 'form',
  footer,
  tone = 'default',
  className,
  children,
  ...aria
}: PanelProps): React.JSX.Element {
  const hasHeader = Boolean(title || description || action);
  return (
    <section
      {...aria}
      className={cn('min-w-0 rounded-lg border bg-surface transition-colors duration-(--dur-base)', PANEL_TONE[tone], className)}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <h3 className="font-head text-base font-semibold text-text">{title}</h3>}
            {description && <p className="mt-1 max-w-prose font-body text-sm text-text-low">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children != null && <div className={PANEL_BODY[body]}>{children}</div>}
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-3">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Estado das alterações (lido por leitor de tela) + o botão de salvar. */
export function SaveFooter({ dirty, children }: { dirty: boolean; children: ReactNode }): React.JSX.Element {
  return (
    <>
      <span aria-live="polite" className="mr-auto font-body text-sm text-text-low">
        {dirty ? 'Alterações não salvas' : ''}
      </span>
      {children}
    </>
  );
}

/** Esqueleto no formato de um painel com `rows` linhas (UX §2.7: sem salto na chegada). */
export function SectionLoading({ rows = 3, label = 'Carregando' }: { rows?: number; label?: string }): React.JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      </div>
      <div className="divide-y divide-border px-5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-6 py-4">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-10 rounded-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}
