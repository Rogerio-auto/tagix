---
id: F60-S10
title: E-mail recebido completo — anexo no R2, anti-SSRF e reuso de thread
phase: F60
status: done
priority: high
estimated_size: M
depends_on: [F60-S08]
blocks: []
agent_id: backend-engineer
claimed_at: 2026-10-07T17:13:00Z
completed_at: 2026-10-07T17:42:30Z

---
# F60-S10 — E-mail recebido completo — anexo no R2, anti-SSRF e reuso de thread

## Objetivo

Fechar os três itens do recebimento de e-mail que ficaram de fora da F60-S08.

## Contexto

A F60-S08 foi marcada como concluída com três itens do DoD desmarcados, e nenhum deles tem implementação no código (auditoria de 2026-09-14).

## Escopo

### files_allowed

- `apps/workers/src/inbound/email-*.ts`
- `apps/workers/src/inbound/*.test.ts`
- `apps/api/src/routes/webhooks/email.ts`
- `apps/api/src/routes/webhooks/*.test.ts`
- `packages/channels/src/email/**`

### files_forbidden

- `packages/shared/src/consent.ts`

## Escopo (faz)

- Anexo inbound vai para o R2 e a mensagem referencia por `external_id`, como a mídia da Meta.
- Anti-SSRF em toda URL vinda do e-mail, com a política da F56-S07.
- `threadKeyFrom` reusa a conversa existente; assunto alterado não abre conversa nova.

## Fora de escopo

- Provedor real (F60-S04).

## Definition of Done

- [x] Anexo recebido abre na conversa a partir do R2. — `email-inbound.test.ts`: o anexo vai ao
  storage (`StorageMediaPort` sobre o mesmo `IStorageDriver` do R2), a mensagem nasce `ready` com
  `media_url` assinada e `metadata.mediaKey` (a chave do `refresh-media-url`), os bytes no storage
  batem com o anexo e o `message:media_ready` sai. **Ressalva de ponta a ponta:** ver "Lacunas fora
  da fronteira" — o banco ainda recusa canal de e-mail e a rota segue inerte.
- [x] URL interna, de loopback ou de metadados de nuvem é recusada; teste cobre. — três camadas
  testadas: sanitizador (`sanitize.test.ts`, `url-policy.test.ts`), borda do webhook
  (`email.test.ts`, 9 URLs) e busca no worker (`email-attachment-fetch.test.ts`: 15 URLs recusadas
  sem conexão, 5 casos de DNS-rebinding recusados no connect, redirect não seguido).
- [x] Resposta com assunto alterado cai na mesma conversa; teste cobre "Re:" e "Fwd:". —
  `email-inbound.test.ts`: "Re:" com assunto trocado de outro endereço, "Fwd:" de colega só com
  `References`, e resposta a uma mensagem NOSSA de 21 dias atrás caem na conversa original; mesmo
  assunto sem cabeçalho, de outra pessoa, NÃO cai.

## Validação

```bash
pnpm --filter @hm/workers test
pnpm --filter @hm/api test
pnpm lint
```

## Notas

- A régua: o cliente responde um e-mail de três semanas atrás e a conversa continua de onde parou.

## Entrega (2026-10-07)

Commits de implementação: `b8537bc6` (canal + borda), `e016b73a` (worker).

| Arquivo | O quê |
|---|---|
| `packages/channels/src/email/provider.ts` | `InboundEmailAttachment` = `inline` (base64 no webhook) ou `remote` (URL) |
| `packages/channels/src/email/url-policy.ts` | `isInternalHost` / `checkEmailNetworkUrl` (síncrono, sem rede) |
| `packages/channels/src/email/sanitize.ts` | `href`/`src` para dentro saem; `//host` e `\\host` não passam como relativos; `src` relativo sai |
| `packages/channels/src/email/fake-provider.ts` | parse de anexos (base64 estrito e URL) |
| `apps/api/src/routes/webhooks/email.ts` | anexo serializado para a fila; URL insegura recusada na borda; `safeAttachmentName` |
| `apps/workers/src/inbound/email-inbound.ts` | Zod do payload, resolver de canal, persistência sob RLS, outbox, socket |
| `apps/workers/src/inbound/email-thread.ts` | `threadCandidates` + `findThreadConversation` |
| `apps/workers/src/inbound/email-attachments.ts` | política (lista de permissão + bytes) e upload no storage |
| `apps/workers/src/inbound/email-attachment-fetch.ts` | busca por URL com lookup guardado, sem redirect, teto e timeout |

## Decisões tomadas na execução

1. **A thread vence o endereço, e o assunto não decide nada.** `conversations` é única por
   `(channel_id, remote_id)` e o `remote_id` é o endereço do contato (é para ele que a resposta
   sai), então o mesmo endereço já cai na mesma conversa. O que os cabeçalhos resolvem é o resto:
   resposta de outro endereço, `Fwd:` de colega, assunto trocado. Ordem: `In-Reply-To` →
   `References` da ponta para a raiz → raiz (`threadKeyFrom`), com teto de 25 ids.
2. **Endereço configurado em mais de um canal ativo é recusado, não sorteado.** Sem domínio
   verificado, nada impede um workspace de cadastrar o endereço de outro e receber o e-mail dele.
   Recusar perde a mensagem e loga `error`; sortear vazaria entre tenants.
3. **Não reusei o `ssrfSafeFetch` inteiro.** Ele corta a resposta em 64 KiB (é para o corpo de
   resposta de webhook) e devolveria anexo truncado em silêncio. Reusei as peças
   (`checkWebhookUrlSyntax`, `createGuardedLookup`, `SsrfBlockedError`) pelo leaf `@hm/shared/net`
   e escrevi a busca com o teto do anexo, em que estourar é recusa. A allowlist de operador
   (`HM_WEBHOOK_HTTP_ALLOWLIST`) **não** vale aqui — há teste que liga a env e prova que continua
   recusando.
4. **Anexo por lista de permissão e conferência de bytes.** Extensão executável/HTML/SVG/macro é
   recusada mesmo com `Content-Type` inocente (inclusive `fatura.pdf.exe` e `boleto.exe.pdf`);
   extensão e tipo que discordam são recusados; PDF sem `%PDF`, imagem sem a assinatura dela,
   PE/ELF/Mach-O/shebang e marcação HTML/SVG dentro de "documento" são recusados. ZIP fica de fora.
5. **Anexo recusado não some.** Vai para `metadata.email.rejectedAttachments` com nome e motivo
   curto, para o atendente saber que o cliente mandou algo. O log leva só os motivos — URL de anexo
   pode carregar token do provedor.
6. **Um anexo ruim nunca derruba o e-mail**, e storage fora também não: o texto entra, o anexo vira
   `storage_error`. Payload inválido é descartado sem lançar (reentrega não conserta); falha de
   banco lança para a escada de retry.
7. **Reentrega checa antes de subir.** Se o `Message-ID` já está no canal, para antes do upload —
   senão cada reentrega deixaria um objeto órfão no R2.
8. **Rede fora da transação.** Busca e upload acontecem antes do `withWorkspace`: segurar conexão do
   banco enquanto baixa 10 MB de um servidor lento esgota o pool.
9. **Sem dedup por SHA-256 do conteúdo.** `messages.media_sha256` não tem índice; consultar por ele
   na maior tabela do sistema é seq scan. Cada anexo sobe como objeto próprio.
10. **`src` relativo sai do HTML, `href` relativo fica.** `<img src="/api/...">` seria buscado
    sozinho contra a origem do produto com o cookie do atendente; link relativo exige clique.

## Lacunas fora da fronteira (para o Rogério decidir)

1. **O banco recusa canal de e-mail.** A constraint `channels_provider_columns` (migração 0002) só
   admite `meta_whatsapp`, `meta_instagram` e `waha`; `INSERT` com `provider = 'email'` falha
   (conferido no Postgres dev com `pg_get_constraintdef`). Hoje **nenhum canal de e-mail pode
   existir**, o que também trava o envio da F60-S03. Corrigir exige migration
   (`packages/db/drizzle/**` está no escopo da F60-S04). O teste do `DbEmailChannelResolver`
   detecta a constraint e pula os 2 casos que dependem de canal de e-mail; eles rodam sozinhos
   quando ela for corrigida. A persistência foi testada com o resolver como porta, sobre um canal
   WAHA.
2. **Ninguém chama `handleEmailInbound` ainda.** A rota segue montada inerte
   (`createInertEmailWebhookRouter`, recusa tudo) e o roteamento do consumidor está em
   `worker.ts`/`index.ts`/`webhooks/index.ts`, fora desta fronteira. A ligação natural é junto do
   provedor real (F60-S04): `onInbound` publica o `NormalizedInboundEmail` e o consumidor chama
   `handleEmailInbound(payload, deps)`. O contrato é o Zod `emailInboundPayloadSchema`.
3. **Índice para a busca de thread.** `findThreadConversation` filtra por canal e por
   `external_id IN (...)`; o único índice com `external_id` é `(conversation_id, external_id)`.
   Com volume, vale `messages (workspace_id, external_id)` — o mesmo índice serve o `findMessage`
   do worker de mídia, que já consulta por `external_id`.
4. **Corpo do webhook limitado a 10 MB** (`express.raw` da rota). O Postmark manda até 35 MB de
   inbound; com anexos em base64 isso precisa subir junto com o provedor real — o anexo continua
   limitado a 10 MB pela política do worker.
5. **`Message-ID` do provedor.** A thread casa respostas a mensagens NOSSAS pelo `external_id` do
   outbound, que hoje é o id devolvido pelo provedor. Se o Postmark devolver um id próprio diferente
   do cabeçalho `Message-ID` SMTP, a F60-S04 precisa gravar o cabeçalho (ou fixar o `Message-ID`
   no envio).

## Resultado da validação (2026-10-07, worktree, Postgres/Redis/RabbitMQ locais)

- `pnpm typecheck` — 0 erros em todos os projetos.
- `eslint` nos arquivos tocados — 0 problemas. `prettier` nos arquivos novos.
- `@hm/channels` — 336/336 (54 novos: 36 `url-policy`, 16 `sanitize`, 2 `fake-provider`).
- `@hm/workers` — 839 verdes, 2 pulados (os do resolver, lacuna 1); 71 nos 3 arquivos de teste
  novos (27 de busca anti-SSRF, 31 de política/ingestão, 13 de integração).
- `@hm/api` — 1658 verdes; `email.test.ts` 29/29 (13 novos). 1 falha pré-existente e alheia:
  `accounts-journey.integration.test.ts` caso 5 dispara `tsx --env-file=<worktree>/.env`, arquivo
  que não existe numa worktree.
