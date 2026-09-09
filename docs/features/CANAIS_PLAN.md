# Plano — Expansão de canais (paridade GoHighLevel, dois mercados)

> **Documento:** plano de arquitetura dos canais que faltam
> **Versão:** 0.1 — 2026-09-08
> **Status:** PROPOSTA — aguarda aprovação
> **Fase sugerida:** F60 (depois da F59, fundação de mercado e consentimento)
> **Documentos irmãos:** [`AGENCIA_PLAN.md`](./AGENCIA_PLAN.md) · [`LIVECHAT.md`](./LIVECHAT.md) · [`INSTAGRAM.md`](./INSTAGRAM.md)

---

## 1. O pedido

A plataforma precisa atender pelos mesmos canais que o GoHighLevel oferece: e-mail, SMS e o
restante. Este documento inventaria o que falta, ordena por mercado e — mais importante — mostra
**onde a abstração atual quebra**, porque adicionar e-mail e SMS não é "mais um adapter".

---

## 2. Inventário

| Canal | tagix hoje | Brasil | EUA | Prioridade |
|---|---|---|---|---|
| WhatsApp (Meta Cloud) | ✅ completo | crítico | alto (comunidade brasileira) | — |
| Instagram DM + comentários | ✅ completo | alto | alto | — |
| WhatsApp não-oficial (WAHA) | ✅ legado | restrito | restrito | — |
| **E-mail** | ❌ | alto | **crítico** | **P0** |
| **Webchat (widget no site)** | ❌ | alto | alto | **P1** |
| **SMS / MMS** | ❌ | baixo | **crítico** | **P1 (US)** |
| **Facebook Messenger** | ❌ | médio | médio | **P2** |
| **Google Business — avaliações** | ❌ | médio | alto | **P2** (não é canal, §7) |
| **Voz: chamada, IVR, gravação** | ❌ | baixo | médio | **P3** |
| ~~Google Business — mensagens~~ | ❌ | **morto** | **morto** | **não construir** (§7) |

### 2.1 Por que e-mail é P0 e SMS é P1

Contraintuitivo, e é consequência direta da §4 do `AGENCIA_PLAN`:

- **E-mail é o único canal de prospecção fria legal nos EUA.** Com outbound frio confirmado, sem
  e-mail não há prospecção — o produto não faz o que foi contratado para fazer.
- **E-mail serve os dois mercados** sem registro prévio, sem taxa por mensagem, sem prazo externo.
- **SMS tem 1 a 4 semanas de registro 10DLC por cliente** antes do primeiro disparo. Construir o
  adapter antes de existir cliente registrado é código parado. Construir cedo demais é pior que
  construir tarde: o registro é o gargalo, não o código.

---

## 3. Onde a abstração atual quebra

O `IChannelAdapter` foi desenhado para mensageria em tempo real da Meta. Ele resolve muito bem o
problema que tinha. E-mail e SMS trazem quatro tensões reais.

### 3.1 `AdapterCapabilities` é uma lista fixa com forma de WhatsApp

```ts
// packages/channels/src/types.ts — hoje
interface AdapterCapabilities {
  templatesHSM, storyMentions, storyReplies, publicComments,
  messageTags, voicePtt, sticker, location
}
```

Toda capacidade é um booleano nomeado por um recurso da Meta. E-mail não tem sticker nem
localização, mas tem **assunto, cópia oculta, anexo, corpo em HTML e encadeamento**. SMS tem
**segmentação e limite de caracteres**. Adicionar campos até virar uma lista de vinte booleanos,
metade irrelevante para cada adapter, é o caminho para o `Record<string, any>` do v1.

**Proposta:** manter o contrato atual e migrar para capacidades **declaradas e negociadas** —
o adapter anuncia o que suporta, e o compositor pergunta antes de montar. Aditivo, sem quebrar os
três adapters existentes, e é a mesma disciplina que já se usa em `sendTemplate` devolvendo
`IG_NO_HSM` em vez de fingir suporte.

### 3.2 Identidade do contato

Hoje `contacts` tem índice único por `(workspace_id, phone)`. Isso pressupõe telefone como
identidade — o que é verdade em WhatsApp e falso em e-mail e webchat.

O caso concreto: um lead chega por formulário só com e-mail, recebe nutrição por e-mail, e três
semanas depois manda WhatsApp de um número que ninguém associou a ele. São dois contatos, duas
conversas, dois históricos — e o agente responde como se nunca tivesse falado com a pessoa.

**Proposta:** `contact_identities` (contato × tipo × valor, único por workspace) com resolução na
entrada e **fusão auditável** — nunca automática e silenciosa, porque fundir contato errado mistura
histórico de duas pessoas e é irreversível na prática. Sugestão de fusão + confirmação humana.

### 3.3 A conversa deixa de ser síncrona

`conversations.kind` hoje é `direct | group | story_thread | comment_thread`. E-mail não é nenhum
desses: é uma **thread com assunto**, encadeada por `Message-ID` / `In-Reply-To` / `References`,
onde a mesma pessoa pode ter cinco threads abertas sobre assuntos diferentes.

E a janela de 24h da Meta, que hoje trava o composer, não tem equivalente em e-mail nem SMS — mas
**SMS tem janela de horário legal**, que é uma restrição diferente com o mesmo efeito na UI. A
máquina de estados do composer precisa generalizar de "janela Meta" para "restrição de envio do
canal", com o motivo exibido ao atendente.

### 3.4 Entregabilidade vira problema de primeira classe

Meta entrega ou devolve erro. E-mail tem **bounce duro, bounce leve, reclamação de spam,
reputação de domínio e de IP**. SMS tem **filtragem silenciosa da operadora** — a mensagem é aceita
pela API e some.

Isso não cabe em `SendResult`. Exige processamento de retorno assíncrono, supressão automática
(bounce duro suprime o endereço para sempre) e um painel de saúde de entrega por canal.
Sem isso, você descobre que 40% dos e-mails do cliente não chegam quando ele cancela.

---

## 4. E-mail (P0)

### 4.1 Escopo

Dois usos, mesma infraestrutura, políticas diferentes:

- **Conversacional** — e-mail entra na inbox como qualquer conversa, o atendente responde, o agente
  pode responder. Transacional, sem exigência de opt-in.
- **Sequências e campanhas** — nutrição, prospecção fria B2B (EUA, sob CAN-SPAM), reativação.
  Sujeito ao motor de consentimento.

### 4.2 O que precisa existir

| Peça | Detalhe |
|---|---|
| Autenticação de domínio | SPF, DKIM e DMARC por cliente, em subdomínio próprio (`mail.cliente.com`). Sem isso, entrega em spam e queima o domínio principal do cliente |
| Envio | provider atrás de `IEmailProvider`; pool separado para transacional e para marketing, para que campanha ruim não derrube confirmação de agendamento |
| Recebimento | webhook de inbound com parse de MIME, anexos para R2, e **encadeamento por `Message-ID`/`References`** — não por assunto, que é heurística e falha |
| Retorno | bounce, reclamação, entrega, abertura e clique → estado da mensagem + supressão automática em bounce duro e reclamação |
| `List-Unsubscribe` | cabeçalho com um clique, obrigatório na prática para provedores grandes. É também a forma mais barata de honrar revogação |
| Aquecimento | domínio novo não dispara volume no dia 1. Rampa por dias, com teto — regra do produto, não do operador lembrar |
| Editor | e-mail em HTML que sobrevive a cliente de e-mail antigo. Templates do DS v2 **não** servem: e-mail é tabela e CSS inline |

### 4.3 Prospecção fria B2B nos EUA

Requisitos do CAN-SPAM, aplicados em código e não em treinamento:

- remetente e assunto **não enganosos** — o "de" precisa identificar quem realmente envia
- **endereço físico postal válido** no rodapé — valor personalizado por workspace
- **opt-out funcional**, honrado em até 10 dias úteis (o produto honra na hora)
- separar domínio de prospecção do domínio transacional do cliente. Prospecção fria queima
  reputação; ela não pode compartilhar domínio com a confirmação de agendamento de quem já é cliente

---

## 5. SMS / MMS (P1, mercado US)

### 5.1 Pré-requisito externo

Registro 10DLC — marca e campanha — antes do primeiro disparo. Desde 01/02/2025 as operadoras
bloqueiam 100% do tráfego não registrado, e em 2026 auditam depois da aprovação. Prazo de 1 a 4
semanas. Detalhes e fontes em [`AGENCIA_PLAN.md`](./AGENCIA_PLAN.md) §4.3.

**Impacto no produto, não só no runbook:** o workspace precisa de um **estado de registro do canal**
(`pending | submitted | approved | rejected | suspended`), visível na UI, e o envio recusa com motivo
claro enquanto não estiver aprovado. Sem isso, o operador dispara, nada chega, e ninguém entende.

### 5.2 O que o adapter precisa tratar

- **Segmentação**: 160 caracteres em GSM-7, 70 em UCS-2. Um "ç" ou um emoji derruba a mensagem
  inteira para UCS-2 e dobra o custo. O compositor precisa mostrar segmentos e codificação **antes**
  de enviar — em português isso não é detalhe, é a diferença entre 1 e 3 segmentos.
- **MMS** para imagem, com limite e transcodificação.
- **Palavras-chave obrigatórias**: `STOP`, `UNSUBSCRIBE`, `HELP` — e os equivalentes em português
  (`PARE`, `SAIR`, `AJUDA`), porque o público responde no idioma dele.
- **Revogação em linguagem natural** (§6).
- **Janela horária pelo fuso do contato**, com recusa registrada.
- **Filtragem silenciosa**: aceita pela API e nunca entregue. Exige conciliação por relatório de
  entrega, e alerta quando a taxa cai.

---

## 6. O detector de revogação

A regra americana em vigor desde 11/04/2025 diz que o consumidor revoga por **qualquer meio
razoável**, e proíbe exigir palavra-chave específica. Casar `STOP` é insuficiente e não protege.

**Desenho:** classificador roda no inbound, **antes** do agente e antes de qualquer automação, em
português e inglês. Detecta intenção de revogar ("para de me mandar", "não tenho interesse", "me
tira dessa lista", "stop texting me"). Ao detectar:

1. suprime imediatamente — o canal, e o escopo da empresa quando a revogação for genérica
2. envia **uma única** mensagem de esclarecimento, que a regra permite
3. registra a evidência: mensagem original, classificação, confiança, timestamp
4. notifica o atendente — revogação também é sinal comercial

Escopo "empresa inteira" desde já: a cláusula que torna isso obrigatório entra em **31/01/2027**, e
implementar depois significa migrar dados de consentimento retroativamente, que é o pior tipo de
migration.

**Isto vale para os dois mercados.** No Brasil não é exigência da mesma lei, mas ignorar "para de me
mandar mensagem" queima o número do cliente no WhatsApp — o custo é o mesmo, cobrado pela Meta em
vez de por um tribunal.

---

## 7. Google Business Profile — o que morreu e o que sobra

**Não construa canal de mensagem do Google Business Profile.** O recurso foi desligado: em
**15/07/2024** parou de aceitar novas conversas e em **31/07/2024** foi encerrado por completo,
junto com o histórico de chamadas. Qualquer material que descreva "chat do Google Meu Negócio" como
canal está desatualizado — inclusive comparativos de concorrentes que ainda listam o recurso.

O que **sobra e importa muito** para negócio local:

- **Avaliações** — ler, responder pelo produto, e a automação de solicitação, com a regra da FTC
  contra supressão (`AGENCIA_PLAN` §4.5)
- **Insights** — chamadas, cliques para rota, visualizações. Alimenta o dashboard de resultado

Isso entra como **integração de reputação**, não como `ChannelProvider`. Forçar avaliação para
dentro do modelo de conversa distorce os dois.

---

## 8. Webchat (P1)

Widget embutido no site do cliente que cai na mesma inbox. Barato de construir, alto retorno:

- é a fonte de lead do site, que hoje se perde em formulário que vira e-mail que ninguém lê
- **captura consentimento com prova** no momento certo — o texto exibido, a URL e o timestamp, que é
  exatamente o que o §4.4 do `AGENCIA_PLAN` exige e o que falta em todo lead importado
- funciona nos dois mercados, sem lei nova e sem registro

Requer: identidade anônima até a identificação, continuidade entre visitas, handoff para o agente,
horário de atendimento, e isolamento — o widget roda no site do cliente e não pode vazar nada do
workspace.

---

## 9. Facebook Messenger (P2) e voz (P3)

**Messenger** — mesmo app Meta, mesma estrutura de webhook, mesma união de provider. É o adapter de
menor custo marginal da lista. Fica em P2 só porque o volume é menor que e-mail e SMS.

**Voz** — chamada, gravação, transcrição, IVR, número rastreável por campanha. É o maior salto de
escopo: mídia em tempo real, custo por minuto, e regras próprias de gravação (vários estados
americanos exigem consentimento de **ambas** as partes). Entra quando o nicho pedir. Para reforma e
construção, número rastreável por campanha tem valor real — o dono atende no celular e hoje ninguém
sabe qual anúncio gerou a ligação.

---

## 10. Faseamento

| Slot | Entrega |
|---|---|
| **F60-A** | Generalizar capacidades do adapter + `contact_identities` + resolução e fusão auditável |
| **F60-B** | Restrição de envio genérica no composer (substitui a trava específica de janela Meta) |
| **F60-C** | E-mail: envio, recebimento, encadeamento, autenticação de domínio, retorno, supressão |
| **F60-D** | E-mail: sequências, campanhas, `List-Unsubscribe`, rampa de aquecimento |
| **F60-E** | Webchat: widget, identidade anônima, captura de consentimento com prova |
| **F60-F** | SMS/MMS: adapter, segmentação, estado de registro 10DLC, palavras-chave |
| **F60-G** | Detector de revogação em NL (pt + en) + supressão + esclarecimento único |
| **F60-H** | Painel de saúde de entrega por canal |
| **F60-I** | Messenger |
| *(depois)* | Avaliações e insights do Google · voz |

**Dependência dura:** F60-G depende do motor de consentimento da F59. E nenhum disparo frio
americano acontece antes de F60-G estar em produção — não é preferência de engenharia, é o que
separa operar de responder processo.

---

## 11. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Adapter de e-mail tratado como "mais um provider" | Encadeamento e entregabilidade viram gambiarra; e-mail do cliente cai em spam | §3 antes de §4. A generalização vem primeiro |
| Domínio do cliente queimado por prospecção fria | Confirmação de agendamento para de chegar. Dano ao negócio dele, causado por você | Domínios separados, rampa obrigatória, supressão automática |
| Fusão de contatos errada | Histórico de duas pessoas misturado, sem volta | Fusão sempre com confirmação humana e trilha de auditoria |
| SMS construído antes do primeiro 10DLC aprovado | Código parado por semanas | F60-F depois de F60-C/D, com o registro do primeiro cliente aberto no dia 1 |
| Lista fixa de capacidades cresce sem controle | Volta o `Record<string, any>` do v1 | §3.1 — capacidades negociadas, não booleanos acumulados |

---

## Fontes

Verificadas em 2026-09-08:

- [Update on Google Business Messages — Google for Developers](https://developers.google.com/business-communications/business-messages/resources/release-notes/update-on-gbm)
- [Google Business Profile Updates: Removal of Chat and Call History — GoSite](https://www.gosite.com/blog/google-business-profile-updates-removal-of-chat-and-call-history)
- [A2P 10DLC Compliance: 2026 Registration & Approval Guide — JustCall](https://justcall.io/blog/10dlc-compliance-guide.html)
- [The TCPA's New Opt-Out Rules Take Effect on April 11, 2025 — BCLP](https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html)
