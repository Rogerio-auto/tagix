---
id: F30-S05
title: Agent-runtime — retomada consciente de contexto (handoff)
phase: F30
status: blocked
priority: high
estimated_size: M
depends_on: [F30-S01]
agent_id: python-engineer
source_docs:
  - docs/features/LIVECHAT_OPS.md
  - docs/ARCHITECTURE.md
---

# F30-S05 — Retomada consciente de contexto no agent-runtime

> **source_docs:** `docs/features/LIVECHAT_OPS.md` §2
> **blocks:** F30-S06

## Objetivo

Fazer a IA **nunca retomar cega**: quando ela volta a atuar numa conversa que teve atendimento humano, o builder de contexto rotula a autoria de cada mensagem (`human | ai | contact`) e injeta uma diretriz de handoff no prompt, para a IA continuar com consciência (encerrar, follow-up ou reengajar) em vez de atropelar.

## Contexto

O grafo LangGraph já carrega histórico em `load_context.py` e monta o prompt em `build_prompt.py`. Hoje as mensagens entram sem distinção clara de quem é humano vs IA. Este slot adiciona a rotulagem + diretriz, ativada quando há sinal de takeover humano (`ai_paused_reason='human_takeover'` / presença de mensagens de membro).

## Escopo (faz)

- `apps/agent-runtime/app/nodes/load_context.py` (editar) — ao carregar mensagens, anexar `author_role` (`human|ai|contact`) por mensagem (deriva de `messages.sender_type`/origem); detectar se houve takeover humano na thread.
- `apps/agent-runtime/app/nodes/build_prompt.py` (editar) — quando houve atendimento humano, injetar bloco de sistema de handoff ("um atendente humano assumiu parte desta conversa; retome com consciência — encerre, faça follow-up ou reengaje sem repetir o humano"). Marcar a autoria nas mensagens renderizadas no prompt.
- Testes: `apps/agent-runtime/tests/test_handoff_context.py` (novo) — contexto com mensagens humanas → prompt contém rótulos de autoria + diretriz; conversa só-IA → sem diretriz.

## Fora de escopo

- Disparo do reengajamento (S06 enfileira o run).
- Auto-pausa no envio (S04).
- Mudança de schema (colunas já vêm de S01).

## Arquivos permitidos

- `apps/agent-runtime/app/nodes/load_context.py`
- `apps/agent-runtime/app/nodes/build_prompt.py`
- `apps/agent-runtime/tests/test_handoff_context.py`

## Arquivos proibidos

- Outros nós do grafo, tools, policy; `apps/**` fora de agent-runtime; `packages/**`.

## Definition of Done

- [ ] Mensagens rotuladas por autoria no contexto/prompt.
- [ ] Diretriz de handoff injetada só quando houve humano na thread.
- [ ] Testes pytest passam; sem regressão no grafo existente.

## Validação

```bash
cd apps/agent-runtime && uv run pytest tests/test_handoff_context.py -q
```

## Notas

- Especialista: **python-engineer**. Não acoplar a colunas que não existam — usar `messages.sender_type`/`from` já presente; `ai_paused_reason` é dica adicional, não requisito.
- Manter o prompt enxuto: a diretriz é curta e objetiva, não um ensaio (custo/tokens).
