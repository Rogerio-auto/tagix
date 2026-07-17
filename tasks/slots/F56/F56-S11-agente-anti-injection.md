---
id: F56-S11
title: Agente IA — anti-prompt-injection + moderação de entrada/saída
phase: F56
status: done
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: python-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-17T22:28:44Z

---
# F56-S11 — Guardrails conversacionais da IA (AG-05)

> **Origem:** AUDITORIA_TECNICA.md §3.3. Histórico e `custom_fields` do contato entram dentro do system prompt como texto livre, sem delimitação — prompt injection ("ignore as instruções…") em contexto de alta autoridade; sem moderação.

## Objetivo

Reduzir a superfície de manipulação conversacional: separar dados não-confiáveis do system prompt e adicionar moderação/anti-injection.

## Contexto / causa raiz (verificada)

`apps/agent-runtime/app/nodes/build_prompt.py:69-73,116-170` monta `[Cliente] <conteúdo>` e `json.dumps(custom_fields)` dentro do system prompt; grep de moderação/injection = só redaction de log.

## Escopo (faz)

- Mover o histórico do contato para mensagens `user`/`assistant` reais (fora do system prompt), com marcação clara de dados não-confiáveis.
- Delimitadores + instrução anti-injection no system prompt base.
- Moderação leve de entrada/saída (`apps/agent-runtime/app/guards/**`), configurável por workspace (no-op se desligada).

## Escopo (não faz)

- Coluna vision / clamp de tokens / latency (F56-S01 — `load_context/call_model/finalize.py`, disjunto).
- Versionamento de prompt (F56-S30).

## Arquivos permitidos

- `apps/agent-runtime/app/nodes/build_prompt.py`
- `apps/agent-runtime/app/guards/**`
- `apps/agent-runtime/tests/test_guardrails.py`
- `apps/agent-runtime/tests/test_build_prompt.py`

## Arquivos proibidos

- `apps/agent-runtime/app/nodes/load_context.py` · `call_model.py` · `finalize.py` (F56-S01)
- `apps/agent-runtime/tests/test_load_context.py` · `test_call_model.py` · `test_finalize.py` (F56-S01)

## Definition of Done

- [ ] Conteúdo do contato não altera as instruções de sistema num teste de injeção conhecido.
- [ ] Histórico do contato entra como turnos `user`/`assistant`, não no system prompt.
- [ ] Moderação plugável, desligada por default, testada.
- [ ] `uv run pytest` verde.

## Validação

```bash
cd apps/agent-runtime && uv run pytest
```

## Notas

- Compartilha o diretório `nodes/` com F56-S01 mas arquivos disjuntos (`build_prompt.py` aqui, os outros lá). `tests/**` é compartilhado — nomeie os testes deste slot com prefixo próprio (`test_guardrails_*`) para evitar colisão de arquivo.
