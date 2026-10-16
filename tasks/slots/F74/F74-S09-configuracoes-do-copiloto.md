---
id: F74-S09
title: Configurações do Copiloto (abrir ao entrar, capacidades × papel, quem pode usar, orçamento mensal, histórico) (A11)
phase: F74
status: blocked
priority: medium
estimated_size: M
model: sonnet
ui: true
depends_on: [F74-S01, F74-S04]
blocks: [F74-S12]
source_docs:
  - docs/features/COPILOTO.md
  - docs/design/copilot-integracoes-ux.md
  - docs/design/copilot-integracoes.html
  - docs/features/PERMISSIONS.md
agent_id: frontend-engineer
---
# F74-S09 — Configurações

## Objetivo

Quem pode administrar (OWNER e ADMIN, `copilot.manage`) decide:

- o padrão de "Abrir ao entrar";
- o que o Copiloto pode fazer por papel. A matriz só **restringe**: nunca libera o que o papel não tem;
- quem pode usar;
- o orçamento mensal e o que acontece no teto;
- por quanto tempo o histórico fica guardado.

O custo aparece só para quem pode agir sobre ele (A11).

## Escopo (faz)

- `apps/web/features/copilot/settings/**`:
  - `CopilotSettings.tsx`, com 5 seções na ordem da A11:
    1. **Abrir ao entrar** (`default_auto_open`; radio cards: Toda vez · Uma vez por dia (padrão) · Nunca).
    2. **O que ele pode fazer**: tabela das capacidades do catálogo (`CAPABILITY_LABELS_PT`) × os **5 papéis reais** (OWNER, ADMIN, SUPERVISOR, AGENT, READONLY, com rótulos do produto), com `RiskMeter` (S04) por linha.
       - Célula sem permissão no papel: traço com tooltip "O papel não permite"; não é switch.
       - Escopo fino em texto ("só os seus" para AGENT em mover negócios).
       - `role="switch"` com `aria-label` "<capacidade> para <papel>".
    3. **Quem pode usar**: um switch por papel e "Agência parceira" (desligado; desabilitado com "em breve").
    4. **Orçamento mensal**: teto em US$ por enquanto (o formato de moeda segue a decisão de preço; ver Notas), medidor de uso (`getUsage`), "renova em 1º de …", aviso em 80%, e o comportamento no teto (manter só consultas, recomendado, ou pausar).
    5. **Histórico**: 6/12/24 meses e "Exportar atividade" (CSV, S05 da F73).
  - Salvar por seção com `updateSettings`; erro inline; confirmação de mudança que **reduz** permissões ("Atendentes deixam de poder mover negócios pelo Copiloto").
- Rotas de entrada:
  - `apps/web/app/(app)/copiloto/configuracoes/page.tsx` (aba do S07);
  - seção `copiloto` em `apps/web/features/settings/shell/registry.tsx`, para abrir em `/settings?s=copiloto` no painel de configurações existente, visível só com `copilot.manage`.
- `apps/web/e2e/specs/copilot-settings.spec.ts`: OWNER muda a matriz e o orçamento; ADMIN vê; SUPERVISOR e AGENT não acessam (rota → 403 amigável e seção ausente); célula sem permissão do papel não é switch.

### files_allowed

- `apps/web/features/copilot/settings/**`
- `apps/web/app/(app)/copiloto/configuracoes/**`
- `apps/web/features/settings/shell/registry.tsx`
- `apps/web/e2e/specs/copilot-settings.spec.ts`

## Definition of Done

- [ ] Fiel à A11 nos dois temas; capturas 1440 e 375 (a tabela em `ResponsiveTable` no celular) em `apps/web/e2e/.artifacts/f74-s09/`
- [ ] A matriz nunca oferece switch para o que `can()` nega (teste de componente para os 5 papéis)
- [ ] Custo só para OWNER e ADMIN (o servidor já não envia; a interface não quebra sem o campo)
- [ ] axe sem violação séria; `/hm-designer` contra A11

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web exec vitest run features/copilot/settings features/settings --maxWorkers=1
pnpm exec eslint apps/web/features/copilot/settings "apps/web/app/(app)/copiloto/configuracoes" apps/web/features/settings/shell/registry.tsx --max-warnings=0
```

## Notas

- Agente: `frontend-engineer`.
- A maquete mostra o teto em R$ 150. A moeda e o modelo (teto em R$, créditos por plano ou ilimitado no plano alto) são **decisão em aberto do Rogério**. Implemente o campo com `Intl.NumberFormat` e a moeda vinda da API, para trocar sem refazer a tela.
- "Animações do Copiloto" (Vivas, Discretas, Desligadas) é preferência pessoal da F76 e não entra aqui.
