export function ChannelsHelp() {
  return (
    <div className="space-y-3 font-body text-sm text-text-mid">
      <p>
        Canais são as origens das suas conversas: WhatsApp e Instagram via Meta, ou WhatsApp via
        WAHA (sessão não-oficial).
      </p>
      <p>
        Para conectar o WhatsApp ou Instagram oficiais, use o login da Meta no assistente — ele
        autoriza o acesso e traz os identificadores da conta automaticamente. Se a janela da Meta
        não abrir, for cancelada ou não devolver os dados, o assistente abre os campos manuais na
        mesma tela e explica o que fazer — você não precisa recomeçar.
      </p>
      <p>
        Quando o login da Meta não estiver habilitado neste ambiente, o assistente avisa e oferece
        as saídas possíveis: falar com o suporte, conectar pelo WAHA ou usar um{' '}
        <span className="text-text">token permanente</span> da Meta (System User). O código do
        Embedded Signup não é pedido nesse caso — ele só existe dentro da janela da Meta.
      </p>
      <p>
        No WhatsApp você escolhe entre <span className="text-text">número novo (Cloud API)</span> —
        registra um número que ainda não está em nenhum app — ou{' '}
        <span className="text-text">coexistência</span>, para manter o número que já usa no app
        WhatsApp Business. Na coexistência, as mensagens enviadas pelo app continuam funcionando e
        também aparecem aqui no inbox; o histórico já existente pode levar alguns minutos para
        sincronizar.
      </p>
      <p>
        Para o WAHA, informe o identificador da sessão e a chave de API. Se a sessão for desconectada
        do lado do WhatsApp, o canal aparece como desautorizado e precisa ser reconectado.
      </p>
      <p>
        Desativar um canal pausa o recebimento de mensagens sem apagar o histórico. Remover um canal
        é permanente e exige permissão de proprietário.
      </p>
    </div>
  );
}
