'use client';

/**
 * Registro do service worker (F61-S01).
 *
 * ## Três decisões que definem este componente
 *
 * 1. **Registra depois do primeiro paint.** Um SW registrado durante o
 *    carregamento disputa banda com o próprio conteúdo que deveria acelerar. Em
 *    4G, isso deixa a primeira visita mais lenta para tornar a segunda mais
 *    rápida — troca ruim para quem abre o app uma vez por dia.
 *
 * 2. **Só em produção sob HTTPS.** Em dev o SW serviria build antigo do cache e
 *    transformaria "não atualizou" no bug mais confuso do projeto.
 *
 * 3. **Não força atualização.** Quando uma versão nova fica esperando, este
 *    componente não faz nada — a troca acontece na próxima navegação. Recarregar
 *    a tela de quem está no meio de uma resposta a cliente é pior que rodar a
 *    versão de ontem por mais dez minutos.
 *
 * Falha de registro é silenciosa de propósito: sem service worker o app funciona
 * exatamente como funcionava antes deste slot. É melhoria progressiva, não
 * dependência.
 */

import { useEffect } from 'react';

export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // SW exige contexto seguro. `localhost` conta como seguro, mas o guard de
    // produção acima já o exclui.
    if (!window.isSecureContext) return;

    let cancelado = false;

    const registrar = (): void => {
      if (cancelado) return;
      // `type: 'module'` porque `sw.js` importa `sw-strategy.js` — a regra de
      // cache mora separada justamente para ser testável. Onde o navegador não
      // suportar module workers, o registro rejeita e o app segue sem SW.
      void navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }).catch(() => {
        // Silêncio proposital: SW é melhoria progressiva.
      });
    };

    // `requestIdleCallback` quando existe (Safari ainda não tem em todas as
    // versões), senão um atraso curto depois do load.
    const idle = (
      window as Window & { requestIdleCallback?: (cb: () => void) => number }
    ).requestIdleCallback;

    if (document.readyState === 'complete') {
      if (idle) idle(registrar);
      else setTimeout(registrar, 1_000);
    } else {
      window.addEventListener(
        'load',
        () => {
          if (idle) idle(registrar);
          else setTimeout(registrar, 1_000);
        },
        { once: true },
      );
    }

    return () => {
      cancelado = true;
    };
  }, []);

  return null;
}
