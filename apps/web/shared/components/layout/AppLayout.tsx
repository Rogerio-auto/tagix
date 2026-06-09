'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from '@/shared/components/command';
import { useUIStore } from '@/shared/stores/ui.store';

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const hydrate = useUIStore((s) => s.hydrate);

  // Restaura a preferência de density persistida.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="flex min-h-dvh bg-bg">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
      {/* Paleta de comandos global (⌘/Ctrl+K) — montada uma vez aqui. */}
      <CommandPalette />
    </div>
  );
}
