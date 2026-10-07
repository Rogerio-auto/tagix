import { cn } from '@/shared/lib/cn';

/**
 * Campo nativo (date/time/number/select) no visual do DS v2. Nativo de
 * propósito: teclado, leitor de tela e o seletor do celular vêm de graça.
 * `text-base` no celular evita o zoom automático do iOS (MOBILE_UX).
 */
export function fieldClass(invalid: boolean, extra?: string): string {
  return cn(
    'h-11 rounded-sm border bg-surface-inset px-3 text-base text-text outline-none sm:h-10 sm:text-sm',
    'transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
    'hover:border-border-2 focus-visible:border-border-2 focus-visible:shadow-glow-md',
    'disabled:cursor-not-allowed disabled:opacity-40',
    invalid ? 'border-danger' : 'border-border',
    extra,
  );
}
