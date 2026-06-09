/**
 * Preset Tailwind 4 do DS v2 (DESIGN_SYSTEM §2.3).
 *
 * Mapeia utilitários Tailwind (bg-*, text-*, border-*, font-*, rounded-*,
 * shadow-*) para as CSS variables de `tokens.css`. Consumido por
 * `apps/web/tailwind.config.ts` via `presets: [tailwindPreset]`.
 *
 * Tipado estruturalmente (sem depender do pacote `tailwindcss` aqui) — o objeto
 * é compatível com `Partial<Config>` quando o app o consome.
 */

export interface TailwindPreset {
  readonly theme: {
    readonly extend: {
      readonly colors: Record<string, string | Record<string, string>>;
      readonly fontFamily: Record<string, string>;
      readonly borderRadius: Record<string, string>;
      readonly boxShadow: Record<string, string>;
    };
  };
}

export const tailwindPreset: TailwindPreset = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          strong: 'var(--brand-strong)',
          bright: 'var(--brand-bright)',
          soft: 'var(--brand-soft)',
          faint: 'var(--brand-faint)',
        },
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-inset': 'var(--surface-inset)',
        text: 'var(--text)',
        'text-mid': 'var(--text-mid)',
        'text-low': 'var(--text-low)',
        'text-on-brand': 'var(--text-on-brand)',
        border: 'var(--border)',
        'border-2': 'var(--border-2)',
        'border-brand': 'var(--border-brand)',
        danger: 'var(--danger)',
        warn: 'var(--warn)',
        info: 'var(--info)',
        success: 'var(--success)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        price: 'var(--font-price)',
        head: 'var(--font-head)',
        body: 'var(--font-body)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
        'elev-4': 'var(--elev-4)',
        'glow-sm': 'var(--glow-sm)',
        'glow-md': 'var(--glow-md)',
        'glow-lg': 'var(--glow-lg)',
      },
    },
  },
};

export default tailwindPreset;
