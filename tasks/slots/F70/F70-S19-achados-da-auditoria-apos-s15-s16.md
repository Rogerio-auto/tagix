---
id: F70-S19
title: Achados da auditoria que dependem da S15 e da S16 — IA legada, eco, assinatura com timestamp e consumer estrito
phase: F70
status: review
priority: high
estimated_size: S
depends_on: [F70-S15, F70-S16]
blocks: []
source_docs:
  - tasks/slots/F70/F70-S18-achados-baixos-da-auditoria.md
agent_id: backend-engineer
claimed_at: 2026-09-25T06:21:59Z
completed_at: 2026-09-25T06:43:54Z

---
# F70-S19 — Achados da auditoria que dependem da S15 e da S16

## Objetivo

Fechar M2, L3, L5, L6 e L7 da auditoria pré-deploy de 25/09.

## Escopo

### files_allowed

- `apps/workers/src/agents/run.ts`
- `apps/workers/src/agents/*.test.ts`
- `apps/workers/src/coexistence/worker.ts`
- `apps/workers/src/webhooks/**`
- `packages/shared/src/mq/domain-events.ts`
- `packages/shared/src/mq/*.test.ts`
- `docs/api-reference/guides/webhook-events.mdx`
- `packages/db/drizzle/**` *(se precisar marcar "ligado por humano")*
- `packages/db/src/schema/conversations.ts`
- `apps/api/src/routes/conversations/state.ts`
- `apps/api/src/routes/conversations/agent.ts`

## Escopo (faz)

- **M2:** o worker de agentes só responde se a origem for elegível **ou** se a IA foi ligada por um humano (marca explícita gravada por `state.ts`/`agent.ts`). Conversas antigas `on` sem origem param de receber IA automática até um humano religar. Runbook: a consulta de pré-deploy que lista essas conversas.
- **L3:** `warn` no boot dos workers quando `META_APP_ID` estiver vazio.
- **L5:** header `x-hm-timestamp`, assinatura de `ts.body`, e documentação da janela de replay.
- **L6:** teto de tamanho no texto livre de `message.received`/`message.sent`.
- **L7:** o consumer revalida `data` com `DOMAIN_EVENT_DATA_SCHEMAS[event]` estrito; o que não bate vai para a DLQ.

## Definition of Done

- [x] teste: conversa `on` legada sem origem e sem marca humana → o worker não responde; ligada por humano → responde
  *(`apps/workers/src/agents/run-origin-gate.test.ts`, Postgres dev + trigger real da 0088:
  legado → `origin_not_eligible`, sem execução nem mensagem; marca humana → responde; `on`
  automático depois da marca a invalida; FK recusa membro de outro workspace)*
- [x] teste: assinatura com timestamp verificada; replay fora da janela recusado pelo verificador de referência
  *(`apps/workers/src/webhooks/e2e.test.ts`: receptor real verifica com `verifyWebhookSignature`;
  a entrega capturada é recusada depois de 301s e com timestamp trocado. Unitários em
  `webhooks.test.ts`)*
- [x] teste: payload fora do contrato vai para a DLQ
  *(`e2e.test.ts`: envelope com campo a mais publicado em `hm.events` aparece em `hm.q.dlq`
  com `x-hm-dlq-reason=non_retryable` e nenhuma entrega; `consumer-contract.test.ts` e
  `packages/shared/src/mq/domain-events.test.ts`)*
- [x] teste do teto de texto (L6) e do aviso de `META_APP_ID` (L3)
  *(`domain-events.test.ts`; `apps/workers/src/agents/meta-app-id-warning.test.ts`, porque os
  testes de `coexistence/` estão fora da fronteira)*
- [x] migração aplicada no banco local *(0088 no Postgres dev `localhost:5442`)*

## Decisões

### M2 — marca "IA ligada por um humano" (migração 0088)

- **Colunas em `conversations`** (aditivas, nullable, sem backfill):
  - `ai_enabled_at timestamptz`: quando um humano ligou a IA;
  - `ai_enabled_by uuid`: quem ligou. FK composta `(workspace_id, ai_enabled_by) → members
    (workspace_id, id)`, `ON DELETE SET NULL (ai_enabled_by)`, com índice parcial. Serve de
    auditoria. Se o membro sai, a autoria vira NULL e a marca continua valendo;
  - `ai_auto_enabled_at timestamptz`: quando a IA virou `on` sem marca humana nova.
- **Quem grava a marca humana:**
  - `POST /api/conversations/:id/ai-mode` com `on` (`state.ts`);
  - `POST /api/conversations/:id/agent` (`agent.ts`), que sempre liga a IA.
  As duas gravam `ai_enabled_at = clock_timestamp()` e `ai_enabled_by = membro` no mesmo
  UPDATE que liga a IA. A mudança em `state.ts` é uma linha de spread, localizada.
- **Quem grava o `on` automático:** o trigger `trg_conversations_ai_enable_mark`
  (`BEFORE UPDATE OF ai_mode`). Ele marca `ai_auto_enabled_at = clock_timestamp()` em toda
  transição de não-`on` para `on` cujo UPDATE não trouxe uma marca humana nova. Foi escolhido
  trigger, não código, porque:
  - cobre todos os caminhos automáticos da auditoria da S08 (flow, campanha, retomada,
    transferência), que estão fora desta fronteira;
  - cobre SQL manual e caminhos que ainda não existem.
  A aplicação nunca escreve essa coluna.
- **Relógio único:** as duas marcas usam o `clock_timestamp()` do banco, então a comparação
  não depende do relógio da API. `now()` não serviria: é o início da transação.
- **Regra no worker** (`authorizeAiReply`, `apps/workers/src/agents/run.ts`): o agente só
  responde se:
  - a origem for elegível (`isConversationAiEligible`, a mesma regra única da S07); **ou**
  - `ai_enabled_at` for posterior a `ai_auto_enabled_at` (ou este for NULL).
  É fail-closed: marca ausente ou inválida, ou empate, não responde. A checagem roda antes
  de qualquer efeito (policy, execução, runtime) e devolve
  `{ status: 'skipped', reason: 'origin_not_eligible' }` com `warn`. O `warn` se repete a
  cada mensagem nova dessas conversas. É de propósito: uma conversa `on` que a IA não pode
  atender é estado a corrigir.
- **Por que a marca não é apagada ao desligar:** nenhum caminho automático liga a IA em
  conversa sem origem elegível (S07/S08). Um `on` sem origem só acontece por um humano, que
  renova a marca, ou por um caminho sem trava, que o trigger denuncia. Manter a marca preserva
  a auditoria de quem ligou.

### Consulta de pré-deploy (M2) e efeito no deploy

**Efeito:** toda conversa com `ai_mode='on'` e origem não elegível para de receber resposta da
IA no deploy. Origem não elegível é NULL (legado anterior à 0083), `sem-origem` ou
`origem:prospeccao`. Nenhuma dessas conversas tem marca humana, porque a coluna nasce vazia.
Elas continuam `on` na UI e o atendimento humano segue normal. A IA só volta a responder se um
humano religar a IA na conversa (toggle de IA ou troca de agente), o que grava a marca. Não há
backfill: nada comprova que foram ligadas por um humano.

Rodar em produção **antes** do deploy, para listar quem será afetado e decidir quem religar:

```sql
-- F70-S19: conversas que param de receber IA com o deploy (antes da 0088).
SELECT c.workspace_id, w.name AS workspace, c.id AS conversation_id, c.channel_id,
       ct.display_name, ct.phone, c.origin, c.status, c.agent_id, c.last_message_at
FROM conversations c
JOIN workspaces w ON w.id = c.workspace_id
LEFT JOIN contacts ct ON ct.id = c.contact_id
WHERE c.ai_mode = 'on'
  AND (c.origin IS NULL OR c.origin NOT IN ('origem:anuncio', 'origem:site', 'origem:instagram'))
ORDER BY w.name, c.last_message_at DESC NULLS LAST;
```

Depois da 0088, a mesma lista das que ainda estão sem IA ganha o filtro da marca:

```sql
  AND (c.ai_enabled_at IS NULL
       OR (c.ai_auto_enabled_at IS NOT NULL AND c.ai_enabled_at <= c.ai_auto_enabled_at))
```

Validadas no Postgres dev (0 linhas lá). A lista traz nome e telefone do contato para a decisão
humana. Trate a saída como dado pessoal: não cole em ticket nem em chat.

### L3 — `META_APP_ID` vazio

`createCoexistenceDeps`, usada pelo worker de coexistência e pelo inbound no boot, chama
`warnIfOwnMetaAppIdsMissing`. O aviso sai uma vez por processo e não impede o boot, porque um
ambiente sem Instagram não precisa da variável. Sem o id, o eco do IG de uma mensagem do
próprio Leadium só é reconhecido pelo mid. Na corrida com o outbound, ele pausaria a IA como
resposta humana.

### L5 — assinatura com timestamp

- **Headers:**
  - `x-hm-timestamp`: segundos Unix da tentativa;
  - `x-hm-signature-256`: `sha256=<hex>` do HMAC-SHA256 de `${timestamp}.${corpo cru}`.
- **Retries:** cada tentativa é assinada de novo com o próprio horário. Um retry horas depois
  continua dentro da janela. O dedup do cliente segue pelo `_meta.eventId`.
- **Verificador de referência:** `verifyWebhookSignature` (`apps/workers/src/webhooks/signature.ts`).
  - Checa formato estrito dos dois headers e janela de 300s para os dois lados.
  - Compara o HMAC em tempo constante (`timingSafeEqual` com os dois lados do mesmo tamanho).
  - É o verificador que o e2e usa como cliente e o que a doc ensina.
- **Compatibilidade — troca direta, sem período com os dois formatos:**
  - Não existe consumidor real. O CO-22 do Rogério OS é o primeiro e nasce no formato novo.
  - Um período duplo exigiria manter a assinatura antiga, só do corpo, válida para sempre. É
    exatamente o replay que o achado fecha.
  - O custo é quebrar um verificador escrito para o formato antigo, e hoje não há nenhum.
  - Documentado na `webhook-events.mdx` com a data da mudança.

### L6 — teto de texto

- **Limite:** `DOMAIN_EVENT_TEXT_MAX_LENGTH = 4096`, em unidades UTF-16.
- **Onde:** `truncateEventText` roda nos construtores `messageReceived`/`messageSent`, então
  nenhum produtor precisa lembrar.
- **Formato do corte:** termina em `…`, sem partir um par substituto.
- **Contrato:** `.max(4096)` no schema. Quem montar o `data` sem o construtor é barrado na
  publicação e no consumo.

### L7 — contrato estrito no consumo

- **Onde:** `parseDomainEnvelope` revalida o `data` com `DOMAIN_EVENT_DATA_SCHEMAS[evento]`, então
  vale para qualquer consumidor.
- **Falha:** vira `DomainEventContractError` (`NonRetryableError`), que o `consume` manda direto
  à DLQ (`x-hm-dlq-reason=non_retryable`), sem gastar retry.
- **Log:** o consumer loga `warn` com evento, id do envelope, caminho, código e nomes das
  chaves a mais (até 20, 64 chars). Nunca o valor recebido, que pode ser o dado pessoal que o
  contrato existe para barrar.

## Riscos

- **Conversas que param de receber IA (M2).** É intencional e fail-closed. O volume sai da
  consulta de pré-deploy. Religar é uma ação humana por conversa (toggle de IA ou troca de
  agente); não existe religar em massa, de propósito.
- **Formato da assinatura (L5).** Quem já tiver implementado o formato antigo recusa todas as
  entregas até atualizar. Conhecidos: nenhum.
- **Entrega de teste de Settings → Dev.** `apps/api/src/routes/dev/webhooks.ts` ainda assina no
  formato antigo e sem `x-hm-timestamp`. Um cliente que implemente o formato novo recusa o
  ping de teste. A seção "Verificar a assinatura" de `docs/api-reference/guides/webhooks.mdx`
  e o texto de `WebhooksManager.tsx` também descrevem o formato antigo. Os três estão fora
  desta fronteira; ver Pendências.
- **Mensagens em voo no deploy (L6/L7).** Um `message.*` com texto acima de 4096 que já esteja
  na outbox ou na fila, gravado pelo código antigo, cai na DLQ em vez de ser entregue. Na
  prática é zero: o webhook de saída ainda não tem assinante real.

## Pendências fora da fronteira

- Sub-slot para a entrega de teste:
  - `apps/api/src/routes/dev/webhooks.ts` passa a usar o mesmo `x-hm-timestamp` e a mesma
    assinatura. O ideal é mover `signature.ts` para `@hm/shared`, para a API e os workers
    usarem um único signer;
  - atualizar `docs/api-reference/guides/webhooks.mdx` (anatomia, verificação, entrega de
    teste) e o texto de `apps/web/features/settings/sections/dev/WebhooksManager.tsx`.
- UI: mostrar na conversa que a IA está `on` mas bloqueada por falta de origem ou marca humana.
  Hoje só o log mostra. Pode ser um campo derivado no detalhe da conversa.
- Teste de rota da API gravando a marca (`state.test.ts`/`agent.test.ts` mockam o banco e estão
  fora da fronteira). O `set` exato das rotas é reproduzido contra o banco real em
  `run-origin-gate.test.ts`.

## Validação

O vitest de `@hm/workers` não carrega o `.env`. Sem o `--env-file`, os testes de banco pulam.

```bash
python scripts/slot.py check-migrations
pnpm --filter @hm/db migrate
node --env-file=.env apps/workers/node_modules/vitest/vitest.mjs run --root apps/workers src/agents src/webhooks src/inbound/origin-gate.test.ts --maxWorkers=2
node packages/shared/node_modules/vitest/vitest.mjs run --root packages/shared src/mq/domain-events.test.ts src/mq/outbox.test.ts --maxWorkers=2
pnpm --filter @hm/api exec vitest run src/routes/conversations/state.test.ts src/routes/conversations/agent.test.ts src/routes/conversations/__tests__/cycle-timestamps.integration.test.ts --maxWorkers=2
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/db typecheck
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/api typecheck
```
