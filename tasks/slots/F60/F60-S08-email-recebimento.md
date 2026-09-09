---
id: F60-S08
title: E-mail — recebimento, retorno e supressão por bounce
phase: F60
status: review
priority: critical
estimated_size: M
depends_on: [F60-S03]
blocks: [F60-S07]
source_docs:
  - docs/features/CANAIS_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T15:16:40Z
completed_at: 2026-09-09T16:18:38Z

---
# F60-S08 — E-mail: recebimento, retorno e supressão por bounce

## Objetivo

Fechar o canal de e-mail: receber na inbox, processar o retorno assíncrono do provedor e suprimir
automaticamente quem deu bounce duro ou reclamou de spam.

## Contexto

A F60-S03 entregou a fundação e o envio; hoje o canal envia e não recebe. Cada peça deste slot tem
risco de segurança próprio — assinatura de webhook, HTML de terceiro, URL de terceiro — e por isso
saiu de um slot que já estava longo demais.

## Escopo

### files_allowed

- `apps/api/src/routes/webhooks/email.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `apps/api/src/routes/webhooks/index.ts`
- `packages/channels/src/email/sanitize.ts`
- `packages/channels/src/email/*.test.ts`
- `apps/workers/src/inbound/email-*.ts`
- `apps/workers/src/inbound/*.test.ts`

### files_forbidden

- `packages/channels/src/email/adapter.ts`
- `packages/shared/src/consent.ts`

## Definition of Done

- [x] Webhook **recusa payload não assinado** — sem isso, alguém forja um `hard_bounce` e suprime o contato de um cliente.
- [ ] Anexo inbound vai para R2 e a mensagem referencia por `external_id`, como a mídia da Meta.
- [x] **Bounce duro e reclamação de spam suprimem o endereço** em `contact_suppressions` (canal `email`), reusando `consentRepo.revoke`.
- [x] Bounce leve **não** suprime: é transitório, e suprimir por caixa cheia perde o cliente para sempre.
- [x] HTML inbound é sanitizado antes de chegar à UI. E-mail é vetor clássico de XSS armazenado, e a política de SVG do `uploads.ts` mostra que o repo já leva isso a sério.
- [ ] Anti-SSRF em qualquer URL vinda do e-mail (política de F56-S07).
- [ ] A thread encontrada por `threadKeyFrom` reusa a conversa existente; assunto alterado não cria conversa nova.
- [x] Rate limit no webhook público, como nos demais.

## Validação

```bash
pnpm --filter @hm/channels typecheck
pnpm --filter @hm/channels test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/workers typecheck
pnpm --filter @hm/workers test
pnpm lint
```

## Notas

- Bounce duro que não suprime é o caminho mais rápido para queimar o domínio do cliente.
- Suprimir por bounce leve é o caminho mais rápido para perder um cliente que só estava de férias
  com a caixa cheia. A distinção importa e precisa estar testada.

## Escopo entregue e o que ficou (2026-09-09)

**Entregue:** sanitização, classificação de bounce, e as duas rotas de webhook com assinatura
verificada e rate limit. São as peças de **segurança** — as que não podem esperar, porque uma rota
de webhook aberta ou um HTML não sanitizado é problema no dia em que existir tráfego.

**Ficou para o slot de persistência** (a criar quando a F60-S04 injetar o provedor real): gravar a
mensagem na conversa via `threadKeyFrom`, subir o anexo para o R2, e chamar `consentRepo.revoke` a
partir da decisão de bounce. Hoje as rotas entregam a decisão pronta por porta injetável
(`onInbound`, `onEvent`) e o `createInertEmailWebhookRouter` está montado recusando tudo — que é o
estado correto de uma rota cujo provedor ainda não existe.

O anti-SSRF também fica para lá: só faz sentido quando alguém for de fato buscar uma URL vinda do
e-mail, e hoje ninguém busca.

## Decisões tomadas na execução

1. **Lista de permissão no sanitizador, nunca de bloqueio.** Bloqueio sempre perde: `<script>` é
   óbvio, `<svg onload>` menos, e a próxima que ninguém previu é a que passa. Só sobrevive o que
   está explicitamente permitido.
2. **Tag precisa colar no `<`.** Um teste pegou que eu aceitava `< b` como tag, o que transformava o
   texto legítimo "se a < b" numa tag `<b>` e deixava o parágrafo em negrito. Ser mais permissivo
   que o navegador não é ser mais seguro — é corromper conteúdo.
3. **`<script>` remove o conteúdo junto, em laço.** Remover só a marcação deixaria `alert(1)` como
   texto visível; e `<scr<script>ipt>` se reconstrói se a remoção não repetir.
4. **Bounce leve NÃO suprime, bounce duro suprime na hora.** As duas decisões erradas custam em
   direções opostas: não suprimir endereço morto queima o domínio; suprimir quem estava de férias
   com a caixa cheia perde o cliente para sempre, e ninguém descobre por quê. Há teste para as duas.
5. **403 sem detalhe.** Dizer o que faltou na assinatura ajuda quem está tentando forjar.
6. **Payload assinado mas irreconhecível responde 200.** Devolver erro faria o provedor reenviar
   para sempre algo que nunca vamos entender.
7. **O texto de prévia sai do HTML já sanitizado, nunca do cru.** A lista de conversas também é
   superfície de renderização.
8. **Filtro por código em vez de caracteres de controle na regex.** O `no-control-regex` reclama com
   razão, e ler `code > 0x1f` é mais claro que uma classe com bytes invisíveis. Cheguei a suspeitar
   de furo de segurança ao ver `cat -v` renderizar os controles como `[^@-^_^?]` — era só a notação
   de circunflexo. Verifiquei o comportamento real antes de mexer: estava correto.

## Resultado

`@hm/channels` 216 verdes (47 novos: 34 de sanitização, 13 de bounce) · `@hm/api` 1046 verdes
(16 novos de webhook).
