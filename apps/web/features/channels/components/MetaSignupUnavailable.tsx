'use client';

import Link from 'next/link';
import { LifeBuoy, Radio } from 'lucide-react';
import { Button } from '@hm/ui';
import { signupFailureCopy, type MetaSignupConfig } from '../signup-status';
import type { ChannelProvider } from '../types';
import { InlineNotice } from './InlineNotice';

export interface MetaSignupUnavailableProps {
  config: MetaSignupConfig;
  /** Leva o usuário de volta ao passo 1 já com outro provider escolhido. */
  onSwitchProvider: (provider: ChannelProvider) => void;
}

/**
 * Estado "conexão automática indisponível" (F56-S05 / UX-01).
 *
 * Sem `NEXT_PUBLIC_META_*` no build, o popup da Meta não abre — e o `authorization
 * code` que o formulário antigo pedia **só existe como saída desse popup**. Pedir
 * esse campo era pedir o impossível. Aqui a degradação é honesta e tem duas saídas
 * reais: falar com o suporte (quem habilita as chaves) ou conectar pelo WAHA, que
 * não depende da Meta. Quem tem token permanente da Meta ainda tem o caminho
 * avançado, exposto pelo caller logo abaixo deste aviso.
 */
export function MetaSignupUnavailable({ config, onSwitchProvider }: MetaSignupUnavailableProps) {
  const copy = signupFailureCopy('not_configured');

  return (
    <InlineNotice
      tone="warn"
      title={copy.title}
      detail={
        config.missing.length > 0
          ? `Detalhe técnico: ${config.missing.join(', ')} não configurado(s) neste ambiente.`
          : undefined
      }
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Radio className="size-3.5" aria-hidden />}
            onClick={() => onSwitchProvider('waha')}
          >
            Conectar pelo WAHA
          </Button>
          <Link
            href="/help"
            className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 font-head text-xs font-medium text-text-mid outline-none transition-colors duration-200 hover:text-text focus-visible:shadow-glow-md"
          >
            <LifeBuoy className="size-3.5" aria-hidden />
            Falar com o suporte
          </Link>
        </>
      }
    >
      <p>
        {copy.why} Sem essa janela, o código de autorização da Meta — que só ela emite — não pode ser
        gerado, então não faz sentido pedir esse dado aqui.
      </p>
      <p className="mt-1">{copy.whatToDo}</p>
    </InlineNotice>
  );
}
