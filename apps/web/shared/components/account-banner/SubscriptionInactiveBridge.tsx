'use client';

import { useEffect } from 'react';
import { useToast } from '@hm/ui';
import { setSubscriptionInactiveListener } from '@/shared/lib/api-client';
import { useAuthStore } from '@/shared/stores/auth.store';
import { createSubscriptionInactiveHandler } from './subscription-inactive';

/**
 * Liga o handler central de `402 subscription_inactive` ao toast. Montado uma vez
 * no shell; sem UI. Cria o handler (e seu "já avisei") por montagem = por sessão
 * de tela, e o remove ao sair.
 */
export function SubscriptionInactiveBridge() {
  const { toast } = useToast();

  useEffect(() => {
    const handle = createSubscriptionInactiveHandler({
      toast,
      markInactive: () => useAuthStore.getState().markSubscriptionInactive(),
      scopeKey: () => useAuthStore.getState().workspace?.id ?? 'unknown',
    });
    setSubscriptionInactiveListener(handle);
    return () => setSubscriptionInactiveListener(null);
  }, [toast]);

  return null;
}
