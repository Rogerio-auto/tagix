---
id: F74-S08
title: Memória do negócio na interface (perfil editável, fatos com fonte, Corrigir, Esquecer, Ensinar, fontes conectadas) (A10)
phase: F74
status: blocked
priority: medium
estimated_size: M
model: sonnet
ui: true
depends_on: [F74-S01]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
agent_id: frontend-engineer
---
# F74-S08 — Memória do negócio

## Objetivo

O que o Copiloto sabe sobre a empresa, tudo à vista em `/copiloto/memoria`:

- perfil escrito pela equipe (o que vende, ticket médio, tom de voz, horário, regras comerciais), editável inline;
- fatos com a fonte e os botões Corrigir e Esquecer (efeito imediato, com Desfazer por 24 h);
- "Ensinar um fato";
- fontes conectadas com o estado de cada uma.

"O Copiloto não usa nada fora desta lista, nem dados de outras empresas."

## Escopo (faz)

- `apps/web/app/(app)/copiloto/memoria/page.tsx` + `apps/web/features/copilot/memory/**`:
  - `ProfileCard`: 5 campos com Editar inline (≤ 500 caracteres, contador perto do fim), salvar com Enter ou ⌘Enter, cancelar com Esc; só com `copilot.memory.edit`; os outros veem sem botões;
  - `FactsList`: fato, "Fonte: …", Corrigir (abre um campo com o texto atual e salva como fato escrito pela pessoa, que tem prioridade) e Esquecer (risca e mostra "Esquecido agora. Não será usado em novas respostas." com Desfazer, que restaura até 24 h); contagem em mono; paginação;
  - `TeachFact`: diálogo "Ensinar um fato" (≤ 300 caracteres, exemplo de bom fato, aviso de limite de 200 ativos);
  - `SourcesCard`: Conhecimento, Produtos, Pipeline e Inbox com o estado, e as integrações da F75 quando existirem (pelo `listMemorySources`); selos `ok`/`warn`/`danger` com texto;
  - nota fixa no rodapé: "O Copiloto não usa nada fora desta lista, nem dados de outras empresas.".
- `apps/web/e2e/specs/copilot-memory.spec.ts`: editar perfil; ensinar; corrigir; esquecer e desfazer; AGENT sem botões de edição.

### files_allowed

- `apps/web/app/(app)/copiloto/memoria/**`
- `apps/web/features/copilot/memory/**`
- `apps/web/e2e/specs/copilot-memory.spec.ts`

## Definition of Done

- [ ] Fiel à A10 nos dois temas; capturas 1440 e 375 em `apps/web/e2e/.artifacts/f74-s08/`
- [ ] Esquecer e Corrigir com feedback imediato e anúncio por `aria-live`
- [ ] Permissões: sem `copilot.memory.edit` nenhuma ação de escrita aparece
- [ ] axe sem violação séria; `/hm-designer` contra A10

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/memory --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/memory "apps/web/app/(app)/copiloto/memoria" --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`. A página renderiza dentro do layout de abas do S07 quando ele existir; até lá funciona sozinha.
