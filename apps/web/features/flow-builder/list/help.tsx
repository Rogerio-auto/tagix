export function FlowsHelp() {
  return (
    <div className="space-y-2 text-sm text-text-mid">
      <p>
        Flows automatizam ações a partir de gatilhos (mensagem, palavra-chave, resposta de
        formulário). Cada flow é um grafo visual de nós determinísticos, sem IA no meio do caminho.
      </p>
      <p>
        Crie um rascunho, desenhe o grafo no editor e publique para ativar. Flows manuais aparecem
        na barra de flows da conversa, na ordem definida no fim desta página.
      </p>
      <p>
        No editor: Ctrl+S salva, Ctrl+Z desfaz e Ctrl+Shift+Z refaz. Também dá para adicionar
        nós pelo teclado, focando um item da lista de componentes e pressionando Enter.
      </p>
    </div>
  );
}
