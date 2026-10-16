# ADR-004: Motor de ações do Copiloto (proposta, confirmação humana, execução determinística e desfazer)

> **Status:** aceita · **Data:** 2026-10-16 · **Fase:** F73
> **Decisor:** Rogério (4 níveis de risco, "o nível é calculado pelo sistema e nunca escolhido pelo modelo", desfazer); desenho técnico desta ADR.
> **Contexto:** [`../features/COPILOTO.md`](../features/COPILOTO.md) §6 e §8 · [ADR-003](ADR-003-identidade-do-membro-nas-acoes-de-ia.md) · maquete A4, A5, A8 e A9.

## Contexto

O Copiloto precisa mudar dados (mover 7 negócios, mandar lembrete a 12 pacientes, cancelar campanha) sem que o modelo decida sozinho o que é perigoso, sem executar duas vezes, sem atropelar quem editou o registro no meio do caminho e com desfazer real. Hoje o human-in-the-loop não existe: as colunas `requires_human_approval` não têm efeito, o evento `interrupt` é só contrato e não há `/resume`.

## Decisão

### 1. Proposta é dado; o modelo nunca executa nível 3 ou 4

Para o modelo, toda capacidade de escrita é uma ferramenta **`propose_<capability>`**. O handler no Node (`services/copilot/proposals`) faz, em ordem:

1. valida `args` (Zod `.strict()` da capacidade);
2. **resolve os alvos** sob o escopo do membro (ADR-003 §4). Alvo invisível ou inexistente é descartado e informado;
3. lê o **estado atual** de cada alvo e grava `expected_version` (por exemplo `deals.updated_at` + `stage_id`);
4. calcula as entradas do classificador (`target_count`, `external`, `irreversible`, `notifies_members`, `turn_tainted`) e chama **`classifyRisk()`** (função pura em `@hm/shared/copilot/risk.ts`, testada por tabela);
5. checa a permissão efetiva. Se negada, grava a proposta `blocked` com `blocked_reason` e devolve `action_blocked`;
6. monta a **prévia** (`before → after` por item, impacto em R$ na previsão, quem é avisado, critério) e, no nível 4, a **checagem de política** (§5);
7. por nível:
   - **1:** não passa pelo motor (consulta);
   - **2:** executa na hora (§3), grava a proposta `completed` com `undo_deadline` e devolve `action_receipt`;
   - **3 e 4:** grava a proposta `proposed` com `expires_at` (nível 3: 15 min; nível 4: 10 min) e devolve ao modelo `{ status: 'awaiting_confirmation', proposal_id, summary }`. O prompt do sistema instrui o modelo a parar e resumir. O turno termina.

A confirmação é humana e fora do modelo: `POST /api/copilot/proposals/:id/confirm`.

### 2. Confirmar: idempotente, revalidado e otimista

- Header `Idempotency-Key` obrigatório (UUID). Body `{ version, acknowledged?, adjustments? }`. `acknowledged: true` é obrigatório no nível 4 (a caixa "Revisei").
- Revalida **tudo** no momento do clique: dono (ou aprovador), status `proposed`/`awaiting_approval`, `expires_at > now()`, permissão efetiva **atual** (ADR-003 §3, passos 4–6), assinatura, e no nível 4 a política recalculada (consentimento e janela podem ter mudado).
- Transição por **compare-and-set**: `UPDATE … SET status='executing', confirm_idempotency_key=$k, version=version+1, lease_expires_at=now()+'2 min' WHERE id=$id AND status IN (…) AND version=$v RETURNING`.
  - Repetir com a **mesma** chave devolve o estado atual (200), sem reexecutar.
  - Chave **diferente** com a proposta já confirmada devolve `409 already_confirmed`.
  - `version` divergente (alguém ajustou) devolve `409 stale_proposal` com a proposta atual.
- Ajustar (`/adjust`) só em `proposed`: remove itens (`excluded`), troca parâmetros permitidos (estágio de destino, avisar responsáveis), **recalcula o risco e a prévia** e incrementa `version`.

### 3. Executar: item a item, determinístico, retomável

- O executor da capacidade implementa `CapabilityExecutor { capability, resolveTargets, preview, policyCheck?, executeItem, undoItem }`. As implementações vivem nas F73-S08 (CRM) e S09 (externas) e **reusam os services de domínio** (`moveDealToStage`, `createEvent`, `checkOutboundInTx`, ciclo de vida de campanha), com `actor = { type: 'member', memberId: executed_as }` e `metadata = { via: 'copilot', proposal_id }`.
- Cada item roda na **sua** transação sob RLS. Antes de escrever, o item confere `expected_version` contra o estado atual. Se mudou, fica `skipped_conflict` com o motivo legível ("editado pela Paula às 09:14"); é isso que gera o "movi 5 de 7, parei em dois". Erro de regra de domínio (por exemplo `TransitionError`) vira `failed` com `error_code`.
- Lote no processo da API com **lease**: `lease_expires_at` é renovado a cada item. Uma varredura (a cada 60 s, com lock Redis, padrão `acquireSchedulerLock`) retoma propostas `executing` com lease vencido e processa só os itens `pending`. Como o item é idempotente por status e versão, retomar é seguro.
- **Parar:** `/cancel` em `executing` grava `stop_requested`. O laço confere entre itens e fecha `partially_completed`. "O que já foi movido fica onde está."
- Estado final: todos `done` → `completed`; algum `done` e algum `skipped/failed` → `partially_completed`; nenhum `done` → `failed`. O progresso sai em `copilot:proposal_updated`. As mudanças de domínio emitem os eventos que já existem (`deal:stage_changed` e outros), e é isso que faz o quadro animar.
- **Tentar de novo** (`/retry-failed`) cria **outra** proposta só com os itens `failed`/`skipped_conflict`, com versão nova. A trilha fica limpa: uma proposta, uma intenção.

### 4. Desfazer

- `undo_deadline` por origem: nível 2 = 24 h (a interface mostra o anel de 30 s e depois o desfazer fica na Atividade); nível 3 = 24 h; piloto automático = 7 dias; nível 4 = não se aplica, exceto envio **agendado**, que é cancelável até sair.
- `POST /undo` com `Idempotency-Key`. Para cada item `done`, em ordem inversa: confere que o estado atual ainda é o `after` gravado. Se for, aplica `undoItem(undo_payload)` (mover de volta, restaurar tags ou responsável, cancelar compromisso, apagar nota); se não for, marca `undo_conflict`. Resultado: `undone` ou `partially_undone`. Desfazer é uma ação e passa pela permissão da capacidade de quem desfaz.
- Mensagens já enviadas não voltam. A interface diz isso antes do confirmar.

### 5. Nível 4: checagem de política

`policyCheck(items)` devolve linhas `{ key, status: 'ok'|'warn'|'block', label, detail }`: janela de envio (horário do mercado e do workspace), consentimento (`checkOutboundInTx`; quem não tem consentimento vira `skipped_policy` e **não é enviado**), conversa fechada há mais de 24 h exige modelo aprovado, e, para campanha, já enviadas, agendadas e custo já usado. `block` desabilita o confirmar. A checagem é **recalculada no confirmar**. "Saldo de mensagens" não existe no produto e fica fora da v1.

### 6. Contaminação do turno (defesa contra injection)

Ferramenta que devolve texto escrito por contato (mensagens, notas, nome de exibição livre, campos personalizados de texto, conteúdo de KB enviado por terceiros) marca `copilot_turns.tainted = true`. Em turno contaminado, **toda escrita sobe para no mínimo o nível 3**. O motor sabe disso pelo banco, não pelo modelo. Resultado: um texto de cliente não consegue causar sozinho nenhuma mudança sem um clique humano sobre a prévia exata.

### 7. Trilha

Toda transição grava `audit_logs` com `actor_type='copilot'` (ou `autopilot`), `actor_member_id` = permissões usadas, `requested_by_member_id`, `copilot_proposal_id`, `copilot_turn_id` e `metadata { capability, risk_level, counts }`. Não vai PII em `metadata`. A Atividade (A8) é uma **view** sobre `copilot_action_proposals` + itens, e não um log paralelo.

## Alternativas consideradas

- **`interrupt` + `/resume` do LangGraph** (o grafo pausa no checkpoint e retoma depois do "sim"). Rejeitada para a v1:
  1. a execução continuaria passando pelo modelo depois do clique, e o que foi aprovado tem de ser **exatamente** o que roda;
  2. a confirmação pode vir minutos depois, de outro aparelho ou de outra pessoa (aprovador), sem nenhum runtime vivo;
  3. o estado ficaria num checkpoint opaco, e não numa tabela auditável e consultável pela Atividade;
  4. reiniciar o runtime não pode perder propostas.
  Fica para a v1.1, para **planos de vários passos**, que podem ser modelados como sequências de propostas.
- **O modelo informa o nível.** Rejeitada pelo princípio da maquete e por segurança: é o modelo que um texto de cliente pode manipular.
- **Executar o lote numa transação única.** Rejeitada: um item em conflito derrubaria todos, sem "5 de 7". Também seguraria locks durante avisos e emissões.
- **Fila RabbitMQ consumida pelos workers.** Rejeitada para a v1: os executores reusam services de `apps/api`, que os workers não importam (os pacotes são separados). Lease mais varredura dá a mesma garantia de retomada com menos peças. Volta à mesa se o lote máximo passar de 200.

## Consequências

- `@hm/shared` ganha `copilot/risk.ts` e `copilot/capabilities.ts` (F73-S02). Toda capacidade nova entra **primeiro** no catálogo, com nível base, permissão e se tem desfazer.
- O motor (F73-S05) é independente das capacidades. As F73-S08 e S09 registram executores, e o piloto automático (F73-S13) cria propostas `source='autopilot'` pelo mesmo motor.
- A interface (F74-S04) renderiza os quatro tratamentos só a partir do `ProposalDTO`, sem regra de risco no cliente.
- Testes obrigatórios: tabela do classificador; concorrência do confirmar (duas chamadas paralelas → uma execução); conflito por versão; retomada por lease; desfazer com conflito; política recalculada no confirmar; contaminação elevando o nível.
