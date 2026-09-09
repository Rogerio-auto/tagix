---
id: F61-S03
title: Web Push — assinatura por dispositivo, VAPID e privacidade na tela bloqueada
phase: F61
status: review
priority: critical
estimated_size: L
depends_on: [F61-S01, F61-S05]
blocks: [F61-S04, F61-S08]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T22:15:46Z
completed_at: 2026-09-09T22:40:25Z

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
- `infra/docker/docker-compose.prod.yml`
- `.env.example`

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

- [x] Assinatura é por dispositivo; duas do mesmo membro coexistem.
- [x] RLS isola por workspace; teste cobre.
- [x] Reassinar o mesmo endpoint atualiza, não duplica.
- [x] 404/410 do provedor apaga a assinatura.
- [x] Notificação NÃO carrega conteúdo de mensagem de cliente.
- [x] Sem VAPID configurado, o produto funciona com push desligado.
- [x] Permissão só é pedida com o app instalado.
- [x] `notificationclick` foca aba existente em vez de abrir outra.

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

## Decisões tomadas na execução (2026-09-09)

1. **A privacidade está no TIPO, não na disciplina do chamador.** `PushNotification` não tem
   campo para conteúdo de mensagem de cliente: só `title`, `origin`, `url` e `tag`. Celular de
   obra se perde, e notificação de tela bloqueada é lida por quem estiver com o aparelho na mão.
   Se um dia for preciso mandar o texto do cliente, alguém terá que mudar o tipo — e a decisão
   aparece na revisão, em vez de escorregar num `body: mensagem.content`.

2. **Chave é o `endpoint`, não `(workspace, membro)`.** A mesma pessoa tem iPhone e desktop; uma
   assinatura por membro faria o aviso chegar num aparelho só, e sempre o último a assinar.

3. **`onConflictDoUpdate` no endpoint.** O navegador rotaciona as chaves mantendo o mesmo
   endpoint: tratar como inserção daria violação de unicidade, e tratar como "já existe, ignora"
   deixaria chaves velhas — que fazem o envio falhar em silêncio, a pior forma de falhar num
   canal de aviso.

4. **Só 404/410 apaga assinatura.** É o provedor dizendo "este endereço não existe". 5xx, 429,
   timeout e — principalmente — **401/403 não apagam**: 401/403 é a NOSSA credencial errada, e
   apagar aí zeraria a base inteira de assinaturas num deploy com VAPID trocado. Há teste para
   cada um desses códigos.

5. **`member_id` com `ON DELETE CASCADE`.** Ex-funcionário com o app no celular não pode
   continuar recebendo aviso de lead do workspace de onde saiu.

6. **A assinatura é sempre do membro da SESSÃO.** O corpo da requisição não escolhe de quem é —
   senão qualquer membro poderia redirecionar os avisos de outro para o próprio aparelho.

7. **Sem VAPID, push desligado e produto de pé.** `publicKey()` devolve `null`, a UI não mostra
   o interruptor, e `notifyMember` nem consulta o banco. O produto inteiro não pode deixar de
   subir porque o canal de aviso não foi configurado — em dev ele nem faz sentido.

8. **Chave VAPID malformada loga alto e desliga o push**, em vez de derrubar o processo.

9. **`bloqueado` vem ANTES de `precisa-instalar` na decisão da UI.** Quem já negou não é
   convencido por um convite: a permissão negada só volta pelas configurações do navegador, e
   insistir é o caminho mais curto para o dono desinstalar o app.

10. **Nunca pedir permissão no iOS fora do modo instalado.** O Safari só entrega push para app
    na tela de início; pedir numa aba gasta a única chance que existe, com o usuário que ainda
    não entendeu o que ganha.

11. **Assinado mas sem permissão NÃO é "ativo".** Permissão revogada nos ajustes do sistema
    deixa a assinatura órfã; dizer "ativo" faria o dono confiar num aviso que não vai chegar.

12. **`unsubscribe` avisa o servidor ANTES de cancelar no navegador.** Na ordem inversa, uma
    falha de rede deixaria o servidor mandando push para um endpoint que o usuário achou que
    tinha desligado.

13. **`notificationclick` foca a aba existente.** O dono tocando na notificação três vezes não
    pode acabar com três instâncias do app.

14. **Payload de push ilegível mostra aviso genérico**, em vez de ser engolido em silêncio — o
    dono perderia o lead e nunca saberia por quê.

15. **`Uint8Array` sobre `ArrayBuffer` explícito.** Desde o TS 5.7 o array tipado carrega o
    buffer no tipo, e a variante `ArrayBufferLike` (que admite `SharedArrayBuffer`) não satisfaz
    `BufferSource`, exigido por `applicationServerKey`.

## Resultado

- Migration `0076` com RLS; `push_subscriptions` por dispositivo.
- 10 testes em `@hm/api` (`services/push`), 11 em `@hm/web` (`shared/pwa/push`).
- Suíte web 229/229. Typecheck limpo em `@hm/db`, `@hm/api`, `@hm/web`. Lint: 0 erros.

## Nota de operação

`pnpm add` falhou com `ERR_PNPM_VIRTUAL_STORE_DIR_MAX_LENGTH_DIFF` e o `pnpm install` seguinte
ficou pendurado num prompt interativo invisível. Resolvido com
`pnpm install --config.confirmModulesPurge=false`, que recriou `node_modules`. Vale registrar
para não custar o mesmo tempo na próxima dependência nova.
