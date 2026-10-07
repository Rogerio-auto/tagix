/**
 * Preset Tailwind 4 do DS 3.0 (DESIGN_SYSTEM §2.3, §3).
 *
 * Mapeia utilitários Tailwind (bg-*, text-*, border-*, font-*, rounded-*,
 * shadow-*) para as CSS variables de `tokens.css`. Consumido por
 * `apps/web/tailwind.config.ts` via `presets: [tailwindPreset]`.
 *
 * A escala tipográfica (`fontSize`) é derivada de `typography.ts` — fonte única
 * da escala editorial. Cada chave gera `text-<token>` (`text-h1…text-display`).
 *
 * Tipado estruturalmente (sem depender do pacote `tailwindcss` aqui) — o objeto
 * é compatível com `Partial<Config>` quando o app o consome.
 */

import { fontSizeScale } from './typography';
import type { FontSizeUtility } from './typography';

export interface TailwindPreset {
  readonly theme: {
    readonly extend: {
      readonly colors: Record<string, string | Record<string, string>>;
      readonly fontFamily: Record<string, string>;
      readonly fontSize: Record<string, FontSizeUtility>;
      readonly borderRadius: Record<string, string>;
      readonly boxShadow: Record<string, string>;
      readonly maxWidth: Record<string, string>;
      /** Curvas nomeadas (F59-S08). Movimento mostra estado, nao pede atencao. */
      readonly transitionTimingFunction: Record<string, string>;
      readonly transitionDuration: Record<string, string>;
    };
  };
}

export const tailwindPreset: TailwindPreset = {
  theme: {
    extend: {
      transitionTimingFunction: {
        DEFAULT: 'var(--ease)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
      colors: {
        brand: {
          DEFAULT: 'var(--brand)',
          strong: 'var(--brand-strong)',
          bright: 'var(--brand-bright)',
          soft: 'var(--brand-soft)',
          faint: 'var(--brand-faint)',
          /** texto/ícone de marca (≥4,5:1 nos dois temas); `brand` é fundo/acento */
          text: 'var(--brand-text)',
        },
        violet: 'var(--violet)',
        bg: 'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        'bg-elevated': 'var(--bg-elevated)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'surface-inset': 'var(--surface-inset)',
        'surface-glass': 'var(--surface-glass)',
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
        mono: 'var(--font-mono)',
      },
      // Escala tipográfica editorial (DESIGN_SYSTEM §3) — derivada de typography.ts.
      // Gera text-h1, text-h2, text-h3, text-h4, text-body, text-small,
      // text-price, text-display (cada uma seta size + line-height + tracking +
      // weight). Coexiste com text-sm/text-xs genéricos (migração gradual).
      fontSize: fontSizeScale,
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
        'elev-4': 'var(--elev-4)',
        'ds-1': 'var(--shadow-1)',
        'ds-2': 'var(--shadow-2)',
        'ds-3': 'var(--shadow-3)',
        glow: 'var(--glow)',
        'glow-sm': 'var(--glow-sm)',
        'glow-md': 'var(--glow-md)',
        'glow-lg': 'var(--glow-lg)',
        'glow-active': 'var(--glow-active)',
      },
      // Largura máxima do conteúdo centralizado (DESIGN_SYSTEM "Largura de conteúdo").
      // `content` é o default das páginas de fluxo; `content-narrow` para forms.
      // Telas full-bleed (livechat, kanban, flow canvas, calendar) não usam nenhum.
      maxWidth: {
        content: '1600px',
        'content-narrow': '900px',
      },
    },
  },
};

export default tailwindPreset;
