/**
 * @hm/ui — biblioteca de primitives React do Design System v2.
 * Consome tokens de @hm/design-tokens. Estilos: `import '@hm/ui/styles.css'`.
 */
import type { ButtonVariant, ButtonSize } from './Button/Button';

export { Button } from './Button/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button/Button';

export { Input } from './Input/Input';
export type { InputProps, InputSize } from './Input/Input';

export { Card, CardHeader, CardBody } from './Card/Card';
export type { CardProps, CardHeaderProps, CardElevation } from './Card/Card';

export { Modal } from './Modal/Modal';
export type { ModalProps } from './Modal/Modal';

export { ToastProvider, useToast } from './Toast/Toast';
export type { ToastOptions, ToastVariant, ToastPosition } from './Toast/Toast';

export { HelpHint, HelpPanel } from './HelpHint/HelpHint';
export type { HelpHintProps, HelpContent, HelpLink } from './HelpHint/HelpHint';

export { Markdown } from './Markdown/Markdown';
export type { MarkdownProps } from './Markdown/Markdown';
export { sanitizeUrl } from './Markdown/sanitize';

export { cn } from './lib/cn';

/** Aliases de compatibilidade (variante/size do Button são os contratos base). */
export type Variant = ButtonVariant;
export type Size = ButtonSize;

export const UI_PKG = '@hm/ui' as const;
