/** Conteúdo do HelpPanel `?` da etapa Quando enviar (UX §2.5). */
export function DeliveryHelp() {
  return (
    <div className="space-y-3 font-body text-sm text-text-mid">
      <p>
        <span className="text-text">Enviar agora</span> começa no momento em que você iniciar a
        campanha na revisão. <span className="text-text">Agendar</span> deixa tudo pronto e a
        campanha começa sozinha no dia e hora escolhidos — no fuso da campanha, não no do seu
        computador.
      </p>
      <p>
        Os <span className="text-text">horários permitidos</span> dizem quando a mensagem pode
        chegar. Fora deles, o envio pausa e continua de onde parou quando o próximo horário abrir.
        Para atravessar a meia-noite, use uma faixa em cada dia.
      </p>
      <p>
        O <span className="text-text">ritmo</span> controla quantas mensagens saem por minuto.
        Mandar devagar protege a reputação do número: se a qualidade dele no WhatsApp cair para o
        amarelo, o envio segue na metade do ritmo; se cair para o vermelho, a campanha pausa até
        melhorar.
      </p>
      <p>
        Cada número tem uma <span className="text-text">capacidade diária</span> no WhatsApp — com
        quantas pessoas ele pode iniciar conversa por dia. Você também pode definir um limite
        próprio em configurações avançadas. O que não couber num dia sai no dia seguinte.
      </p>
      <p>
        Com <span className="text-text">prazo final</span>, nada sai depois da data escolhida, e
        quem ainda não tinha recebido fica de fora. O resumo avisa antes se o prazo vai cortar
        alguém.
      </p>
      <p>
        No dia em que o relógio muda por horário de verão, um horário pode não existir ou acontecer
        duas vezes. A tela avisa e mostra quando o envio começa de fato.
      </p>
      <p>
        Teclado: nas opções, use as <kbd className="font-mono text-text">setas</kbd> para trocar e{' '}
        <kbd className="font-mono text-text">Tab</kbd> para seguir.
      </p>
    </div>
  );
}
