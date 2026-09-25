---
id: F70-S04
title: Eco do app vira mensagem humana e pausa a IA
phase: F70
status: blocked
priority: high
estimated_size: M
depends_on: [F70-S03]
blocks: [F70-S06]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-08-eco-do-app-vira-mensagem-humana-e-pausa-a-ia.md
---
# F70-S04 — Eco do app vira mensagem humana e pausa a IA

> Espelho do **CO-08** da Central de Operação (`rogerio-os/tasks/central-operacao/`).

## Objetivo

O que o Rogério manda pelo celular aparece como dele no Leadium e tira a IA da conversa.

## Contexto

Hoje `persistEcho` grava o eco como `senderType:'system'`, sem autoria, sem `first_response_at` e sem pausar a IA. O Instagram descarta `is_echo`.

## Escopo

### files_allowed

- `apps/workers/src/coexistence/**`
- `packages/channels/src/meta/instagram/**`
- `apps/api/src/routes/conversations/messages.ts` *(só para reaproveitar a regra de pausa)*

## Escopo (faz)

- Eco do WhatsApp → `sender_type='member'`, `sender_member_id` do dono do canal, `metadata.origin='app'`.
- Preencher `first_response_at` quando o primeiro humano responde pelo app.
- Eco em conversa com `ai_mode='on'` → `ai_mode='paused'`, `ai_paused_reason='human_takeover'` (mesma regra da UI).
- Instagram: persistir `is_echo` do mesmo jeito.
- Conversa iniciada pelo app nasce com a IA desligada e a etiqueta `origem:prospeccao`.

## Fora de escopo

- Retomar a IA automaticamente.

## Passos do Rogério 🧑

- Responder um cliente pelo app e ver a IA parar naquela conversa.

## Definition of Done

- [ ] testes para eco → member + pausa
- [ ] prova em produção com o número real
- [ ] eco do IG persistido (quando o IG estiver liberado)
