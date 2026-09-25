---
id: F70-S26
title: Turno da IA idempotente por envelope
phase: F70
status: review
priority: high
estimated_size: S
depends_on: [F70-S25]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S25-gatilhos-da-ia-e-flows-pela-outbox.md
agent_id: backend-engineer
claimed_at: 2026-09-25T14:11:49Z
completed_at: 2026-09-25T19:06:42Z

---
# F70-S26 — Turno da IA idempotente por envelope

## Objetivo

O cliente nunca receber duas respostas da IA para a mesma mensagem.

## Contexto

Desde a F70-S16/S25 os gatilhos da IA saem pela outbox, com entrega pelo menos uma vez. Um envelope republicado (relay caiu entre publicar e marcar como enviado, ou confirmação fora do prazo) roda o turno de novo: `runAgent` não deduplica por envelope.

## Escopo

### files_allowed

- `apps/workers/src/agents/**`
- `packages/shared/src/mq/agent-run.ts`
- `packages/shared/src/mq/*.test.ts`
- `packages/db/drizzle/**` *(se a reivindicação precisar de coluna ou índice: 0091)*
- `packages/db/src/schema/agents.ts`
- `packages/db/src/schema/agent_executions.ts`

**Correção de fronteira (registrada antes de editar, autorizada pelo líder da fase):** três
produtores ficam fora de `agents/**` e precisam mandar o id estável pelo construtor de
`agent-run.ts`; os testes deles comparam o payload exato.

- `apps/api/src/routes/conversations/agent.ts` + `agent.test.ts` + `agent.outbox.integration.test.ts`
  (troca manual: id = conversa + `ai_enabled_at` devolvido pelo UPDATE)
- `apps/api/src/internal/tools/agent-transfer-handlers.ts` + `agent-transfer-handlers.test.ts` +
  `agent-transfer.outbox.integration.test.ts` (`transfer_to_agent`: id = execução + agente de destino)
- `apps/workers/src/inbound/db-ports.ts` + `agent-run-outbox.test.ts` (inbound: o gatilho aponta para
  a última mensagem INSERIDA, não a última do lote; num lote misto a última podia ser uma
  reentrega já respondida, e o id do gatilho colidiria com o turno antigo)
- `packages/db/drizzle/**` usa a **0092** (a 0091 é da F70-S24, em paralelo)

## Escopo (faz)

- O envelope do gatilho carrega um id estável por gatilho (mensagem, retomada, follow-up, troca de agente).
- `runAgent` reivindica o turno atomicamente (ex.: `agent_executions` com índice único pelo id do gatilho) antes de chamar o runtime; o envelope repetido vira no-op com log.
- Um turno que falhou antes de responder pode ser retentado (a reivindicação não pode bloquear a retentativa legítima da fila).

## Definition of Done

- [x] teste: o mesmo envelope entregue duas vezes (inclusive em paralelo) → um turno, uma resposta
- [x] teste: turno que falhou antes do runtime → a retentativa roda

## Decisões

### Id estável do gatilho (`agentRunTriggerId`, `packages/shared/src/mq/agent-run.ts`)

O payload ganhou `triggerId` (opcional no schema, até 256 caracteres). O construtor
`agentRunJobOutbox` sempre o grava: usa o que o produtor passou ou, no inbound, deriva de
`triggerExternalId`. Gatilho sem nenhum dos dois lança, porque não há fato que identifique o turno.

| Gatilho | Derivação | Por quê |
| --- | --- | --- |
| inbound | `inbound:<conversa>:<external_id>` | `(conversation_id, external_id)` é único em `messages`, então equivale ao id da mensagem. Também existe nos envelopes antigos em voo. |
| retomada | `reengagement:<conversa>:<windowBucket>` | a mesma janela da marca Redis: uma retomada por janela |
| follow-up | `followup:<conversa>:<windowBucket>` | idem. O follow-up não tem passos (um por janela); se ganhar, o passo entra na chave. |
| troca manual | `agent-switch:<conversa>:<ai_enabled_at em µs>` | o `UPDATE` que liga a IA devolve a marca (`clock_timestamp()`) em µs exatos. Cada clique é um fato novo. |
| `transfer_to_agent` | `transfer:<execução>:<agente de destino>` | o envelope do endpoint de tools não traz o id da tool call. A mesma transferência repetida na mesma execução (retry HTTP do runtime) é o mesmo fato. |
| envelope antigo sem nenhum dos dois | `event:<envelope.id>` | só no consumidor. O relay republica a linha com o mesmo id, então a republicação continua coberta. |

- Uma chave acima de 200 caracteres vira `<tipo>:sha256:<hex>`, porque o `external_id` vem do provider.
- O consumidor usa `resolveAgentRunTriggerId`, com a mesma derivação. Um envelope antigo do inbound e o
  novo do mesmo fato geram a mesma chave.
- **Inbound (correção de fronteira):** o gatilho passou a apontar para a última mensagem INSERIDA, não a
  última do lote. Num lote misto (nova + reentrega) a última é uma mensagem já respondida. A chave
  colidiria com o turno antigo e a nova ficaria sem resposta. De carona, o texto do turno passa a ser o
  da mensagem nova.

### Reivindicação em `agent_executions` (migração 0092)

A reivindicação fica na própria linha que o runtime adota (`execution_id`, F70-S15). Não há tabela
nova: o crescimento e a retenção são os mesmos de antes. Colunas novas: `trigger_id` (índice único
parcial `(workspace_id, trigger_id)`), `turn_state`, `turn_token`, `turn_attempts`,
`turn_claimed_at` e `turn_reply`. `turn_state` fica separado de `status` porque o `finalize` do
runtime reescreve `status`.

```
(nada) ─claim─▶ claimed ─markRunning─▶ running ─saveReply─▶ responded ─deliver─▶ completed
                 │   ▲                   │                                    ▲
     infra antes │   │ retentativa       └ erro/bloqueio do runtime, resposta ┘
     do runtime  ▼   │ ou lease vencido     vazia, cap negado (desde claimed)
        failed_before_runtime
```

- **claim:** um `INSERT … ON CONFLICT (workspace_id, trigger_id) WHERE trigger_id IS NOT NULL DO UPDATE
  … WHERE turn_state = 'failed_before_runtime' OR (turn_state = 'claimed' AND turn_claimed_at < now() -
  lease)`, numa transação curta. O índice único serializa duas entregas: a segunda espera o commit da
  primeira e reavalia a condição sobre a linha gravada. O token novo vale só se a linha foi escrita.
  A reivindicação vem DEPOIS das travas (`loadContext`, IA `on`, origem, agente ativo), que não têm
  efeito, e ANTES de tudo que tem: cap, tools, socket e runtime.
- **Toda transição confere o token e o estado de origem.** `markTurnRunning` é o último passo antes do
  runtime. Se perder, o lease venceu e outra entrega retomou a MESMA execução; esta sai com
  `duplicate`/`claim_lost`.
- **Entrega repetida, conforme o estado encontrado:**
  - `failed_before_runtime`, ou `claimed` com o lease vencido (2 min; a dona morreu antes do runtime):
    reivindica de novo e roda o turno inteiro, na mesma execução, com `turn_attempts + 1`;
  - `claimed` dentro do lease: lança `AgentTurnInFlightError` e a ladder da fila retenta
    (5 s → 30 s → 2 min…). Um ack aqui perderia o turno quando a dona falha sem conseguir marcar
    `failed_before_runtime` (banco fora). O lease de 2 min cabe na ladder: a 3ª retentativa já o
    encontra vencido;
  - `running`: no-op com log;
  - `responded`: grava a resposta guardada, sem runtime;
  - `completed`: no-op com log.
- **Falha no meio (decisão).** Com o runtime já chamado (`running`), o gatilho nunca chama o runtime de
  novo. O runtime pode ter executado tools, como transferir, criar negócio ou agendar, e uma segunda
  chamada arrisca efeito duplicado e uma resposta diferente. O preço: se o processo cai durante o
  runtime, ou o banco falha antes de guardar a resposta, o turno fica sem resposta. A próxima mensagem
  do contato abre outro turno. Erro do runtime e bloqueio continuam como antes: execução `failed`,
  ack, sem retentativa.
- **Falha depois de o runtime responder.** A resposta é guardada (`responded`, `turn_reply`) ANTES de
  gravar a mensagem. Se a gravação cai, a retentativa grava ESSA resposta sem chamar o runtime. O
  cliente recebe a resposta uma vez só.
- **Uma mensagem, sempre:** `deliverTurnReply` faz `responded → completed` condicional na MESMA
  transação da mensagem e do job de envio. Duas retentativas concorrentes: só uma grava. Coberto por
  teste.
- Falha de infra antes do runtime: libera com `releaseTurn` (best-effort) e relança. Se nem isso
  grava, o `claimed` expira pelo lease.
- `completeExecution` e `failExecution` levam `turn_state` a `completed` quando há gatilho e limpam
  `turn_reply`. Execução sem gatilho continua com as colunas NULL.
- **Buffer de agregação:** roda sem `triggerId`, sem reivindicação, como antes. Nada o alimenta em
  produção (F70-S25).
- `emitStarted` passou para depois das tools e antes de `markTurnRunning`. Continua antes do runtime.

### Migração 0092 (`0092_f70_agent_turn_claim.sql`, `when` 1781452853000)

- Aditiva: seis colunas nullable sem default, dois CHECKs e o índice único parcial. É idempotente
  (`IF NOT EXISTS` e guarda em `pg_constraint`), e o reverter está no cabeçalho do arquivo.
- Numerada **0092**: a 0091 é da F70-S24, em paralelo. `check-migrations` avisa do buraco 0090 → 0092
  e passa.
- **Ordem de deploy:** o migrator do Drizzle só aplica migração com `when` maior que o da última
  aplicada. A 0091 (`when` menor) tem de entrar na main e ser aplicada ANTES ou JUNTO da 0092. Se a
  0092 for aplicada sozinha, a 0091 é pulada em silêncio depois.
- A main (F70-S24) foi mesclada, e o journal está em 0090 → 0091 → 0092. Nada aqui usa
  `ON CONFLICT (event_id)` nem lê a outbox como `hm_app`: a outbox só é escrita por `enqueueOutbox`.
- **Bancos dev:**
  - A validação final rodou num banco isolado, `highermind_f70s26`, com migrate completo até a 0092
    (93 registradas) e o seed.
  - No `highermind` compartilhado, a 0092 foi aplicada antes, direto pelo SQL (idempotente), SEM
    registro em `drizzle.__drizzle_migrations`. Assim a 0091 não é pulada lá. O `pnpm migrate`
    depois da 0091 registra a 0092 sem erro.

## Validação

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/workers typecheck
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents --maxWorkers=1
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/inbound src/campaigns-inbound --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/conversations/agent.test.ts src/routes/conversations/agent.outbox.integration.test.ts src/internal/tools --maxWorkers=1
```

## Resumo

- **Id estável por gatilho** em todo envelope `flow.run.requested` (inbound, retomada, follow-up,
  troca manual, `transfer_to_agent`). Envelopes antigos em voo derivam o id no consumidor.
- **Reivindicação atômica** em `agent_executions` antes do runtime, com a máquina
  `claimed → running → responded → completed | failed_before_runtime`. Envelope repetido vira no-op
  com log. A falha antes do runtime é retentada, e a resposta já gerada é gravada sem novo runtime.
- **Testes novos** (`agents/run-idempotency.test.ts`, 10 contra o Postgres dev, runtime falso que
  conta chamadas): paralelo, repetida com a primeira em `claimed` e em `running`, falha antes do
  runtime, `claimed` abandonado (lease), falha depois da resposta (com duas retentativas
  concorrentes), queda no meio do runtime, envelope antigo proativo, inbound antigo + novo, e
  gatilhos diferentes na mesma conversa. Com a reivindicação desligada (mutação manual), os 10
  falham.
- **Outros testes:** `shared/mq` com construtor e derivações, inbound com o lote misto, e troca manual
  com dois cliques e ids distintos.
- `slot.py validate` (banco isolado `highermind_f70s26`, com 0091 + 0092, `--maxWorkers=1`), tudo
  verde:
  - `shared/mq`: 55 (+1 skip);
  - workers `agents`: 111;
  - workers `inbound` + `campaigns-inbound`: 80;
  - API troca de agente + tools: 103;
  - 4 typechecks e `check-migrations`.
