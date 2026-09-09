---
id: F61-S03
title: Web Push — assinatura por dispositivo, VAPID e privacidade na tela bloqueada
phase: F61
status: in-progress
priority: critical
estimated_size: L
depends_on: [F61-S01, F61-S05]
blocks: [F61-S04, F61-S08]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T22:15:46Z

---
# F61-S03 — Web Push

## Objetivo

O dono ser avisado no celular quando entra lead — porque o número que fecha venda é o
tempo de resposta, e ninguém responde rápido o que não sabe que chegou.

## Contexto

`APP_MOBILE_PLAN` §4.1 e §4.3. A F61-S01 subiu o service worker (o handler de push É o SW)
e a F61-S05 entregou a instalação (sem ela o iOS não entrega push nenhum). Este slot fecha
a peça que transforma o PWA em app de verdade.

### Por dispositivo, não por pessoa

A mesma pessoa tem iPhone e desktop. Uma assinatura por membro faria o aviso chegar num
aparelho só — quase sempre o errado, porque o último a assinar ganha. A chave natural é o
`endpoint`, que o navegador gera por instalação.

### Privacidade na tela bloqueada

Celular de obra se perde. Notificação **não mostra conteúdo de mensagem de cliente**: título e
origem ("Lead novo · WhatsApp"), e o conteúdo só depois de abrir o app. Dado de cliente final
na tela bloqueada de um telefone perdido é vazamento, e é vazamento que a LGPD e a lei
americana tratam como incidente.

### Endpoint morto é lixo que custa

Quando o usuário desinstala, o serviço de push responde `404`/`410` para sempre. Sem limpeza,
a base de assinaturas cresce com endereços mortos e cada envio paga por eles. A resposta do
provedor é a fonte da verdade: `404`/`410` apaga a linha.

## Escopo

### files_allowed

- `packages/db/src/schema/push.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/repos/push.ts`
- `packages/db/src/index.ts`
- `packages/db/drizzle/**`
- `apps/api/src/routes/push/**`
- `apps/api/src/services/push/**`
- `apps/api/src/config.ts`
- `apps/api/src/app.ts`
- `apps/web/shared/pwa/**`
- `apps/web/features/today/**`
- `apps/web/public/sw.js`
- `apps/api/package.json`

### files_forbidden

- `apps/workers/**`

## Escopo (faz)

1. **`push_subscriptions`** workspace-scoped com RLS: `endpoint` único, chaves `p256dh`/`auth`,
   rótulo do aparelho, `last_used_at`, `failure_count`.
2. **VAPID** por variável de ambiente, com fail-fast claro quando falta — e degradação
   silenciosa (push desligado) em vez de erro, se não estiver configurado.
3. **Rotas**: chave pública, assinar, cancelar.
4. **Serviço de envio** com limpeza automática de endpoint morto (404/410).
5. **Handlers no SW**: `push` (notificação sem conteúdo de cliente) e `notificationclick`
   (foca a aba aberta em vez de abrir outra).
6. **Interruptor na tela Hoje**, aparecendo só quando o app está instalado — pedir permissão
   de notificação para quem está numa aba do Safari é queimar a única chance que existe.

## Fora de escopo

- Roteador de notificação, dedupe e preferência por tipo de evento (F61-S04).
- Badge de não-lidos e link profundo (F61-S08).

## Definition of Done

- [ ] Assinatura é por dispositivo; duas do mesmo membro coexistem.
- [ ] RLS isola por workspace; teste cobre.
- [ ] Reassinar o mesmo endpoint atualiza, não duplica.
- [ ] 404/410 do provedor apaga a assinatura.
- [ ] Notificação NÃO carrega conteúdo de mensagem de cliente.
- [ ] Sem VAPID configurado, o produto funciona com push desligado.
- [ ] Permissão só é pedida com o app instalado.
- [ ] `notificationclick` foca aba existente em vez de abrir outra.

## Validação

```bash
pnpm --filter @hm/db typecheck
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono descobre o lead pelo celular antes de o concorrente responder.
