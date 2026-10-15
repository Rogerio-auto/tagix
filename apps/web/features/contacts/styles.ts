/**
 * Classe dos controles nativos (select/textarea) da feature, no mesmo desenho do
 * `Input` do `@hm/ui` (DS 3.0): `surface-2`, hairline `border`, foco com anel de marca.
 * 16px abaixo de `sm` (iOS não dá zoom ao focar).
 */
export const controlClass =
  'h-10 rounded-sm border border-border bg-surface-2 px-3 font-body text-base text-text outline-none ' +
  'transition-[border-color,box-shadow] duration-(--dur-base) ease-ds hover:border-border-2 ' +
  'focus:border-brand-text focus-visible:focus-ring sm:text-sm';

export const textareaClass =
  'w-full rounded-sm border border-border bg-surface-2 px-3 py-2 font-body text-base text-text outline-none ' +
  'placeholder:text-text-low transition-[border-color,box-shadow] duration-(--dur-base) ease-ds ' +
  'hover:border-border-2 focus:border-brand-text focus-visible:focus-ring sm:text-sm';

/** Rótulo de seção em mono caixa-alta (ritmo editorial do DS 3.0). */
export const eyebrowClass = 'font-mono text-xs font-medium uppercase tracking-widest text-text-low';
