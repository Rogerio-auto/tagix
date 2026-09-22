---
id: F61-S11
title: Mídia honesta — recuperar o recuperável, admitir o perdido
phase: F61
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T19:42:10Z
completed_at: 2026-09-09T19:50:54Z

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

### Causa 2 — 183 mensagens antigas sem `mediaKey` (dado, não código)

183 mensagens têm `media_url` mas não têm `metadata.mediaKey`, então o refresh devolve 404 e a
mídia é declarada perdida sem ser.

**O código já está certo.** A cobertura por mês em produção mostra o corte exato:

| Mês | Com `media_url` | Com `mediaKey` |
|---|---|---|
| 2026-06 | 260 | 80 |
| 2026-07 | 656 | 653 |

O `mediaKey` passou a ser gravado (`routes/conversations/messages.ts`, via `uploads.ts` que já
devolve `key`) e desde então funciona. Os 183 são resíduo anterior — e a chave está no path da
própria URL, então dá para derivar por backfill.

### Causa 3 — a UI não tem estado para "não existe mais" (código)

561 mensagens têm `media_url` nula e nunca terão: 324 são `coexistence_echo` (eco do WhatsApp do
próprio cliente, que não expõe download) e 219 não têm chave nem origem. O link do provedor
expira em ~30 dias. `deriveMediaState` mapeia `url === null` para `pending`, então essas giram
para sempre. Carregando infinito é pior que erro: não dá ao usuário nada para fazer.

## Escopo

### files_allowed

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

1. **Backfill** que deriva `mediaKey` da `media_url` quando ausente (recupera 183). O caminho de
   escrita já grava a chave; isto só limpa o resíduo histórico.
2. **Marca a mídia irrecuperável** com `metadata.mediaUnavailable = true` (561), com o motivo.
3. **Quarto estado na UI**: `unavailable`, distinto de `pending` e de `error` — sem botão
   "Tentar novamente", com texto que diz a verdade.
4. **Health check do storage**: no boot e no `/health`, um round-trip real (put/head/delete de
   uma chave de sonda). Credencial morta vira alarme, não print de cliente.

## Fora de escopo

- Trocar o token R2 (não é código; depende do dono da conta).
- Rebaixar TTL ou migrar para URL pública com token de acesso — merece slot próprio.

## Definition of Done

- [x] Backfill roda idempotente e é seguro rodar duas vezes.
- [x] Mídia sem chave e sem URL mostra "não disponível", não spinner.
- [x] `deriveMediaState` tem teste para o estado novo, incluindo precedência.
- [x] Health check falha alto quando a credencial de storage não escreve.
- [x] Nenhum texto de UI culpa o usuário nem promete recuperação que não vai acontecer.

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

## Decisões tomadas na execução (2026-09-09)

1. **A credencial R2 não é código, e a migration não finge que é.** O backfill recupera a chave e
   marca o irrecuperável, mas nada aqui faz mídia aparecer enquanto o token estiver revogado.
   Escrever código que "tenta contornar" storage sem credencial só adiciona um caminho de falha.

2. **`unavailable` vem ANTES de `error` na precedência, mas depois da URL.** Um arquivo que não
   existe não está carregando nem falhou de forma recuperável — é o fato mais específico. Mas se o
   servidor entregar uma URL (backfill posterior, mídia reenviada), a URL manda: a marca velha não
   pode esconder mídia que voltou.

3. **Sem "Tentar novamente" no estado `unavailable`.** O botão existe para dar saída; oferecê-lo
   onde já sabemos que não há saída é pior que não ter botão nenhum.

4. **Tom neutro, não `danger`.** Nada quebrou agora e nada foi culpa de quem está olhando. É um
   fato do histórico, e a bolha diz o fato.

5. **O probe de storage é um `put`, não um `getSignedUrl`.** Assinar URL é operação local — não
   toca a rede e passa com credencial morta. Foi exatamente por isso que o incidente durou dias.
   Há um teste que cai se alguém trocar o probe por uma operação local.

6. **Storage caído NÃO devolve 503.** 503 tira a API de rotação; uma plataforma inteira fora do ar
   é pior que mídia que não carrega. O corpo do `/health` diz `degraded` e o log alarma — a decisão
   de reciclar o container não muda.

7. **O probe é cacheado por 60s e loga só na transição.** O Swarm chama `/health` a cada poucos
   segundos; um write por chamada seria desperdício de cota, e alarme que repete a cada minuto vira
   ruído e é ignorado.

## Resultado

- Migration `0075` — dry-run em produção confirma **183** chaves derivadas e **561** mídias marcadas
  como indisponíveis, exatamente as medidas na investigação.
- 4 testes novos em `useMediaResource` (10 no arquivo), 5 em `health.test` (11 no arquivo).
- `pnpm --filter @hm/web test`: 190/190. Typecheck limpo em `@hm/api` e `@hm/web`. Lint: 0 erros.

## Pendência que NÃO é código

Gerar novo token R2 na Cloudflare (`Object Read & Write` em `leadium-production`) e trocar
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` em `/opt/leadium/.env`. Sem isso, as 916 mídias
recuperáveis continuam sem abrir.
