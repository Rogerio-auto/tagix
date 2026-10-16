'use client';

import { Switch } from '@hm/ui';

/**
 * Interruptor on/off do painel (modelos, políticas): o `Switch` do DS 3.0 com a API
 * antiga (`checked`/`onChange`/`label`), para os consumidores não mudarem (F72-S08).
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  loading,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}) {
  return (
    <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} loading={loading} aria-label={label} />
  );
}
