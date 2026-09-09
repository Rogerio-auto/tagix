'use client';

/**
 * Convite para instalar o app (F61-S05).
 *
 * ## Onde aparece, e por quê aqui
 *
 * Na tela **Hoje**, não no app inteiro. Quem instala é o dono que abre o celular
 * entre uma tarefa e outra; pedir instalação numa tela de configuração no desktop
 * é pedir na hora errada, para a pessoa errada.
 *
 * ## Duas formas, porque são dois mundos
 *
 * No Chromium existe `beforeinstallprompt` e o botão instala de verdade. No iOS
 * não existe API nenhuma — o único caminho é Compartilhar → Adicionar à Tela de
 * Início, à mão. Então lá o convite **ensina**, com o ícone real e o número de
 * toques certo. Um botão "Instalar" que abre um texto explicativo seria pior que
 * nenhum botão: promete uma ação e entrega uma aula.
 *
 * ## O que o texto NÃO diz
 *
 * "PWA", "manifest", "service worker", "adicionar aos favoritos". O dono de uma
 * empresa de reforma não usa nenhuma dessas palavras. Ele quer saber o que ganha:
 * abrir direto e ser avisado quando entrar lead.
 */

import type * as React from 'react';
import { Share, SquarePlus, X } from 'lucide-react';
import { usePwaInstall } from './usePwaInstall';

/**
 * Um passo das instruções do iOS. O ícone importa: o usuário procura o desenho na
 * barra do Safari, não a palavra.
 */
function Passo({
  numero,
  children,
  icone: Icone,
}: {
  numero: number;
  children: React.ReactNode;
  icone?: typeof Share;
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text">
        {numero}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-small text-text-2">
        {children}
        {Icone !== undefined && (
          <Icone className="size-4 shrink-0 text-brand" aria-hidden="true" />
        )}
      </span>
    </li>
  );
}

export function InstallPrompt(): React.JSX.Element | null {
  const { deveConvidar, plataforma, instalar, dispensar } = usePwaInstall();

  if (!deveConvidar) return null;

  return (
    <section
      aria-labelledby="instalar-titulo"
      className="relative rounded-md border border-brand/30 bg-surface p-4"
    >
      <button
        type="button"
        onClick={dispensar}
        aria-label="Agora não"
        className="touch-target absolute right-1 top-1 flex size-11 items-center justify-center rounded-md text-text-3 active:bg-surface-2"
      >
        <X className="size-4" aria-hidden="true" />
      </button>

      <h2 id="instalar-titulo" className="pr-10 font-head text-h3 text-text">
        Deixe o Leadium na tela do seu celular
      </h2>
      <p className="mt-1 text-small text-text-2">
        Abre direto, sem passar pelo navegador — e é o que permite avisar você quando entrar um
        lead novo.
      </p>

      {plataforma === 'prompt' ? (
        <button
          type="button"
          onClick={() => void instalar()}
          className="touch-target mt-4 w-full rounded-md bg-brand py-3 font-semibold text-text-on-brand active:opacity-90"
        >
          Instalar
        </button>
      ) : (
        <ol className="mt-4 space-y-2.5">
          <Passo numero={1} icone={Share}>
            Toque no botão de compartilhar, na barra de baixo
          </Passo>
          <Passo numero={2} icone={SquarePlus}>
            Escolha &quot;Adicionar à Tela de Início&quot;
          </Passo>
          <Passo numero={3}>Confirme em &quot;Adicionar&quot;, no canto superior</Passo>
        </ol>
      )}
    </section>
  );
}
