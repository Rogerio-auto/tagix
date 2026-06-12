import { HelpHint } from './HelpHint';

export const InlineNextToSection = () => (
  <div className="flex items-center gap-2">
    <h2 className="font-head text-sm uppercase tracking-wide text-text-low">Conversões</h2>
    <HelpHint
      title="Conversões"
      body={
        <>
          <p>
            Uma <strong>conversão</strong> é um evento de negócio que você registra a partir de uma
            conversa — uma venda, um agendamento, um lead qualificado.
          </p>
          <p>
            Conversões alimentam o dashboard e os relatórios. Registre pelo drawer do negócio ou
            automaticamente via um nó <code>register_conversion</code> num flow.
          </p>
          <ul>
            <li>Cada tipo de conversão tem um valor e uma moeda.</li>
            <li>O histórico fica na timeline do contato.</li>
          </ul>
        </>
      }
      link={{ label: 'Ver documentação de conversões', href: '#' }}
    />
  </div>
);

export const WithoutLink = () => (
  <div className="flex items-center gap-2">
    <span className="font-head text-text">Janela de 24h</span>
    <HelpHint
      title="Janela de atendimento de 24h"
      body={
        <p>
          A Meta só permite mensagens livres dentro de 24h após a última mensagem do contato. Fora
          dessa janela, use um <strong>template aprovado</strong> para reabrir a conversa.
        </p>
      }
    />
  </div>
);
