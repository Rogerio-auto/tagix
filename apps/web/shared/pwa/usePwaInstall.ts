'use client';

/**
 * Estado de instalação do app (F61-S05).
 *
 * A lógica de decisão mora em `install.ts` (pura, testada). Aqui fica só o que
 * precisa de browser: ouvir `beforeinstallprompt`, ler `localStorage` e reagir a
 * mudança de `display-mode` quando o usuário instala com a página aberta.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CHAVE_DISPENSA,
  decidePlatform,
  dispensaAtiva,
  isIOS,
  isStandalone,
  type InstallPlatform,
} from './install';

/** O evento do Chromium. Não está no lib.dom padrão, então é declarado aqui. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaInstall {
  /** Rodando como app instalado. */
  readonly standalone: boolean;
  /** Como convidar neste aparelho — `nenhum` significa não convidar. */
  readonly plataforma: InstallPlatform;
  /** Convite deve aparecer agora (considera standalone e dispensa). */
  readonly deveConvidar: boolean;
  /** Instala de verdade (só no Chromium). Devolve se o usuário aceitou. */
  readonly instalar: () => Promise<boolean>;
  /** Some por 14 dias. */
  readonly dispensar: () => void;
}

/**
 * Lê do browser os dois sinais de "está instalado".
 *
 * `navigator.standalone` é extensão da Apple e não existe no `lib.dom` — daí o
 * acesso indexado com narrowing, em vez de um cast que apagaria a checagem.
 * `matchMedia` em try/catch porque pode faltar em SSR/ambiente de teste; assumir
 * "não instalado" é o padrão seguro (no pior caso, um convite a mais).
 */
function lerSinaisStandalone(): { displayMode: boolean; navigatorStandalone: boolean } {
  let displayMode = false;
  try {
    displayMode = window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    displayMode = false;
  }
  const nav: Record<string, unknown> = window.navigator as unknown as Record<string, unknown>;
  return { displayMode, navigatorStandalone: nav['standalone'] === true };
}

/** Lê `localStorage` sem deixar aba privada derrubar a tela. */
function lerDispensa(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_DISPENSA);
  } catch {
    return null;
  }
}

export function usePwaInstall(): PwaInstall {
  const [standalone, setStandalone] = useState(false);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [dispensado, setDispensado] = useState(true); // pessimista até medir

  useEffect(() => {
    setStandalone(isStandalone(lerSinaisStandalone()));
    setIos(isIOS(window.navigator));
    setDispensado(dispensaAtiva(lerDispensa(), Date.now()));

    const onPrompt = (e: Event): void => {
      // Segurar o evento é o que permite oferecer o botão no NOSSO momento, em vez
      // do banner do navegador aparecendo por cima do conteúdo.
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      setStandalone(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Instalar com a página aberta muda o display-mode sem recarregar; sem isto o
    // convite continuaria na tela de quem acabou de instalar.
    const mq = window.matchMedia('(display-mode: standalone)');
    const onModo = (): void => setStandalone(isStandalone(lerSinaisStandalone()));
    mq.addEventListener('change', onModo);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      mq.removeEventListener('change', onModo);
    };
  }, []);

  const plataforma = decidePlatform({
    standalone,
    ios,
    temPromptNativo: promptEvent !== null,
  });

  const instalar = useCallback(async (): Promise<boolean> => {
    if (promptEvent === null) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      // O evento é de uso único: o navegador não o entrega de novo nesta sessão.
      setPromptEvent(null);
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }, [promptEvent]);

  const dispensar = useCallback((): void => {
    setDispensado(true);
    try {
      window.localStorage.setItem(CHAVE_DISPENSA, String(Date.now()));
    } catch {
      // Aba privada: a dispensa vale só para esta sessão. Melhor que quebrar.
    }
  }, []);

  return {
    standalone,
    plataforma,
    deveConvidar: plataforma !== 'nenhum' && !dispensado,
    instalar,
    dispensar,
  };
}
