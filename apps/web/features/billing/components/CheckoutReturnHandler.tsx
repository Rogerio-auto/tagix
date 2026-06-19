'use client';

/**
 * Trata o RETORNO do checkout hospedado (PAYMENTS_ABACATEPAY.md §5/§8).
 *
 * A API monta returnUrl/completionUrl apontando para
 *   /settings/billing?status=return|completed&workspace=…&plan=…
 * Aqui lemos esse status, damos feedback imediato (UX §2.7), revalidamos a
 * assinatura (o WEBHOOK HMAC é a fonte da verdade — §1; o status só melhora UX)
 * e LIMPAMOS a querystring para não repetir o toast em refresh/voltar.
 *
 * Não renderiza nada (efeito puro). Vive sob Suspense (usa useSearchParams).
 */
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@hm/ui';
import { BILLING_KEYS } from '../queries';

export function CheckoutReturnHandler() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const handled = useRef(false);

  const status = params.get('status');

  useEffect(() => {
    if (!status || handled.current) return;
    handled.current = true;

    if (status === 'completed') {
      toast({
        variant: 'success',
        title: 'Pagamento recebido',
        description: 'Estamos confirmando os detalhes. Seu plano será atualizado em instantes.',
        duration: 6000,
      });
    } else if (status === 'return') {
      toast({
        variant: 'info',
        title: 'Tudo certo por aqui',
        description: 'Assim que o pagamento for confirmado, seu plano será atualizado.',
        duration: 6000,
      });
    }

    // Revalida o estado (a confirmação real chega pelo webhook — pode levar segundos).
    void qc.invalidateQueries({ queryKey: BILLING_KEYS.subscription });

    // Limpa a URL para a rota canônica (sem disparar o toast de novo em refresh).
    router.replace('/settings/billing');
  }, [status, qc, router, toast]);

  return null;
}
