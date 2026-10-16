---
id: F74-S11
title: Piloto automático na interface (aba Sugestões do Copiloto no pipeline, aprovar e recusar em lote, autonomia por estágio) (A9)
phase: F74
status: blocked
priority: high
estimated_size: M
model: sonnet
ui: true
depends_on: [F74-S01, F74-S04]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S11 — Piloto automático (interface)

## Objetivo

Em `/pipeline/sugestoes`, a fila mostra cada movimentação proposta com o motivo em linguagem de negócio, a confiança visível e o destino. A pessoa aprova ou recusa uma a uma ou em lote, e baixa confiança não entra no "aprovar todos". À direita, cada estágio tem o seu nível de autonomia: Desligado, Só sugerir ou Aprovação diária. "Mover sozinho" aparece como **em breve** (v1.1).

## Escopo (faz)

- `apps/web/app/(app)/pipeline/sugestoes/page.tsx` + `apps/web/features/copilot/autopilot/**`:
  - `SuggestionsQueue`:
    - lista (`listSuggestions`), com o negócio (contato, título, valor em mono), o estágio atual → destino, o motivo ("Sem resposta há 14 dias; a última mensagem foi nossa, em 02/10") e a confiança como selo de texto (Alta, Média, Baixa) e barra, nunca número cru;
    - checkbox por linha; "Aprovar selecionadas", com as baixas desmarcadas por padrão, e "Recusar";
    - aprovar chama `decideSuggestions`. O resultado vem como recibo com Desfazer (o mesmo `ActionReceipt`/`BatchActionCard` do S04, com desfazer por 7 dias) e "aprovadas 7, puladas 1 (editada por Paula)";
    - vazio: "Nenhuma sugestão agora" + quando o piloto roda de novo;
  - `StageAutonomy`: por estágio, um controle segmentado (Desligado · Só sugerir · Aprovação diária · Mover sozinho *em breve*, desabilitado com tooltip) e critérios editáveis (dias sem resposta, destino, "só se a última mensagem foi nossa"). Só com `copilot.autopilot.manage`; os outros veem em leitura. Mostra "Ligado por Bruna em 10/10";
  - "Aprovação diária junta as sugestões às 9h, no Briefing" como ajuda curta.
- Entrada a partir do Pipeline: aba ou link "Sugestões do Copiloto" com contagem (`pending.suggestions`) no cabeçalho de `apps/web/features/pipeline/board/PipelinePage.tsx`, uma alteração mínima. Some se `available=false`.
- `apps/web/e2e/specs/copilot-autopilot.spec.ts`: aprovar 3 (as baixas desmarcadas); recusar; desfazer a aprovação; mudar a autonomia (OWNER) e leitura (AGENT); "Mover sozinho" desabilitado.

### files_allowed

- `apps/web/app/(app)/pipeline/sugestoes/**`
- `apps/web/features/copilot/autopilot/**`
- `apps/web/features/pipeline/board/PipelinePage.tsx`
- `apps/web/e2e/specs/copilot-autopilot.spec.ts`

### files_forbidden

- `apps/web/features/copilot/actions/**` (só importar)

## Definition of Done

- [ ] Fiel à A9 nos dois temas; capturas 1440 e 375 em `apps/web/e2e/.artifacts/f74-s11/`
- [ ] Baixa confiança nunca selecionada por padrão (teste)
- [ ] Desfazer da aprovação com janela de 7 dias exibida
- [ ] Permissões: AGENT vê só as sugestões do seu escopo (vêm filtradas) e não muda a autonomia
- [ ] Testes existentes do pipeline verdes (`features/pipeline`)
- [ ] axe sem violação séria; `/hm-designer` contra A9

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/autopilot features/pipeline --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/autopilot "apps/web/app/(app)/pipeline/sugestoes" apps/web/features/pipeline/board/PipelinePage.tsx --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`.
- Motivo em linguagem de negócio é regra de produto: se o backend mandar algo técnico, reporte em `tasks/COMMS.md` e não traduza no cliente.
