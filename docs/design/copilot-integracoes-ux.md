# Copiloto e Loja de Integrações — nota de UX

> Maquete: [`copilot-integracoes.html`](copilot-integracoes.html) (abrir no navegador; `?solo=<tela>&theme=light` isola uma tela).
> Capturas: [`copilot-integracoes/`](copilot-integracoes/) em 1440 e 375, escuro e claro. Status: proposta para decisão, sem código de produto.

## 1. Princípios

1. **Pedir é um atalho, não substitui a navegação.** Gesto, clique e teclado (⌘J) abrem o mesmo Copiloto. Tudo que ele faz também pode ser feito à mão.
2. **Resposta é parecer, não conversa.** Formato fixo: veredito numa frase, o porquê em números, dados como componentes do app, fonte e próximo passo. Sem saudação nem enchimento.
3. **Ele age com as permissões de quem pede.** Nunca passa do papel da pessoa. O rodapé diz isso sempre: “Age com as suas permissões: Gestora comercial”.
4. **Quanto maior o estrago possível, mais explícito o caminho** (os 4 níveis, §4).
5. **Nada de caixa-preta.** Memória editável, fonte em toda resposta e Atividade com desfazer.
6. **Marca precisa.** O verde-neon aparece só na ação primária da tela. O Copiloto tem identidade própria: glifo de órbita, vidro discreto e tipografia, sem roxo, faíscas ou bolhas de chat.

## 2. Mapa de telas

| # | Tela | Rota |
|---|---|---|
| A1 | Alça de borda (4 estados) | qualquer tela |
| A2 | Briefing do dia (abertura automática) | `/inicio` |
| A3 | Balão com contexto | `/pipeline/negocio/:id` |
| A4 | Painel acoplado com ação em lote | `/pipeline` |
| A5 | Galeria dos 4 níveis de risco e bloqueios | componente |
| A6 | ⌘K com “Perguntar ao Copiloto” | qualquer tela |
| A7–A8 | Tela cheia: conversas, atividade | `/copiloto`, `/copiloto/atividade` |
| A9 | Sugestões do Copiloto e piloto automático por estágio | `/pipeline/sugestoes` |
| A10 | Memória do negócio | `/copiloto/memoria` |
| A11 | Configurações (capacidades × papel, orçamento) | `/configuracoes/copiloto` |
| A12 | Celular: alça, folha, ação em tela cheia | 375 |
| B1–B6 | Loja, detalhe, assistente de 5 passos, saúde, vazio + pedido, qualquer sistema | `/integracoes/...` |

## 3. Gesto e abertura

- **Alça:** pílula de 5 × 58 px a meia altura da borda direita, numa zona de pega de 30 × 120 px. No hover ou foco vira a aba “Copiloto ⌘J”. Ela é um `<button>`: Enter abre.
- **Arrastar:** a captura só começa com movimento horizontal dominante (|dx| > |dy|, dx > 6 px), para não brigar com a rolagem. O anel enche até **80 px**; depois disso o texto vira “Solte para abrir” e o arrasto ganha resistência. Ao soltar depois do limiar, abre o balão com mola curta (bounce ~0,15, só porque houve gesto). Soltar antes devolve a alça com a mesma mola.
- **Fechar:** arrastar o balão de volta para a borda (> 90 px), Esc ou ×. O foco volta para quem abriu.
- **Tamanhos:** balão (412 px, padrão), acoplado (420 px, empurra o conteúdo) e tela cheia (`/copiloto`). A troca é uma transição FLIP de 400 ms, sem perder a conversa.
- **Abertura automática:** o padrão é uma vez por dia, com o Briefing (no máximo 3 itens, ordenados por impacto em receita). As opções são toda vez, uma vez por dia ou nunca, no próprio balão e por pessoa. Balão aberto sozinho é **efêmero**: clicar fora fecha. Balão aberto pela pessoa **fica** até ela fechar, porque é não modal e a tela atrás segue clicável.
- **Celular:** deslizar da borda direita, ou o botão no TopBar, abre uma **folha a 78%** da altura. Puxar a alça cinza para cima leva à tela cheia; para baixo, fecha. Cartão de ação com impacto sobe sozinho para tela cheia, esconde o compositor e mantém os botões no alcance do polegar, acima da área segura. Alvos de 44 px e campo de 16 px.
- **Acessibilidade:** a superfície é um `dialog` não modal com `aria-label`. A resposta chega numa região `aria-live="polite"` que anuncia o veredito ao terminar, não token a token. Com `prefers-reduced-motion`, a mola vira esmaecimento de 160 ms e o texto não é digitado. Com `prefers-reduced-transparency`, o vidro vira sólido. Contraste AA nos dois temas, com os tokens do DS 3.0.

## 4. Os 4 níveis de risco

O nível é **calculado pelo sistema** a partir da capacidade, do volume e de quem é afetado, e nunca escolhido pelo modelo. Todo cartão leva um medidor de 4 traços e um rótulo; a cor nunca é o único sinal.

| Nível | Exemplos | Tratamento |
|---|---|---|
| 1 · Consulta | somar, comparar, resumir | Executa na hora. Sem cartão. |
| 2 · Escrita reversível | tag, nota, tarefa, responsável de 1 negócio | Executa e mostra recibo “Feito · Desfazer” com anel de 30 s. Depois disso, o desfazer continua na Atividade. |
| 3 · Lote relevante | mover 7 negócios, reatribuir em massa | Cartão com **antes → depois**, impacto (quem é avisado, R$ que sai da previsão, critério), lista expansível, Confirmar / Ajustar / Cancelar. Ao executar, o balão sai da frente e o quadro mostra os cards se movendo. Desfazer por 24 h. Estados: proposta, executando (com Parar), concluído, falhou parcial (“movi 5 de 7, parei em dois que a Paula estava editando”). |
| 4 · Externa ou irreversível | mensagem a clientes, cancelar campanha | Prévia da mensagem, **checagem de política** (janela de envio, consentimento, modelo aprovado, saldo) e caixa “Revisei” que libera o botão. Cancelar campanha oferece “Pausar em vez disso”. Envio agendado pode ser cancelado até sair. |

**Bloqueios:** por permissão (“Seu papel não pode cancelar campanhas”, com “Pedir à Bruna”, que encaminha com contexto) e por assinatura em somente leitura (consultas seguem; nenhuma escrita é proposta). Os pedidos bloqueados também entram na Atividade.

## 5. Loja de Integrações: decisões

- Estado antes de nome: “Suas integrações” no topo, com **Atenção** e a causa visível no card.
- “Conectar qualquer sistema” é um card de destaque na loja, e não um link no rodapé.
- No assistente, **nada é gravado até o passo 5**. O progresso fica salvo por passo, e um campo obrigatório sem mapeamento bloqueia o Continuar dizendo qual falta. No passo 3, o Copiloto lê um exemplo colado e propõe o mapeamento com a confiança de cada campo; o que fica abaixo de 80% é marcado para revisar.
- O teste com 5 registros reais estima o tamanho do problema na carga completa (“≈ 3% dos clientes”) e oferece duas saídas concretas.
- Desconectar explica o que para e o que fica, e pede confirmação com caixa de ciência. Alertas viram notificação e entram no Briefing.

## 6. Perguntas em aberto para o Rogério

1. **Nome do assistente.** “Copiloto” é descritivo e genérico, porque o mercado inteiro usa. Fica assim, ganha um nome próprio da marca Leadium, ou some e vira só “Perguntar”?
2. **Modelo de preço da IA.** Teto mensal em R$ por empresa (como na maquete), créditos por plano, ou ilimitado no plano alto? E quem vê o custo: só o Dono, ou o Dono e o Gestor?
3. **“Mover sozinho” entra na v1?** A proposta é v1 com “Só sugerir” e “Aprovação diária”, e “Mover sozinho” na v1.1 depois de medir a taxa de aceite das sugestões.
4. **Quais integrações primeiro.** Para clínica e serviço: um ERP de serviços, pagamentos Pix/boleto e agenda. Precisamos da lista real de sistemas dos clientes atuais para escolher os 3 primeiros.
5. **Abertura automática como padrão.** Uma vez por dia é o padrão proposto. Para papéis de atendimento, o padrão deveria ser “nunca”?
6. **Desfazer em lote por 24 h:** a janela é suficiente, ou deve igualar os 7 dias do piloto automático?
7. **Agência parceira** usa o Copiloto do cliente? Na maquete vem desligado por padrão.
8. **Memória entre empresas:** fica explícito que nada aprendido numa empresa vai para outra. Isso vira compromisso público (termos de uso)?
9. **Voz no celular:** só ditado, ou também resposta falada?
