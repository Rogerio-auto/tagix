---
id: F35-S03
title: Board — seletor de pipeline melhorado + empty state + CTA criar
phase: F35
status: blocked
priority: medium
estimated_size: S
depends_on: [F35-S01]
blocks: []
source_docs:
  - docs/features/PIPELINE.md

---
# F35-S03 — Board UX: seletor + empty state + CTA criar

## Objetivo

Melhorar a experiência do board de pipeline: seletor com contador de uso/limite visível, botão "+ Nova pipeline" acessível sem sair do board, e empty state quando não há pipelines criadas.

## Contexto

`PipelinePage.tsx` tem um dropdown de seleção de pipeline. Com o CRUD habilitado (S01), o usuário precisa de um ponto de entrada rápido para criar pipelines também no contexto do board — sem ter que navegar para Settings. S01 criou as mutations reutilizáveis (`useCreatePipeline`, etc.) e S02 expõe `meta.limit` e `meta.current` no `GET /api/pipelines`.

## Escopo (faz)

- **`apps/web/features/pipeline/board/PipelinePage.tsx`**:
  - **Header atualizado:** ao lado do dropdown de seleção, adicionar botão `+ Nova pipeline` (ícone `Plus`, estilo secundário). Ao clicar: abre o mesmo modal de criação de S01 (extraído como `<CreatePipelineModal>`). Botão desabilitado com tooltip quando `meta.current >= meta.limit`.
  - **Contador de uso:** abaixo/ao lado do dropdown, exibir chip discreto `2 / 10 pipelines` quando o workspace tiver >= 2 pipelines (não exibir para workspaces com 1 — reduz ruído).
  - **Empty state:** quando `usePipelines()` retorna `data: []`, renderizar tela vazia central com:
    - Ícone de pipeline (Lucide `Layers`)
    - Título: "Nenhuma pipeline criada ainda"
    - Subtítulo: "Crie sua primeira pipeline de vendas para começar a organizar seus deals."
    - Botão primário: "Criar pipeline" → abre modal de criação.
  - Após criar pipeline via modal no board: navegar automaticamente para a nova pipeline.

- **`apps/web/features/pipeline/board/queries.ts`** — ajustar `usePipelines()` para ler `response.data` (quebra introduzida pelo S02 ao adicionar `meta`).

## Fora de escopo

- Reordenar pipelines no dropdown
- Editar/deletar pipeline a partir do board (fluxo correto é Settings)

## Arquivos permitidos

- `apps/web/features/pipeline/board/PipelinePage.tsx`
- `apps/web/features/pipeline/board/queries.ts`

## Arquivos proibidos

- `apps/web/features/pipeline/settings/**` (pertence ao S01)
- `apps/api/**`

## Definition of Done

- [ ] Board com 0 pipelines exibe empty state com CTA.
- [ ] Header do board exibe botão "+ Nova pipeline"; abre modal de criação.
- [ ] Botão desabilitado com tooltip quando limite atingido.
- [ ] Chip de uso (`N / 10 pipelines`) visível quando N >= 2.
- [ ] `usePipelines()` lê `response.data` (compatível com novo shape de S02).
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Chip de uso: tipografia `text-xs text-muted`, não destaque — informação, não aviso.
- Tooltip no botão desabilitado: "Limite de 10 pipelines atingido. Exclua uma para criar outra."
- Empty state: centralizado verticalmente no board, ícone 48px, não bloqueia o header.
- Modal de criação: reutilizar exatamente o componente criado no S01 (não duplicar).

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

O `<CreatePipelineModal>` deve ser extraído de `PipelineSettingsPage.tsx` para um componente compartilhado em `apps/web/features/pipeline/shared/` ou inline importado do módulo de settings — coordenar com S01 para que o componente seja exportado e reutilizável. S03 não pode tocar arquivos de S01; S01 deve garantir a exportação.
