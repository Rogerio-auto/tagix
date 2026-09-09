---
id: F61-S11
title: Mídia honesta — recuperar o recuperável, admitir o perdido
phase: F61
status: available
priority: critical
estimated_size: M
depends_on: []
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer

---
# F61-S11 — Mídia honesta

## Objetivo

Parar de girar "carregando áudio…" para sempre em mídia que não existe mais, recuperar a
mídia que ainda dá para recuperar, e nunca mais descobrir que o storage caiu por print de
cliente.

## Contexto

Reportado em produção (2026-09-09): todo o histórico de conversa mostra mídia em carregamento
infinito ou erro. A investigação encontrou **três causas distintas**, e só uma delas é código.

### Causa 1 — credencial R2 inválida (fora do código)

Testado de dentro do container da API com as credenciais reais do `.env`:

```
PUT  objeto novo        → AccessDenied 403
HEAD objeto existente   → 403
HEAD objeto inexistente → 403   (token válido devolveria 404)
```

Conta e bucket batem com os hosts gravados nas URLs; as credenciais chegam íntegras ao
container. O token da Cloudflare foi revogado ou está com escopo errado. **Só o dono da conta
resolve** — precisa gerar token com `Object Read & Write` no bucket `leadium-production`.

Enquanto isso: toda signed URL tem TTL de 7 dias, a mídia do histórico é de julho/2026, e o
endpoint de refresh (F52-S06) regenera a URL **assinada com a credencial morta** — a URL nova
também dá 403.

### Causa 2 — upload pelo compositor nunca gravou `mediaKey` (código)

183 mensagens têm `media_url` mas não têm `metadata.mediaKey`, então o refresh devolve 404 e a
mídia é declarada perdida sem ser. A chave está no path da própria URL — dá para derivar.

### Causa 3 — a UI não tem estado para "não existe mais" (código)

561 mensagens têm `media_url` nula e nunca terão: 324 são `coexistence_echo` (eco do WhatsApp do
próprio cliente, que não expõe download) e 219 não têm chave nem origem. O link do provedor
expira em ~30 dias. `deriveMediaState` mapeia `url === null` para `pending`, então essas giram
para sempre. Carregando infinito é pior que erro: não dá ao usuário nada para fazer.

## Escopo

### files_allowed

- `apps/api/src/routes/uploads.ts`
- `apps/api/src/routes/conversations/media.ts`
- `apps/api/src/routes/conversations/*.test.ts`
- `apps/api/src/health/**`
- `apps/web/features/conversations/components/MessageBubble/**`
- `packages/db/drizzle/**`
- `packages/storage/src/**`
- `scripts/backfill-media-key.ts`

### files_forbidden

- `packages/db/src/schema/messages.ts`
- `apps/workers/src/inbound/**`

## Escopo (faz)

1. **`uploads.ts` grava `metadata.mediaKey`** no envio — a causa 2 deixa de produzir novos casos.
2. **Backfill** que deriva `mediaKey` da `media_url` quando ausente (recupera 183).
3. **Marca a mídia irrecuperável** com `metadata.mediaUnavailable = true` (561), com o motivo.
4. **Quarto estado na UI**: `unavailable`, distinto de `pending` e de `error` — sem botão
   "Tentar novamente", com texto que diz a verdade.
5. **Health check do storage**: no boot e no `/health`, um round-trip real (put/head/delete de
   uma chave de sonda). Credencial morta vira alarme, não print de cliente.

## Fora de escopo

- Trocar o token R2 (não é código; depende do dono da conta).
- Rebaixar TTL ou migrar para URL pública com token de acesso — merece slot próprio.

## Definition of Done

- [ ] Upload pelo compositor grava `mediaKey`; teste cobre.
- [ ] Backfill roda idempotente e é seguro rodar duas vezes.
- [ ] Mídia sem chave e sem URL mostra "não disponível", não spinner.
- [ ] `deriveMediaState` tem teste para o estado novo, incluindo precedência.
- [ ] Health check falha alto quando a credencial de storage não escreve.
- [ ] Nenhum texto de UI culpa o usuário nem promete recuperação que não vai acontecer.

## Validação

```bash
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A regra: **carregando é promessa**. Só mostre spinner quando algo de fato está a caminho.
