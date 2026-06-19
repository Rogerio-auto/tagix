/**
 * Conteúdo do HelpPanel `?` do billing portal (UX §2.5 — ajuda real, não tooltip).
 * Título + corpo rico (parágrafos/listas). Sem hex; estilos de texto vêm do painel.
 */
import type { HelpContent } from '@hm/ui';

export const billingHelp: HelpContent = {
  title: 'Cobrança e planos',
  body: (
    <>
      <p>
        Aqui você gerencia o plano do seu workspace: escolher um plano, mudar o ciclo de cobrança e
        acompanhar suas cobranças.
      </p>
      <p>
        <strong>Formas de pagamento</strong>
      </p>
      <ul>
        <li>
          <strong>Cartão de crédito</strong>: renovação automática a cada ciclo.
        </li>
        <li>
          <strong>PIX</strong>: você paga manualmente a cada novo ciclo; avisamos antes do
          vencimento.
        </li>
      </ul>
      <p>
        Ao continuar, você é levado a um <strong>checkout seguro</strong> para concluir o pagamento.
        Assim que ele for confirmado, seu plano é ativado automaticamente.
      </p>
      <p>
        <strong>Cancelamento</strong>: ao cancelar, o plano permanece ativo até o fim do ciclo já
        pago e não é renovado. Você pode reativar antes dessa data.
      </p>
    </>
  ),
};
