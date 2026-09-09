'use client';

/**
 * Interruptor de avisos no aparelho (F61-S03).
 *
 * A decisão de o que mostrar mora em `push.ts` (pura, testada). Aqui fica o que
 * precisa de browser: falar com o `PushManager`, pedir permissão e sincronizar com
 * o servidor.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/shared/lib/api-client';
import { isIOS } from './install';
import { decidePushState, urlBase64ToUint8Array, type PushState } from './push';
import { usePwaInstall } from './usePwaInstall';

export interface PushNotifications {
  readonly estado: PushState;
  /** Em andamento: pedindo permissão ou falando com o servidor. */
  readonly ocupado: boolean;
  readonly ativar: () => Promise<void>;
  readonly desativar: () => Promise<void>;
}

/** Suporte real: as três peças precisam existir juntas. */
function suportado(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function usePushNotifications(): PushNotifications {
  const { standalone } = usePwaInstall();
  const [chave, setChave] = useState<string | null>(null);
  const [permissao, setPermissao] = useState<NotificationPermission | null>(null);
  const [assinado, setAssinado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [ios, setIos] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      if (!suportado()) {
        if (vivo) setPronto(true);
        return;
      }
      setIos(isIOS(window.navigator));
      setPermissao(Notification.permission);

      try {
        const { publicKey } = await api.get<{ publicKey: string | null }>('/api/push/public-key');
        if (vivo) setChave(publicKey);
      } catch {
        // Sem chave, o estado vira "indisponível" e o interruptor some. Melhor
        // não oferecer que oferecer e falhar.
      }

      try {
        const reg = await navigator.serviceWorker.ready;
        const atual = await reg.pushManager.getSubscription();
        if (vivo) setAssinado(atual !== null);
      } catch {
        if (vivo) setAssinado(false);
      }
      if (vivo) setPronto(true);
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const ativar = useCallback(async (): Promise<void> => {
    if (chave === null || ocupado) return;
    setOcupado(true);
    try {
      const permitido = await Notification.requestPermission();
      setPermissao(permitido);
      if (permitido !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      // `userVisibleOnly` é exigido por todos os navegadores: push silencioso
      // (rastreamento sem aviso ao usuário) não é permitido, e nem queremos.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(chave),
      });

      const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
      if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys['auth']) {
        // Assinatura incompleta: desfaz no navegador para não ficar um estado em
        // que o aparelho acha que assinou e o servidor não sabe dele.
        await sub.unsubscribe().catch(() => undefined);
        return;
      }

      await api.post('/api/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys['p256dh'], auth: json.keys['auth'] },
      });
      setAssinado(true);
    } catch {
      setAssinado(false);
    } finally {
      setOcupado(false);
    }
  }, [chave, ocupado]);

  const desativar = useCallback(async (): Promise<void> => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub !== null) {
        // Avisa o servidor ANTES de cancelar no navegador: se a ordem fosse a
        // inversa e a rede falhasse, o servidor continuaria mandando push para um
        // endpoint que o usuário achou que tinha desligado.
        await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setAssinado(false);
    } finally {
      setOcupado(false);
    }
  }, [ocupado]);

  const estado: PushState = pronto
    ? decidePushState({
        suportado: suportado(),
        temChavePublica: chave !== null,
        permissao,
        jaAssinado: assinado,
        standalone,
        ios,
      })
    : 'indisponivel';

  return { estado, ocupado, ativar, desativar };
}
