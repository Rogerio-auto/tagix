'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@hm/ui';
import { makeQueryClient } from '@/shared/lib/query-client';
import { useThemeStore } from '@/shared/stores/theme.store';
import { SocketProvider } from '@/shared/realtime';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const hydrate = useThemeStore((s) => s.hydrate);

  // Sincroniza o store com o data-theme já aplicado pelo script anti-flash.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SocketProvider>{children}</SocketProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
