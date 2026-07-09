---
id: F56-S05
title: Ativação de canal recuperável (Embedded Signup + badge + fallback)
phase: F56
status: available
priority: high
estimated_size: M
depends_on: []
blocks: []
agent_id: frontend-engineer
source_docs:
  - AUDITORIA_TECNICA.md
---

# F56-S05 — Ativação de canal recuperável (UX-01/UX-06/UX-12)

> **Origem:** AUDITORIA_TECNICA.md §3.5. Conectar canal é o passo que liga o produto e hoje degrada para um formulário impossível; o badge "Canais" mostra "0 ativos" mesmo com canal ativo; o fallback manual não aparece.

## Objetivo

Tornar a conexão de canal recuperável e honesta: sem SDK Meta configurado, não oferecer campos inviáveis; badge de canais correto; fallback manual visível quando o Embedded Signup falha.

## Contexto / causa raiz (verificada)

- **UX-01:** `ConnectWizard.tsx:462-508` — sem `NEXT_PUBLIC_META_APP_ID/CONFIG_ID` cai num form pedindo `authorization code` (single-use, expira em segundos).
- **UX-06:** `useSectionCounters.ts:18-28` filtra `c.status==='active'` mas o objeto `Channel` tem `isActive` — badge sempre 0.
- **UX-12:** no timeout/catch do Embedded Signup o toast diz "informe os dados abaixo" mas `setManualOpen(true)` nunca é chamado.

## Escopo (faz)

- Badge: usar `c.isActive` (e religar/retirar o bloco de expiração que lê campo inexistente).
- Se o SDK Meta não estiver configurado no build: esconder os campos de `code` e mostrar "Conexão indisponível neste ambiente — fale com suporte" com CTA real.
- No `catch`/timeout do Embedded Signup: `setManualOpen(true)` antes do toast, para os campos referidos aparecerem.

## Escopo (não faz)

- QR real do WAHA / botão "Reconectar" (follow-up UX-24 — pode ser slot futuro).
- Backend de canais.

## Arquivos permitidos

- `apps/web/features/channels/**`
- `apps/web/features/settings/shell/useSectionCounters.ts`

## Arquivos proibidos

- `apps/web/features/settings/sections/**` (fora do shell counter)

## Definition of Done

- [ ] Badge "Canais" reflete canais realmente ativos.
- [ ] Sem envs Meta, o wizard não pede `code`; mostra estado indisponível com CTA.
- [ ] Timeout do Embedded Signup abre os campos manuais automaticamente.
- [ ] `pnpm typecheck` + `pnpm lint` verdes.

## UX considerations (docs/UX_PRINCIPLES.md)

- Não pedir input impossível (anti-padrão: formulário que o usuário não tem como completar).
- Feedback de estado correto no ponto de maior ansiedade do onboarding (§ feedback visual).
- Toda mensagem de recuperação aponta para algo que existe na tela (§ mensagens úteis).

## Validação

```bash
pnpm typecheck
pnpm lint
```

## Notas

- Considerar um health-check de build que falhe o deploy quando `NEXT_PUBLIC_META_*` faltar (coordenar com F56-S18 infra via COMMS; não editar infra aqui).
