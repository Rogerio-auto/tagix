---
id: F70-S04
title: Eco do app vira mensagem humana e pausa a IA
phase: F70
status: in-progress
priority: high
estimated_size: M
depends_on: [F70-S03]
blocks: [F70-S06]
source_docs:
  - rogerio-os/tasks/central-operacao/CO-08-eco-do-app-vira-mensagem-humana-e-pausa-a-ia.md
agent_id: backend-engineer
claimed_at: 2026-09-25T01:43:10Z

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

- [x] testes para eco → member + pausa
- [ ] prova em produção com o número real
- [ ] eco do IG persistido (quando o IG estiver liberado) — parser + persistência prontos e testados; falta o fio (ver "Pendências fora da fronteira")

## Decisões

- **Dono do canal** (autor `sender_member_id` do eco): `channels.metadata.ownerMemberId` quando
  aponta um membro ativo do workspace; senão o OWNER ativo mais antigo; senão `null` (a mensagem
  continua `member`). O schema não liga canal a membro, e `meta_connections.connected_by` não tem
  vínculo com o canal.
- `metadata.origin='app'` + `metadata.echoSource` (`whatsapp_coexistence` | `instagram_echo`).
- Conversa aberta pelo eco (prospecção) não grava `first_response_at` (ninguém perguntou nada);
  grava na primeira resposta de verdade. Nasce `ai_mode='off'` e o CONTATO ganha a etiqueta
  `origem:prospeccao` (etiquetas são de contato no schema).
- Pausa: mesma regra da rota `POST /conversations/:id/messages` (F30-S04/F55-S02), com o instante
  do eco e `ai_last_human_at` monotônico; estado lido com `FOR UPDATE`.
- Eco do IG com `app_id` = `META_APP_ID` é descartado (mensagem que o próprio Leadium enviou).

## Pendências fora da fronteira

- Exportar `parseInstagramEchoes`/`InstagramEchoEvent` em `packages/channels/src/index.ts`.
- Ligar o eco do IG: no pipeline inbound do Instagram, rodar `parseInstagramEchoes(body)` e chamar
  `handleInstagramEchoes` (ou publicar numa fila) — hoje o webhook descarta os ecos.
- Extrair `planHumanReply` para `@hm/shared` e fazer a rota da API usá-la (hoje é espelho).
- `apps/web` MessageBubble: mostrar `origin='app'` como "enviado pelo celular" (opcional).

## Validação

```bash
pnpm --filter @hm/workers exec vitest run src/coexistence
pnpm --filter @hm/channels exec vitest run src/meta/instagram
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/channels typecheck
```
