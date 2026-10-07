/** Conteúdo do HelpPanel `?` da etapa Mensagem (UX §2.5). */
export function MessageHelp() {
  return (
    <div className="space-y-3 font-body text-sm text-text-mid">
      <p>
        No WhatsApp oficial, a primeira mensagem para alguém precisa ser um{' '}
        <span className="text-text">modelo aprovado pela Meta</span>. Por isso esta etapa mostra só
        os modelos aprovados do número escolhido. Para criar um novo ou trazer os que já existem na
        Meta, use a central de modelos.
      </p>
      <p>
        Alguns modelos têm <span className="text-text">campos para preencher</span> — os espaços que
        na Meta aparecem como {'{{1}}'}, {'{{2}}'}. Para cada um, diga o que vai ali: um dado do
        contato (nome, telefone, e-mail), um campo personalizado ou um texto igual para todos.
      </p>
      <p>
        Quando o campo vem do contato, o <span className="text-text">texto reserva</span> é
        obrigatório: é o que sai para quem não tem aquele dado. Assim ninguém recebe “Olá , tudo
        bem?”.
      </p>
      <p>
        A prévia mostra a mensagem como ela chega, já com os valores de um contato de exemplo. Os
        trechos destacados são os campos preenchidos; um trecho tracejado ainda está sem valor.
      </p>
      <p>
        <span className="text-text">Enviar teste</span> manda a mensagem de verdade para o número
        que você informar, pelo mesmo caminho do envio da campanha. O teste não entra nas métricas.
        Clicar duas vezes não manda duas mensagens.
      </p>
      <p>
        Em uma sequência, cada mensagem espera um tempo depois da anterior. Você pode reordenar com
        as setas do cartão ou com <kbd className="font-mono text-text">Alt</kbd> +{' '}
        <kbd className="font-mono text-text">↑</kbd>/<kbd className="font-mono text-text">↓</kbd>.
        No catálogo, <kbd className="font-mono text-text">/</kbd> vai para a busca.
      </p>
      <p>
        Se a Meta pausar ou rejeitar um modelo depois que você o escolheu, a campanha não avança com
        ele: escolha outro ou sincronize, caso ele já tenha sido liberado.
      </p>
    </div>
  );
}
