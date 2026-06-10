/** Conteúdo do HelpPanel da feature de agentes (UX §2.5 — explicação no painel `?`). */
export function AgentsHelp() {
  return (
    <div className="space-y-3 font-body text-sm text-text-mid">
      <p>
        Agentes IA atendem, vendem e qualificam nas suas conversas automaticamente. Cada agente tem
        um prompt, um modelo de linguagem e um conjunto de ferramentas que pode usar.
      </p>
      <p>
        A forma mais rápida de criar um agente é a partir de um template: escolha o objetivo
        (vendas, recepção, suporte…), responda algumas perguntas sobre o seu negócio e selecione o
        modelo. O prompt e as ferramentas iniciais já vêm prontos do template.
      </p>
      <p>
        O seletor de modelo mostra apenas os modelos permitidos pela política do seu workspace.
        Modelos fora da política aparecem bloqueados — fale com o proprietário para liberá-los.
      </p>
      <p>
        Desativar um agente pausa o atendimento automático sem apagar a configuração. Você pode
        reativá-lo a qualquer momento.
      </p>
    </div>
  );
}
