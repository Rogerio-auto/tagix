---
id: F3-S06
title: Frontend KnowledgeBasePage — upload, lista, editor, preview de chunks, status
phase: F3
status: done
priority: high
estimated_size: M
depends_on: [F3-S04]
agent_id: backend-engineer
claimed_at: 2026-06-10T16:30:23Z
completed_at: 2026-06-10T16:36:08Z

---
# F3-S06 — KnowledgeBasePage (web)

> **source_docs:** `docs/UX_PRINCIPLES.md` §2/§3; `docs/DATA_MODEL.md` §8; `docs/features/PERMISSIONS.md` §5 (kb.edit); `docs/ROADMAP.md` F3-S04
> **blocks:** F3-S07

## Objetivo
Tela de gestão da Knowledge Base no DS v2: upload de documento (markdown/texto), lista com status de processamento em tempo quase-real, edição de metadados (title/category/tags/priority/visible_to_agents), preview dos chunks gerados e ações (reprocessar/arquivar). Consome a API de F3-S04. Adiciona entrada na navegação e troca o placeholder da aba Knowledge do agente por um ponteiro real.

## Escopo (faz)
- `apps/web/app/(app)/knowledge/**`: rota da página (App Router Next 15).
- `apps/web/features/knowledge/**`: `KnowledgeBasePage`, `DocumentList` (status badge: processing/active/error), `UploadDocumentModal/Drawer`, `DocumentDetail` (metadados + preview de chunks), `queries.ts`/`types.ts`.
- `apps/web/shared/components/layout/Sidebar.tsx`: item de navegação "Conhecimento" (ícone BookOpen), visível só com `can('kb.edit')`.
- `apps/web/features/agents/detail/KnowledgeTab.tsx`: trocar o empty-state "em breve" por um resumo (docs visíveis ao agente) + link para `/knowledge`.

## Fora de escopo
- Feedback útil/não-útil + citações (F3-S07), API (F3-S04), retrieval (F3-S05).

## Arquivos permitidos
- `apps/web/app/(app)/knowledge/**`
- `apps/web/features/knowledge/**`
- `apps/web/shared/components/layout/Sidebar.tsx`
- `apps/web/features/agents/detail/KnowledgeTab.tsx`

## Definition of Done
- [ ] Upload cria documento e ele aparece na lista como `processing`, transitando para `active` (refetch/polling); erro mostra estado claro.
- [ ] Editor de metadados salva (PATCH); reprocessar e arquivar funcionam; preview lista chunks.
- [ ] Navegação e página gated por `can('kb.edit')` (defesa em profundidade do guard de F3-S04).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 navegação clara: a KB é item de 1ª classe na sidebar (sem gear-only entry); §2.7 skeleton na lista e no preview; estados default/loading/empty/error 3-partes com ref copiável.
- §3 feedback de progresso: status de ingestão visível e honesto (processing→active→error), sem CTA falso enquanto indexa; tokens DS v2 (zero hex).
- Upload sem modal full-screen (evitar anti-padrão v1): drawer/painel lateral.

## Permission scope
- Página e ações de escrita exigem `kb.edit` (MANAGERS, `permissions.ts`). Esconder o item de navegação para roles sem a permissão.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Status quase-real pode ser via refetch/polling no MVP (não exige novo evento socket); se quiser realtime, é follow-up.
