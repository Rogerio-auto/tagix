---
id: F69-S07
title: Instagram — publicação de conteúdo: imagem, carrossel e reels com fila e agendamento
phase: F69
status: available
priority: medium
estimated_size: L
depends_on: [F69-S08]
blocks: []
source_docs: 
  - docs/features/META_INTEGRACAO_PLAN.md
agent_id: fullstack-engineer

---
# F69-S07 — Instagram — publicação de conteúdo: imagem, carrossel e reels com fila e agendamento

## Objetivo

Publicar no Instagram do cliente a partir do Leadium — imagem, carrossel e reels —, agendado, com estado honesto de cada publicação.

## Contexto

`docs/features/META_INTEGRACAO_PLAN.md` §2 e `CONTENT_STUDIO_PLAN` §7. É pré-requisito da F66 (calendário e publicação). A publicação é assíncrona: cria-se um contêiner, espera-se o processamento e só então se publica; vídeo pode levar minutos.

## Escopo

### files_allowed

- `packages/channels/src/meta/instagram/publish/**`
- `apps/workers/src/instagram-publish/**`
- `apps/workers/src/bootstrap/index.ts`
- `apps/api/src/routes/instagram/**`
- `packages/db/src/schema/ig_publications.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle/**`
- `apps/web/features/instagram-publish/**`

### files_forbidden

- `packages/storage/src/**`

## Escopo (faz)

- Contêiner por mídia, carrossel com filhos, reels; consulta de status até pronto ou erro, com prazo.
- Mídia servida por URL pública temporária do R2, válida pelo tempo do processamento.
- Fila com agendamento, respeitando o limite de publicações por período da conta.
- Estados: rascunho, agendado, processando, publicado, falhou (com motivo e ação).

## Fora de escopo

- Criação de conteúdo e aprovação do cliente (F63–F66).

## Definition of Done

- [ ] Publicação só acontece depois do contêiner pronto; teste cobre processamento lento e erro.
- [ ] Limite de publicações respeitado antes de chamar a Meta.
- [ ] Falha mostra motivo e próxima ação.
- [ ] Nenhuma URL de mídia fica pública depois de publicado.
- [ ] RLS e isolamento testados.

## Validação

```bash
pnpm typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers test
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: agendou, saiu — e quando não sai, o motivo está na tela.
