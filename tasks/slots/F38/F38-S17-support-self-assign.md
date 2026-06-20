---
id: F38-S17
title: Self-assign no inbox de suporte platform ("Atribuir a mim")
phase: F38
status: review
priority: medium
estimated_size: S
depends_on: []
blocks: []
source_docs:
  - docs/features/SUPPORT.md
agent_id: frontend-engineer
claimed_at: 2026-06-20T15:23:11Z
completed_at: 2026-06-20T15:26:32Z

---
# F38-S17 — Self-assign no inbox de suporte

## Objetivo

Fechar o follow-up da F38: o inbox de suporte platform só permite **desatribuir** hoje — falta "Atribuir a mim". Adicionar o botão usando o id do platform admin logado (auth store real, não o stub que ficou). 100% frontend; o backend já aceita `PATCH /platform/support/threads/:id { assignedTo }`.

## Contexto

`apps/web/features/platform-admin/support/InboxThread.tsx` (linhas ~127-145): quando `thread.assignedTo` é null mostra só "Não atribuído"; quando setado, mostra o id cru + botão "Desatribuir" (`patch.mutate({ assignedTo: null })`). O membro logado está em `useAuthStore().member` (`{ id, workspaceId, name, role }`) — `apps/web/shared/stores/auth.store.ts`. O `PATCH` já existe e é consumido pelo "Desatribuir".

## Escopo (faz)

- **`apps/web/features/platform-admin/support/InboxThread.tsx`** — quando não atribuído, renderizar botão **"Atribuir a mim"** → `patch.mutate({ assignedTo: useAuthStore.member.id })`. Quando atribuído, melhorar o rótulo: se `assignedTo === member.id` mostrar **"Você"** (em vez do id cru); senão manter o id. Manter o "Desatribuir". Estados loading via `patch.isPending`; ARIA nos botões.

## Fora de escopo

- Backend (PATCH já existe). Lookup de nome de OUTROS admins (exigiria endpoint novo — não fazer; mostrar id cru para terceiros está ok). Outros arquivos do support.

## Arquivos permitidos

- `apps/web/features/platform-admin/support/InboxThread.tsx`

## Arquivos proibidos

- `apps/api/**`, `packages/**`, demais features

## Definition of Done

- [ ] Thread não atribuído mostra "Atribuir a mim"; clicar atribui ao admin logado e reflete (real-time/refetch).
- [ ] Atribuído a mim mostra "Você"; "Desatribuir" segue funcionando.
- [ ] DS v2 tokens; ARIA; sem `any`.
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm --filter @hm/web build` verdes.

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas

Fecha o follow-up registrado em [[tagix-f38-support]] (COMMS.md). Mudança mínima e cirúrgica — não refatorar o componente.
</content>
