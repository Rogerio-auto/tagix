'use client';

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@hm/ui';
import { CustomizeDashboardDrawer } from './CustomizeDashboardDrawer';

/** Botão "Personalizar" — abre o drawer de customização. Montável no header do
 *  dashboard (gap-fill do orchestrator no DashboardClient). */
export function CustomizeDashboardButton(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" />
        Personalizar
      </Button>
      <CustomizeDashboardDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
