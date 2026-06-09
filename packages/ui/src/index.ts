/**
 * @hm/ui — Design System v2: primitives React + Tailwind preset.
 *
 * F0-S09 adiciona os 5 primitives base (Button, Input, Card, Modal, Toast) com
 * Ladle como catálogo. Aqui ficam apenas tipos de variantes até lá — os
 * componentes React entram com suas dependências (react, tailwind) no slot.
 */

import type { ThemeName } from '@hm/design-tokens';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

export interface PrimitiveBaseProps {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly theme?: ThemeName;
}

export const UI_PKG = '@hm/ui' as const;
