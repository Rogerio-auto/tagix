---
id: F6-S08
title: Frontend CampaignEditor wizard (6 steps) + template picker + CSV import + send windows editor
phase: F6
status: done
priority: high
estimated_size: L
depends_on: [F6-S03, F6-S04]
agent_id: backend-engineer
claimed_at: 2026-06-11T05:31:22Z
completed_at: 2026-06-11T05:36:19Z

---
# F6-S08 — CampaignEditor (web)

> **source_docs:** `docs/features/CAMPAIGNS.md` §4, §12.2–12.5, §17.3; `docs/UX_PRINCIPLES.md` §2/§3; `docs/ROADMAP.md` F6-S07
> **blocks:** —

## Objetivo
Wizard de criação/edição de campanha (DS v2, RHF + Zod por step): Step 1 nome/tipo/canal/agendamento · Step 2 recipients (CSV import com mapping + preview + dedup + opt-in batch) · Step 3 steps (template picker Meta + delay) · Step 4 send windows (grid 7×24 click-drag) + rate · Step 5 IA (auto handoff) · Step 6 review com checklist de `validate`.

## Escopo (faz)
- `apps/web/app/(app)/campaigns/new/**` + `.../[id]/edit/**`: rotas do wizard.
- `apps/web/features/campaigns/editor/**`: `CampaignEditor` (stepper), `RecipientsImport` (CSV + E.164 + preview), `TemplatePicker` (templates APPROVED + preview + mapping de `{{1}}`→fields), `SendWindowsEditor` (grid + quick options), `ReviewStep` (checklist do `validate`).
- Tabs por provider (WhatsApp/Instagram) quando o workspace tem ambos (§17.3): em IG, Step 3 vira "Mensagem direta" + aviso destacado.

## Fora de escopo
- CampaignsPage/monitoring (F6-S09), API (F6-S03/S04).

## Arquivos permitidos
- `apps/web/app/(app)/campaigns/new/**`
- `apps/web/app/(app)/campaigns/[id]/edit/**`
- `apps/web/features/campaigns/editor/**`

## Definition of Done
- [ ] Wizard cria/edita campanha com validação por step; CSV import com preview/dedup; template picker só APPROVED; send windows editor funcional; review reflete `validate` (só ativa se `safe`).
- [ ] `pnpm --filter @hm/web typecheck` + lint + build verdes.

## UX considerations
- §2 wizard com progresso claro (sem modal full-screen); §3 estados por step (loading/error/validação inline); CSV preview honesto; aviso IG destacado (§17.3); tokens DS v2 (zero hex).

## Permission scope
- Criar/editar → `campaign.edit` (MANAGERS); upload recipients → `campaign.upload_recipients`; bulk opt-in → `campaign.bulk_optin` (ADMINS); ativar (no review) → `campaign.activate` (ADMINS).

## Validação
```bash
pnpm typecheck
pnpm lint
pnpm --filter @hm/web build
```

## Notas
- Especialista sugerido: **frontend-engineer**.
- Slot L — se passar de ~500 linhas, separe `RecipientsImport`/`SendWindowsEditor` num slot sequencial. Item de nav "Campanhas" pode vir aqui ou em F6-S09 (coordene p/ não colidir na Sidebar — sugiro F6-S09 ser dono da Sidebar).
