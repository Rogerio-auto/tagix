---
id: F56-S04
title: Campanhas — hidratar o wizard no modo edição
phase: F56
status: done
priority: high
estimated_size: S
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
completed_at: 2026-07-13T14:26:50Z

---
# F56-S04 — Campanhas: hidratar edição (CAMP-05 / UX-02)

> **Origem:** AUDITORIA_TECNICA.md §3.4/§3.5. `/campaigns/[id]/edit` abre o wizard com defaults vazios e nenhum GET; editar mostra formulário em branco e `PUT /steps` (delete+insert) zera os steps existentes.

## Objetivo

Fazer a edição de campanha carregar os dados reais (nome, tipo, steps, janelas, followups) e permitir navegação livre entre passos sem sobrescrever com rascunho vazio.

## Contexto / causa raiz (verificada)

`apps/web/features/campaigns/editor/CampaignEditor.tsx:66-113` inicializa o `WizardState` com defaults; `editor/queries.ts` só tem mutations, nenhum GET de hidratação. O endpoint `GET /api/campaigns/:id` já retorna campaign+steps+followups.

## Escopo (faz)

- `useCampaignDetail(campaignId)` em `queries.ts` consumindo `GET /api/campaigns/:id`.
- Hidratar o `WizardState` num `useEffect` guardado antes de renderizar em modo edição.
- Em edição: pular a criação, permitir navegar entre passos; não emitir `PUT /steps` com estado vazio.

## Escopo (não faz)

- Preview/test-send/picker de templates (Épico 7).
- Backend de campanhas (outros slots).

## Arquivos permitidos

- `apps/web/features/campaigns/editor/**`

## Arquivos proibidos

- `apps/web/features/campaigns/list/**` · `apps/web/features/campaigns/monitoring/**`

## Definition of Done

- [ ] Abrir "Editar" carrega nome/tipo/steps/janelas reais.
- [ ] Salvar em edição não apaga steps existentes.
- [ ] Estados de loading/erro na hidratação (skeleton + retry), sem tela em branco.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/UX_PRINCIPLES.md)

- Evitar tela em branco/piscar: skeleton do wizard durante a hidratação (§ loading states).
- Erro de carregamento acionável (retry), não "algo deu errado" genérico (§ mensagens de erro).
- Preservar o trabalho do usuário: nunca sobrescrever dados carregados com defaults.

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Guardar o `useEffect` de hidratação para rodar uma vez por `campaignId` (evitar re-hidratar por cima de edições em andamento).
