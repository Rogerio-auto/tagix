---
id: F9-S06
title: Frontend Settings → Dev — API keys (show-once) + webhooks + delivery log
phase: F9
status: done
priority: medium
estimated_size: M
depends_on: [F9-S04]
agent_id: backend-engineer
claimed_at: 2026-06-11T22:02:25Z
completed_at: 2026-06-11T22:06:26Z

---
# F9-S06 — Settings → Dev (web)

> **source_docs:** `docs/features/PERMISSIONS.md` §5; `docs/UX_PRINCIPLES.md` §3, §5.1; `docs/ROADMAP.md` F9-S06
> **blocks:** —

## Objetivo
Seção "Dev" no painel de settings (montada no `SectionRegistry` de F8-S05): gestão de **API keys** (criar com modal que mostra o token **uma única vez** + copiar; listar com prefix/last_used/scopes; revogar com typing-to-confirm) e **Webhooks outbound** (criar/editar com seletor de eventos + URL + secret; testar entrega; ver delivery log com status/retry). Link para `/api/v1/docs` (Swagger).

## Escopo (faz)
- `apps/web/features/settings/sections/dev/**`: `ApiKeysManager` (create-modal show-once, copy, revoke), `WebhooksManager` (form + event picker + test + `DeliveryLog`), consumindo a API de F9-S04.

## Fora de escopo
- API (F9-S04), worker (F9-S05), shell do settings (F8-S05).

## Arquivos permitidos
- `apps/web/features/settings/sections/dev/**`

## Definition of Done
- [ ] Criar chave mostra o token só uma vez (com aviso "guarde agora") + copiar; revogar com typing-to-confirm; webhooks CRUD + testar + delivery log; link p/ Swagger.
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §3 token show-once com aviso claro e botão copiar (nunca re-exibe); §5.1 form com dirty-tracking; mudança crítica (revogar chave/deletar webhook) com typing-to-confirm; estados loading/empty/error 3-partes; tokens DS v2 (zero hex).

## Permission scope
- Seção gated por `apikey.manage`/`webhook.manage` (ADMINS). Esconder do nav de settings para quem não tem.

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Monta no `SectionRegistry` de F8-S05 (subdir próprio `sections/dev/`, sem tocar o shell). Fecha as seções "API keys" e "Webhooks" que a F8-S08 deixou para a F9.
