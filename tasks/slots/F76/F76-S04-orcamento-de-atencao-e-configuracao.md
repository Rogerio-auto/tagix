---
id: F76-S04
title: Diretor do orçamento de atenção com persistência por membro e a configuração Animações do Copiloto
phase: F76
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F76-S03, F73-S02]
blocks: [F76-S05, F76-S08]
source_docs:
  - docs/features/MASCOTE_ANIMACOES.md
  - docs/decisions/ADR-006-mascote-personagem-tecnologia-e-politicas.md
  - docs/design/copilot-botao-animacao.md
agent_id: frontend-engineer
---
# F76-S04 — Orçamento de atenção

## Objetivo

O personagem só chama a pessoa quando ela pode ser chamada, dentro de cotas, aprendendo quando é ignorado e
ficando quieto com quem já usa o Copiloto — e a pessoa escolhe Vivas, Discretas ou Desligadas.

## Contexto

Regras e números: ADR-006 §4 (portões, cotas, aprendizado, formada, silenciada). Implementação e formato de
persistência: spec §4. Sem tabela nova: `members.notification_prefs.copilot` com rota própria que faz merge.

## Escopo (faz)

- `packages/shared/src/mascot/attention.ts`: Zod `CopilotPrefsSchema` (o objeto `copilot` da spec §4, ≤ 4 KB,
  listas com teto), `defaultCopilotPrefs`, e a **lógica pura** do orçamento: `evaluate(state, signals, now,
  request) → { decision: 'call'|'sweep'|'signal_only'|'queue'|'drop', nextState }` com todos os números do
  ADR-006 §4 como constantes nomeadas exportadas; virada de dia no fuso do membro.
- `apps/api/src/routes/members/copilot.ts` + uma linha em `apps/api/src/routes/members/index.ts`:
  `GET /api/members/me/copilot` e `PUT /api/members/me/copilot` (Zod estrito, merge com `jsonb_set` em
  `notification_prefs->'copilot'`, nunca sobrescreve `in_app/email/push/sound`, sob `req.scoped`, 30 req/min).
- `apps/web/features/copilot/attention/`:
  - `useAttentionDirector()` (spec §4): sinais do navegador (visibilidade, viewport do botão via ref, último
    `pointermove`/`keydown` — só timestamps —, foco em campo editável, `[aria-modal="true"]`, ponteiro
    pressionado, arrasto, início da sessão em `sessionStorage`), fila com prioridade erro > briefing > sugestão e
    validade de 10 min, timers que não rodam com aba oculta;
  - API para a F74/F75: `notify({ kind, key })`, `markOpened()`, `markActionDone()`;
  - saída `{ mascotState, sweep, signal, statusLine? }`;
  - persistência: `localStorage` `hm:copilot:<memberId>` + `BroadcastChannel('hm-copilot')` entre abas +
    `PUT` com debounce de 5 s e `sendBeacon` em `pagehide`; conflito entre dispositivos ⇒ maior contador do dia;
  - `useCopilotMotion()`: preferência + `prefers-reduced-motion` (sem escolha explícita ⇒ Discretas).
- Configurações: `apps/web/features/settings/sections/personal/AnimationsSection.tsx` registrada em
  `apps/web/features/settings/shell/registry.tsx` (grupo `pessoal`, id `animacoes`, rótulo "Animações do
  Copiloto", keywords `animação, movimento, mascote, personagem`): três opções em `radiogroup` com prévia ao vivo
  do `Mascot` `md` (acenando uma vez em Vivas, só glifo em Discretas, parado em Desligadas) e o aviso de
  movimento reduzido do sistema.
- Testes: lógica pura cobrindo cada regra do ADR-006 §4 com relógio falso (portões, 2/dia ambiente com 12 min,
  teto 4, varredura 10/dia com 6 min, 2 ignoradas ⇒ ×2 até ×4, 4 em 7 dias ⇒ silenciada 7 dias, formada com 3 de
  7, ação concluída não gasta cota, erro não conta como ignorada); rota com merge sem perder `sound`; hook com
  sinais simulados.

## Fora de escopo

- O botão e a alça (S05). Telemetria (S08).

### files_allowed

- `packages/shared/src/mascot/**`
- `packages/shared/src/index.ts`
- `apps/api/src/routes/members/copilot.ts`
- `apps/api/src/routes/members/copilot.test.ts`
- `apps/api/src/routes/members/index.ts`
- `apps/web/features/copilot/attention/**`
- `apps/web/features/settings/sections/personal/AnimationsSection.tsx`
- `apps/web/features/settings/sections/personal/AnimationsSection.test.tsx`
- `apps/web/features/settings/shell/registry.tsx`

## Definition of Done

- [ ] cada regra numérica do ADR-006 §4 tem teste nomeado com ela
- [ ] `PUT /api/members/me/copilot` não altera `notification_prefs.sound` nem as chaves gerais (teste)
- [ ] duas abas: chamada numa aba conta na outra (teste com `BroadcastChannel` simulado)
- [ ] digitando, com modal aberto ou nos 3 primeiros minutos: nenhuma chamada (teste)
- [ ] seção "Animações do Copiloto" acessível por teclado, axe sem violação séria, capturas 375/1440 × 2 temas
- [ ] revisão `/hm-designer` da seção

## Validação

```bash
pnpm --filter @hm/shared typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
pnpm --filter @hm/shared exec vitest run src/mascot --maxWorkers=1
node --env-file=.env apps/api/node_modules/vitest/vitest.mjs run --root apps/api src/routes/members/copilot.test.ts --maxWorkers=1
pnpm --filter @hm/web exec vitest run features/copilot/attention features/settings/sections/personal --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer` (a rota de API é pequena e segue o padrão de `routes/members/me.ts`).
- `registry.tsx` e `routes/members/index.ts` são disputados (a F74 pode registrar "Copiloto" nas configurações):
  uma entrada/linha cada; sequenciar se houver slot aberto.
- Por que `notification_prefs` e não tabela: ADR-006 §6.
