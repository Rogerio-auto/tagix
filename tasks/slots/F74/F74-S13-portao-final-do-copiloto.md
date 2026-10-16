---
id: F74-S13
title: Portão final do Copiloto (e2e da jornada, axe nos dois temas, capturas 1440 e 375, peso, hm-designer e hm-qa)
phase: F74
status: blocked
priority: high
estimated_size: M
model: opus
ui: true
depends_on: [F74-S12, F73-S14, F73-S15]
blocks: [F73-S16]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: qa-engineer
---
# F74-S13 — Portão final

## Objetivo

Antes de ligar o Copiloto para qualquer cliente, provar que a experiência inteira está pronta:

- a jornada roda ponta a ponta;
- a acessibilidade passa nos dois temas;
- as capturas batem com a maquete;
- o peso cabe no orçamento;
- a revisão de gosto aprova.

O resultado é um parecer de QA com o que falta, se faltar.

## Escopo (faz)

- `apps/web/e2e/specs/copilot-journey.spec.ts` (API mockada pelo `copilot-mock`, determinística, roda no CI). Uma jornada de gestora e uma de atendente:
  1. login → briefing abre sozinho e efêmero → ação de um item;
  2. pipeline → arrastar a alça → "o que está travando o funil?" → parecer com cartões e fonte;
  3. "mover parados há 7 dias para Reativação" → cartão nível 3 → Ajustar (tirar 1) → Confirmar → progresso → concluído → Desfazer;
  4. "enviar lembrete da avaliação de amanhã" → nível 4 → só libera com "Revisei";
  5. ⌘K → pergunta sem destino → balão com o chip;
  6. tela cheia → Atividade mostra os 3 → Desfazer;
  7. memória: esquecer um fato;
  8. atendente: "cancelar a campanha" → bloqueio por papel → "Pedir à Bruna";
  9. empresa em só leitura → consultas funcionam, ações bloqueadas;
  10. celular 375: folha 78% → ação em tela cheia.
- Varredura `axe` (fixture `apps/web/e2e/fixtures/a11y.ts`) em todas as telas e estados do Copiloto, **nos dois temas**.
- Capturas 1440 e 375, dark e light, de A1–A12, em `apps/web/e2e/.artifacts/f74-final/`, lado a lado com as da maquete (`docs/design/copilot-integracoes/`).
- Peso: `pnpm --filter @hm/web build`. First Load JS compartilhado + ≤ 5 KB gz em relação à main antes da F74; chunk do Copiloto ≤ 60 KB gz; relatório na nota.
- Desempenho: INP do gesto e da troca FLIP com CPU 4× mais lenta (sem quadro longo > 50 ms); LCP da Home sem regressão > 50 ms.
- `/hm-designer` sobre o conjunto contra a maquete. `/hm-qa` com os gaps. Correções pontuais em arquivos da F74 com nota de correção (padrão F71-S10); o que for grande vira slot novo.
- Ajustar `apps/web/e2e/fixtures/copilot-mock.ts` só se faltar algo no mock.

### files_allowed

- `apps/web/e2e/specs/copilot-journey.spec.ts`
- `apps/web/e2e/fixtures/copilot-mock.ts`
- `apps/web/e2e/fixtures/a11y.ts`
- `docs/a11y/**`
- correções pontuais em arquivos de slots F74 já concluídos, com nota de correção

### files_forbidden

- `apps/api/**`
- `packages/db/**`

## Definition of Done

- [ ] Jornada e2e verde com `--workers=1` (3 rodadas seguidas sem flake)
- [ ] axe sem violação séria em todas as telas, nos dois temas; relatório em `docs/a11y/`
- [ ] Capturas completas e comparadas; `/hm-designer` APROVADO (com as correções feitas)
- [ ] Orçamentos de peso e desempenho cumpridos, com números na nota
- [ ] Parecer `/hm-qa` registrado, sem bloqueador aberto
- [ ] O portão de segurança F73-S14 está `done`: sem ele o Copiloto não é ligado

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot --maxWorkers=1
pnpm --filter @hm/web build
```

## Notas

- Agentes: `qa-engineer` (jornada, axe, peso) com revisão `/hm-designer` (gosto). Sozinho no lote.
- O e2e da jornada não entra no `slot.py validate` (precisa de servidor). Rode com `pnpm --filter @hm/web exec playwright test e2e/specs/copilot-journey.spec.ts --workers=1` e registre o resultado.
