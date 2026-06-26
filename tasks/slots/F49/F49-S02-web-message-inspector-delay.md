---
id: F49-S02
title: Inspector do nó de mensagem — campo de delay + teto de 30s na pré-ação
phase: F49
status: done
priority: high
estimated_size: XS
depends_on: [F49-S01]
blocks: []
agent_id: frontend-engineer
source_docs:
  - docs/features/FLOW_BUILDER.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-06-26T16:06:46Z
completed_at: 2026-06-26T16:10:08Z

---
# F49-S02 — Inspector: campo de delay + enforcement do teto da pré-ação

## Objetivo

Expor no inspector do nó de mensagem um campo **"Aguardar antes de enviar"** que grava `delayMs`
(espera não-bloqueante, sem teto prático) e **impor de verdade o teto de 30s** na duração da pré-ação
(hoje o campo aceita 88s mas o runtime corta — a UI mente). Fecha o gap de contrato entre o que o usuário
configura e o que o worker faz (F49-S01).

## Contexto

`MessageInspector.tsx:270-282` deixa digitar qualquer valor em "Duração (segundos)" (sem `max`), com hint
"máx. 30s" — mas o handler clampa em 30s silenciosamente. O delay longo agora tem campo próprio
(`delayMs`, F49-S01). Reusar `NumberField` (`inspector-fields.tsx`); seguir DS v2 (sem hex).

## Escopo (faz)

- `MessageInspector.tsx`:
  - Novo `NumberField` "Aguardar antes de enviar (segundos)" → grava `delayMs` (segundos × 1000;
    vazio/0 ⇒ `undefined`). Hint: "Espera antes de enviar esta mensagem. Não bloqueia o atendimento;
    use para espaçar mensagens. Sem limite prático."
  - Pré-ação "Duração (segundos)": clampar `onChange` em **30s** (`Math.min(v, 30)`) e refletir o teto
    no hint. O valor persistido nunca excede `30_000`.
- `inspector-fields.tsx`: `NumberField` ganha props opcionais `min`/`max` repassadas ao `<input>`
  (retrocompatível — sem `max` o comportamento é o atual). Sem quebrar os demais consumidores.

## Fora de escopo

- Lógica de runtime do delay (F49-S01).
- Migração/normalização de nós legados no editor (a compat é em runtime; o inspector só impede NOVOS
  valores acima de 30s na pré-ação).

## Arquivos permitidos

- `apps/web/features/flow-builder/nodes/message/MessageInspector.tsx`
- `apps/web/features/flow-builder/nodes/inspector-fields.tsx`

## Arquivos proibidos

- `packages/flow-engine/**` (F49-S01)
- Qualquer outro inspector que consuma `NumberField` (mudança deve ser retrocompatível)

## Contratos de entrada/saída

- Grava `node.data.delayMs` (ms) e mantém `node.data.preActionDurationMs <= 30_000`.
- `NumberField` aceita `min?: number` e `max?: number` (atributos nativos do `<input type=number>`).

## Definition of Done

- [ ] Campo "Aguardar antes de enviar" grava `delayMs` em ms; vazio/0 limpa o campo (`undefined`).
- [ ] Duração da pré-ação não persiste valor > 30s (clamp no `onChange`, `max=30` no input).
- [ ] `NumberField` segue funcionando para os demais inspectors (props novas opcionais).
- [ ] Sem hex hardcoded; tokens DS v2.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web test` verdes; build do web ok.

## UX considerations

- **Honestidade de estado (UX_PRINCIPLES §2):** o controle não pode aceitar um valor que o sistema
  ignora — por isso o teto de 30s é imposto no input, não só no hint (anti-padrão: UI que mente).
- **Hierarquia/clareza (§3):** separar visualmente "Aguardar antes de enviar" (espaçamento real) de
  "Pré-ação/Duração" (indicador cosmético) para o usuário não confundir os dois delays.

## Validação

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

- `30` (segundos) espelha `MESSAGE_PRE_ACTION_MAX_MS` (30_000ms) do F49-S01; manter como constante local
  com comentário apontando a fonte (web não importa o handler da engine).
- e2e não hidrata neste host (memória [[e2e-no-hydration-this-host]]): validar por typecheck/lint/test/build.
