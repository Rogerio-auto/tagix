---
id: F35-S01
title: CRUD de pipelines na Settings + mutations reutilizáveis
phase: F35
status: done
priority: high
estimated_size: M
depends_on: []
blocks: [F35-S03]
source_docs:
  - docs/features/PIPELINE.md
agent_id: backend-engineer
claimed_at: 2026-06-16T13:31:50Z
completed_at: 2026-06-16T13:41:04Z

---
# F35-S01 — CRUD de pipelines na Settings

## Objetivo

Permitir que o usuário crie, renomeie e exclua suas próprias pipelines diretamente na página de Settings, usando os endpoints que já existem (`POST/PUT/DELETE /api/pipelines`). Inclui as mutations reutilizáveis em `queries.ts` que S03 vai consumir.

## Contexto

`PipelineSettingsPage.tsx` já gerencia stages (criar/editar/deletar/reordenar) mas a pipeline em si é imutável — o dropdown só lista, sem botão de criar ou deletar. Os endpoints existem desde a F5. O backend valida o limite (S02 em paralelo) e retorna `422 pipeline_limit_reached` quando excedido.

Templates de seed disponíveis: `real_estate` ("Funil Imobiliário") e `clinic` ("Funil Clínica"). Ao criar uma pipeline, o usuário pode escolher partir de um template (com stages pré-definidas) ou criar em branco (e adicionar stages manualmente depois).

## Escopo (faz)

### `apps/web/features/pipeline/board/queries.ts`
Adicionar mutations:
- `useCreatePipeline()` — `POST /api/pipelines` com body `{ name, template?: 'real_estate' | 'clinic' }`. No success: invalidar `pipelineKeys.list()` e navegar para o novo pipeline. Em 422 com `pipeline_limit_reached`: expor mensagem de limite para o formulário.
- `useUpdatePipeline()` — `PUT /api/pipelines/:id` com `{ name }`. No success: invalidar detail + list.
- `useDeletePipeline()` — `DELETE /api/pipelines/:id`. No success: invalidar list + redirecionar para o primeiro pipeline disponível.

### `apps/web/features/pipeline/settings/PipelineSettingsPage.tsx`
- **Header da settings page:** mostrar nome da pipeline selecionada com botão de editar (ícone pencil inline → input in-place), botão "+ Nova pipeline" e botão de deletar (trash, vermelho, só habilitado se não for a única pipeline).
- **Modal "Nova pipeline"** — campos: nome (obrigatório, 1-160 chars), template (radio: "Em branco" / "Funil Imobiliário" / "Funil Clínica"). Botão Criar. Exibir alerta de limite quando o backend retornar 422.
- **Confirmação de exclusão** — Dialog com aviso: "Todos os deals e estágios serão excluídos permanentemente. Esta ação não pode ser desfeita." + campo de confirmação digitando o nome da pipeline (pattern: nome exato). Botão "Excluir pipeline" vermelho.
- **Edição de nome** — inline: clique no nome → input; blur ou Enter salva via `useUpdatePipeline`.
- Após criar: auto-selecionar a nova pipeline no dropdown.
- Após deletar: selecionar o primeiro pipeline restante.

## Fora de escopo

- Transition rules / automation rules UI (complexidade própria)
- Custom fields editor (já existe `CustomFieldsEditor.tsx`, integração é S03 ou future)
- Reordenar pipelines
- Duplicar pipeline

## Arquivos permitidos

- `apps/web/features/pipeline/board/queries.ts`
- `apps/web/features/pipeline/settings/PipelineSettingsPage.tsx`
- `apps/web/features/pipeline/settings/**` (novos subcomponentes se necessário)

## Arquivos proibidos

- `apps/web/features/pipeline/board/PipelinePage.tsx` (pertence ao S03)
- `apps/api/**`
- `packages/db/**`

## Definition of Done

- [ ] Usuário consegue criar pipeline com nome livre (sem template ou com template de stages pré-definidas).
- [ ] Usuário consegue renomear pipeline existente via edição inline.
- [ ] Usuário consegue deletar pipeline com confirmação digitando o nome.
- [ ] Ao atingir limite, modal exibe mensagem clara (não 500 silencioso).
- [ ] Único pipeline do workspace não tem botão de deletar.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations

- Modal de criação: 3 opções de template em grid de cards (icon + nome + descrição de 1 linha), não radio buttons crus.
- Nome inline edit: estilo Linear — clique no nome do pipeline no header → transforma em input; ESC cancela.
- Confirmação de delete: obrigar digitar o nome exato (prevenção de acidente). Botão de confirmar desabilitado até o nome bater.
- Alerta de limite: banner inline no modal "Limite de X pipelines atingido. Exclua uma pipeline para criar outra." — não toast.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web test
```

## Notas

O endpoint `POST /api/pipelines` atual não aceita `template` — só cria a pipeline em si. A instanciação do template (criar stages) precisa ser chamada em seguida via endpoint de stages OU o backend pode aceitar um campo `template` e chamar `instantiatePipelineTemplate` internamente. Verificar com S02 se o endpoint será expandido ou se o frontend faz duas chamadas (create pipeline → create stages a partir do template). A abordagem de duas chamadas é mais simples e já tem o endpoint de stages pronto.
