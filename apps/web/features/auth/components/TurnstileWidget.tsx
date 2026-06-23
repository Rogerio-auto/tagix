'use client';

import { useEffect, useRef } from 'react';

/**
 * Widget Cloudflare Turnstile via render explícito (sem dependência npm).
 * O script é carregado do domínio oficial da Cloudflare — já liberado no CSP
 * (F44-S03: script-src/frame-src challenges.cloudflare.com). Nenhum segredo no
 * cliente: só a SITE KEY pública (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
 *
 * Em dev sem site key, renderiza um placeholder e emite um token fake — o backend
 * em dev (sem TURNSTILE_SECRET_KEY) já faz bypass permissivo explícito.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      theme?: 'dark' | 'light' | 'auto';
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if (window.turnstile) return resolve();
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('turnstile_script_error')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('turnstile_script_error'));
    document.head.appendChild(script);
  });
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const siteKey = process.env['NEXT_PUBLIC_TURNSTILE_SITE_KEY'];

  useEffect(() => {
    // Dev sem site key: emite um token fake para destravar o fluxo local.
    if (!siteKey) {
      onToken('dev-no-captcha');
      return;
    }
    let widgetId: string | null = null;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => {
        // Falha de carregamento → sem token; o submit fica bloqueado (fail-closed UX).
        onToken('');
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) {
    return (
      <p className="font-body text-xs text-text-low">
        Verificação anti-robô desativada em desenvolvimento.
      </p>
    );
  }

  return <div ref={ref} className="min-h-[65px]" aria-label="Verificação anti-robô" />;
}
