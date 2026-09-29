---
id: F70-S34
title: Respostas rápidas da cadência da Arcada — "Agora não" encerra, "Quero…" reabre com a IA
phase: F70
status: review
priority: high
estimated_size: M
depends_on: [F70-S06, F70-S30]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S06-agente-de-atendimento-da-arcada.md
agent_id: backend-engineer
claimed_at: 2026-09-29T16:22:01Z
completed_at: 2026-09-29T17:13:52Z

---
# F70-S34 — Respostas rápidas da cadência

## Contexto (29/09)

Modelos de Marketing, pt_BR, sem variáveis, rodapé "Para não receber mais mensagens, responda SAIR.", duas respostas rápidas cada:
- `arcada_lembrete_dia_3`: "Quero seguir" / "Agora não";
- `arcada_lembrete_dia_7`: "Quero retomar" / "Agora não";
- `arcada_toque_30_dias`: "Quero a prévia" / "Agora não".

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/**` *(parse do botão de resposta rápida)*
- `apps/workers/src/inbound/**`
- `apps/workers/src/flows/**`
- `packages/flow-engine/src/**`
- testes ao lado

*(Antes de editar fora da lista, nota de correção no slot, no padrão da F69-S03.)*

## Escopo (faz)

- O clique numa resposta rápida chega como mensagem do tipo `button` (payload e texto); o inbound normaliza de forma que o flow consiga ramificar pelo payload/texto, sem depender de acento ou caixa.
- **"Agora não":** encerra a cadência daquele contato (a etiqueta `esfriou`/o estado da cadência param; nenhum lembrete seguinte sai). Não liga a IA.
- **"Quero…":** reabre a conversa com a IA **só se a origem estiver comprovada**, respeitando a trava do workspace (F70-S30) e a marca humana; sem origem, a conversa fica para o humano.
- "SAIR" (rodapé): opt-out de marketing do contato, pelo mecanismo de consentimento/supressão que já existe (F59).
- Documentar no F70-S06 como o flow de cadência usa isso.

## Definition of Done

- [x] teste: "Agora não" → cadência encerrada, nenhum lembrete seguinte enfileirado (`apps/workers/src/inbound/quick-reply.test.ts`, engine e ponto de envio reais; `packages/flow-engine/src/dispatcher.test.ts`)
- [x] teste: "Quero…" com origem comprovada → IA reabre; sem origem → não reabre (mesmo arquivo; inclui trava desligada, IA pausada, `pending`, sem agente, texto digitado)
- [x] teste: "SAIR" → supressão de marketing registrada (mesmo arquivo; o portão de envio recusa `purpose: marketing`)

## Decisões

### Reconhecimento (`packages/flow-engine/src/quick-replies.ts`, fonte única)

- **Parser** (`packages/channels/src/meta/whatsapp/webhook.parser.ts`): `type: 'button'` (resposta
  rápida de modelo) virou `messageType: 'text'` com o texto do botão no `content` (antes caía em
  `system` e aparecia como nota de sistema, sem autor). `interactive.button_reply`/`list_reply`
  ganharam o título como `content`. O clique cru vai em `metadata.quickReply = { source, text,
  payload? }`. O parser não decide significado.
- **Significado**: `payload` primeiro, quando existir e for conhecido (a Meta devolve o texto do
  botão como payload quando o envio não define um; `cadence.reopen`/`cadence.decline` ficam
  reservados para um envio futuro com payload próprio). Payload desconhecido ou ausente → texto.
  Normalização: sem acento (NFD), minúsculas, espaços colapsados, pontuação/emoji das pontas fora.
  **Igualdade exata, nunca "contém"**: "agora não posso, me chama amanhã" não é recusa.
  - reabrir: "quero seguir", "quero retomar", "quero a previa";
  - recusar: "agora nao".
- **Texto digitado igual ao do botão conta, mas só em resposta a um modelo**: a última mensagem
  enviada na conversa precisa ser um `template`. "agora não" digitado no meio de um papo com a IA
  ("quer agendar agora?") não encerra nada. Clique conta sempre.
- O inbound grava o significado na própria mensagem (`metadata.quickReply.intent`), na transação
  que a insere (`apps/workers/src/inbound/quick-reply.ts`). É isso que as automações leem.

### "Agora não" — onde a cadência é encerrada

- **Estado derivado, não flag**: "o contato recusou" = a ÚLTIMA mensagem do contato na conversa é
  uma recusa (`contactDeclinedSql`/`hasContactDeclined`). Idempotente por construção (clicar duas
  vezes dá o mesmo estado), nada a limpar, e se desfaz sozinho quando o contato volta a escrever
  (aí a cadência recomeça, como o F70-S06 já prevê). Empate no mesmo segundo: só vale se todas as
  mensagens do instante forem recusa.
- **Conferido no ponto de envio**: `createDbOutboundPersistence().persistOutboundMessage`
  (`apps/workers/src/flows/outbound-publisher.ts`) trava a linha da conversa (`FOR NO KEY UPDATE`),
  confere a recusa e, se houver, lança `FlowSendSuppressedError` sem gravar mensagem nem job. O
  dispatcher (`packages/flow-engine/src/dispatcher.ts`) CANCELA a execução (`status = cancelled`,
  `last_error = contact_declined`), não a marca `failed`. Vale para o lembrete que já estava
  agendado e vencido quando a recusa chegou (o caso em que a aresta `response` do flow não pega:
  a execução já estava reivindicada pelo scheduler) e para a execução nova que a própria recusa
  dispara (o gatilho `new_message` do flow). Presença ("digitando…") também não sai.
- **Não liga a IA**: o port que liga a IA automaticamente (`ports/outbound.port.ts`, usado pelo
  flow `ai_action` e pelo handoff de campanha) ganhou `not contactDeclined` no mesmo UPDATE da trava
  de origem; motivo `contact_declined` (a trava de origem tem precedência no motivo).
- **Não chama a IA**: com a recusa como última mensagem o inbound não grava o gatilho do agente,
  mesmo com `ai_mode = on`. Responder automaticamente a "Agora não" é o que o contato recusou. A IA
  continua como estava e responde quando ele voltar a escrever.
- Automações que não falam com o contato (etiquetas, CRM, webhooks) continuam rodando: a recusa só
  cala envio e ligação da IA.

### "Quero…" (`reopenForQuickReply`)

- Trava a linha e decide: `on` → nada a ligar (o turno segue o caminho normal); `paused` (humano
  assumiu) ou `status = pending` (transferida para humano) → não liga; sem `agent_id` → não liga;
  senão liga **só se `aiOriginGateSql()` passar** (a fonte única da F70-S30, repetida no WHERE do
  UPDATE). Nenhum bypass por marca humana: o `on` automático é carimbado pelo trigger da F70-S19
  (`ai_auto_enabled_at`) e nunca vira marca humana. Ligou → o gatilho do agente entra na outbox na
  mesma transação.
- Em qualquer caso, `resolved`/`closed` volta para `open`: o contato pediu para seguir e quem vai
  responder (IA ou humano) precisa ver a conversa na fila. Sem origem, a conversa fica para o humano.
- A tela recebe `conversation:ai_mode_changed` / `conversation:state_changed` (métodos opcionais no
  `InboundSocketPort`).

### "SAIR"

Já existia (F59-S06): o passo de revogação do inbound detecta a palavra-chave e chama
`consentRepo.revoke` (supressão + consentimento revogado) antes de persistir; o portão do worker
outbound (F59-S05) recusa o envio a contato suprimido, inclusive `purpose: marketing`. Só provado
com teste, ponta a ponta.

### Sem migração

Nada de schema: o significado mora em `messages.metadata` (jsonb existente) e a consulta usa o
índice `idx_messages_conversation_provider_ts`.

### Mudança sugerida no seed da cadência (não editada — fora da fronteira)

Não é necessária para o comportamento (o ponto de envio já garante), só higiene do monitor de
flows: hoje a execução disparada pela própria recusa fica `waiting` até o relógio vencer e só então
é cancelada. Em `buildCadenceFlowGraph` (`packages/db/src/seed/agent_templates_arcada.ts`), inserir
logo depois do `trigger`:

```ts
{ id: 'declined', type: 'condition',
  data: { label: 'Respondeu "Agora não"?', operator: 'MSG_EQUALS',
          variable: 'trigger.message', value: 'Agora não' },
  position: { x: col(1), y: row(1) } },
```

com as arestas `trigger → declined` e `declined --false--> wait_24h` (trocando `e_trigger_wait`), e
nada no `true` (a execução termina). `MSG_EQUALS` compara em minúsculas com `trim`; o texto do botão
chega exato.

## Riscos

- **Job de envio já na fila do outbound** quando a recusa chega (janela de milissegundos, ou minutos
  se o provedor devolver erro transitório e o job entrar na escada de retry) ainda sai: o worker
  outbound (`apps/workers/src/outbound/**`) está fora da fronteira. A recusa teria de ser clicada num
  modelo anterior exatamente nessa janela. Fechar exige conferir `hasContactDeclined` para mensagens
  `sender_type = system` no worker outbound (slot próprio).
- **Silêncio depois de "Agora não"**: nenhuma mensagem de flow sai até o contato voltar a escrever,
  inclusive um flow que quisesse agradecer a recusa. Intencional; documentado acima.
- **Desligamento manual da IA** (`off` por um humano, sem a etiqueta `atendimento-humano`) é
  indistinguível do `off` de `mark_resolved`: um "Quero…" nessa conversa religa a IA se a origem
  for comprovada. A cadência só manda modelo sem `atendimento-humano`, e a pausa por humano
  (`paused`) e a transferência (`pending`) são respeitadas.
- Vocabulário dos botões é fixo no código (`QUICK_REPLY_TEXTS`): botão novo nos modelos = linha nova
  e teste.

## Validação

O vitest dos workers e da flow-engine não carrega o `.env`: sem `--env-file` os testes de banco
pulam. Postgres dev em `localhost:5442`.

```bash
node packages/channels/node_modules/vitest/vitest.mjs run --root packages/channels src/meta/whatsapp/ --maxWorkers=1
node --env-file=.env packages/flow-engine/node_modules/vitest/vitest.mjs run --root packages/flow-engine src/quick-replies.test.ts src/dispatcher.test.ts src/ai-origin-gate.test.ts src/ports/outbound.port.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound/quick-reply.test.ts src/inbound/origin-gate.test.ts src/inbound/revocation.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound/inbound.test.ts src/inbound/agent-run-outbox.test.ts src/inbound/db-ports.test.ts --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/flows/outbound-publisher.test.ts src/flows/outbound-publisher.outbox.test.ts src/outbound/consent-gate.test.ts --maxWorkers=1
pnpm --filter @hm/flow-engine typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/channels typecheck
```
