---
id: F61-S12
title: Hoje enriquecida — identidade, linguagem, ação e distribuição
phase: F61
status: review
priority: critical
estimated_size: L
depends_on: [F61-S02]
blocks: []
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: backend-engineer
claimed_at: 2026-09-09T19:59:44Z
completed_at: 2026-09-09T20:16:58Z

---
# F61-S12 — Hoje enriquecida

## Objetivo

A F61-S02 entregou a estrutura certa e o conteúdo errado. A tela responde as três perguntas
do dono, mas com dado que não dá para agir: 199 dos 200 contatos aparecem como "Contato sem
nome", a prévia diz `[voice]`, e não há nada a fazer além de abrir a conversa.

Esta slot faz a tela **entregar**, não só existir.

## Contexto — o que produção mostra

Medido em 2026-09-09, workspace real:

| Sintoma | Número | Causa |
|---|---|---|
| "Contato sem nome" | 199 de 200 contatos | o parser WA nunca lê `value.contacts[0].profile.name` |
| Prévia `[voice]`, `[image]` | dominante | 3 de 4 geradores de prévia emitem `[${type}]` cru |
| Sem ação na linha | todas | a linha é um `<Link>` e nada mais |
| Fila de espera | 61 conversas | a tela mostra 10 e escreve "61 no total" |

### Causa 1 — o nome nunca é capturado

O envelope do WhatsApp Cloud API traz o perfil do remetente em `value.contacts[]`:

```json
{ "value": { "contacts": [{ "profile": { "name": "Ana" }, "wa_id": "5566..." }],
             "messages": [ ... ] } }
```

`webhook.parser.ts` navega **só** `value['messages']` e `value['statuses']`. O `case 'contacts'`
da linha 78 é outra coisa: é o *tipo de mensagem* cartão-de-contato. `InboundEvent` carrega
`contactRemoteId` e nenhum campo de nome, e `ensureContact` (`inbound/db-ports.ts:814`) insere
`{ workspaceId, phone, source }` — `display_name` fica nulo para sempre.

Não é bug de exibição. O dado nunca entrou.

### Causa 2 — quatro geradores de prévia, três errados

| Local | Comportamento |
|---|---|
| `flows/outbound-publisher.ts:175` | humanizado — "🎤 Mensagem de voz" |
| `inbound/db-ports.ts:313` | `[${type}]` |
| `coexistence/db-ports.ts:209` | `[${type}]` |
| `outbound/db-ports.ts:91` | `[${type}]` |

Alguém já tinha resolvido isso uma vez, num arquivo só. Quatro cópias de uma regra é a
garantia de que três estarão erradas.

### Causa 3 — "sem nome" é uma escolha, e é a errada

Todo contato do workspace tem telefone (é a chave de `uq_contacts_workspace_phone` e o próprio
`remote_id` do WA). A tela tem identidade para mostrar e escolhe não mostrar. Um telefone
formatado identifica um lead; "Contato sem nome" não identifica nada e ainda soa como defeito.

### Causa 4 — top-10 plano não é triagem

61 esperando em lista única ordenada por antiguidade: o dono vê os 10 mais velhos, que são
justamente os mais frios, e não vê os que ainda dá para salvar. A ordenação está certa para
uma fila; está errada para uma tela de decisão.

## Escopo

### files_allowed

- `packages/channels/src/meta/whatsapp/webhook.parser.ts`
- `packages/channels/src/types.ts`
- `packages/channels/src/**/*.test.ts`
- `packages/shared/src/preview.ts`
- `packages/shared/src/preview.test.ts`
- `packages/shared/src/phone-display.ts`
- `packages/shared/src/phone-display.test.ts`
- `packages/shared/src/index.ts`
- `apps/workers/src/inbound/db-ports.ts`
- `apps/workers/src/coexistence/db-ports.ts`
- `apps/workers/src/outbound/db-ports.ts`
- `apps/workers/src/flows/outbound-publisher.ts`
- `apps/workers/src/**/*.test.ts`
- `apps/api/src/routes/dashboard/**`
- `apps/web/features/today/**`

### files_forbidden

- `packages/db/src/schema/**`
- `apps/api/src/routes/conversations/state.ts`

## Escopo (faz)

### 1. Identidade — nome real ou telefone, nunca "sem nome"

- `InboundEvent` ganha `contactName?: string | null`; o parser lê `value.contacts[].profile.name`
  e casa por `wa_id` com o remetente da mensagem.
- `ensureContact` grava `display_name` **na criação** e **preenche quando está nulo** — nunca
  sobrescreve nome que alguém digitou. O nome do WhatsApp é palpite do dono do aparelho; o
  nome no CRM é decisão do atendente, e decisão ganha de palpite.
- `packages/shared/src/phone-display.ts` formata E.164 pelo market pack: BR `(66) 99934-2444`,
  US `(305) 555-0142`. Desconhecido cai no E.164 original — nunca inventa formato.
- A tela usa `displayName ?? telefoneFormatado`. "Contato sem nome" some do produto.

### 2. Prévia — uma regra, humanizada

- `packages/shared/src/preview.ts` com `previewFor(type, content)` e `humanizePreview(raw)`.
- Os quatro geradores passam a chamá-la. Três param de emitir `[voice]`.
- `humanizePreview` **normaliza na leitura** o que já está gravado: `[voice]` → "🎤 Mensagem de
  voz". Sem migration, e a lista de conversas se beneficia junto.

### 3. Ação na linha — o item sai da tela

Três ações, na zona do polegar:

| Ação | O que faz | Por quê |
|---|---|---|
| **Responder** | abre a conversa | é o que resolve de verdade |
| **Depois** | `snooze` até amanhã 8h no fuso do workspace | sai hoje, volta quando dá para agir |
| **Perdido** | move o deal para o estágio `is_lost` e resolve a conversa | sai e **registra por quê** |

"Perdido" usa `ensureDealForConversation` (F47-S12) + o estágio com `is_lost = true` do pipeline
do workspace — produção já tem "Perdido" e "Não convertido" configurados. Um botão que só
esconde a linha seria mentira: o lead sumiria da tela e do número, sem virar aprendizado.

### 4. Distribuição — triagem, não fila

Os 61 viram três grupos com contagem, do mais urgente ao mais frio:

- **Esfriando** (> 1h) — o maior grupo, e o que o dono precisa ver primeiro
- **Atenção** (15 min – 1h)
- **Agora** (< 15 min)

Cada grupo mostra até 5 e diz quantos faltam. O total continua visível.

## Fora de escopo

- Backfill de nomes históricos: o WhatsApp não reexpõe o perfil de mensagens antigas. Os 199
  ganham telefone formatado agora e nome quando escreverem de novo.
- Nome de perfil no Instagram (igsid ≠ telefone) — merece slot próprio.
- Trocar o rótulo "Sistema" das 1.557 mensagens outbound importadas — slot próprio.

## Definition of Done

- [x] Parser captura `profile.name`; teste cobre envelope real com e sem `contacts`.
- [x] `ensureContact` preenche nome nulo e NUNCA sobrescreve nome existente; teste cobre.
- [x] Nenhum gerador de prévia emite `[${type}]`; teste cobre os quatro.
- [x] Prévia já gravada é normalizada na leitura.
- [x] Telefone formatado por market pack; desconhecido cai no E.164 sem inventar.
- [x] "Contato sem nome" não existe mais no código da tela.
- [x] As três ações funcionam e o item sai da lista sem recarregar a tela.
- [x] "Perdido" registra no pipeline; não é só esconder.
- [x] Agrupamento por urgência com contagem por grupo.
- [x] RLS preservada; teste de isolamento continua passando.

## Validação

```bash
pnpm --filter @hm/shared test
pnpm --filter @hm/channels test
pnpm --filter @hm/workers test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/api test
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua: o dono olha a tela no semáforo e sabe **quem** está esperando e **o que fazer**.
  Nome, prévia e ação são as três coisas que faltavam para isso ser verdade.

## Decisões tomadas na execução (2026-09-09)

1. **O nome de perfil preenche, nunca sobrescreve.** `fillContactName` roda com
   `WHERE display_name IS NULL`. O nome do WhatsApp é palpite do dono do aparelho ("Eu", "Casa",
   um emoji); o nome no CRM é decisão de quem atende. Decisão ganha de palpite — e o `WHERE`
   ainda deixa a operação idempotente e imune a corrida entre consumidores.

2. **O parser casa por `wa_id`, nunca por `contacts[0]`.** Um `value` pode trazer mensagens de
   contatos diferentes; pegar o primeiro colaria o nome de uma pessoa na conversa de outra. Há
   teste para isso.

3. **Nome em branco não vira nome.** Gravar `""` trocaria "sem nome" por "com nome vazio": some
   da tela E some do diagnóstico.

4. **Prévia humanizada na LEITURA, sem migration.** As linhas antigas carregam o tipo dentro do
   próprio marcador (`[voice]`), então dá para traduzir na saída. O regex é ancorado nas duas
   pontas de propósito: "[URGENTE] preciso de orçamento" é a mensagem mais valiosa da fila, e um
   regex frouxo a transformaria em "💬 Mensagem". Há teste para isso.

5. **Telefone formatado pelo DDI do número, não pelo market pack do workspace.** Usar a
   configuração erraria justamente no caso que importa: o cliente brasileiro nos EUA, que atende
   os dois. DDI desconhecido devolve o E.164 como veio — um número que parece errado não é
   discado.

6. **"Sem identificação" em vez de "Contato sem nome"**, e só quando não há nome NEM telefone.
   O texto antigo aparecia em 199 de 200 linhas e soava como defeito do produto.

7. **`WAITING_LIMIT` subiu de 10 para 30.** Com 61 na fila, um top-10 por antiguidade mostrava
   só os mais frios — os únicos que já não dá para salvar — e escondia os que ainda dá.

8. **"Esfriando" no topo**, contrariando a intuição de mostrar o mais novo primeiro. Quem espera
   há duas horas está prestes a fechar com o concorrente; quem escreveu há três minutos ainda
   espera com paciência.

9. **As faixas são contadas em SQL sobre a fila inteira**, não derivadas da página. O dono
   precisa do tamanho do problema ("38 esfriando"), não do tamanho da página — e contar no
   servidor evita trazer 610 linhas quando o workspace crescer.

10. **"Perdido" é uma chamada, não três.** Reusar as rotas existentes exigiria garantir o card,
    fechar perdido e resolver a conversa — três round-trips de um celular no 4G, com dois estados
    intermediários possíveis. `POST /api/dashboard/today/:id/lost` faz tudo numa transação: ou o
    lead vira perdido registrado, ou nada muda.

11. **"Perdido" mexe no pipeline de verdade.** Um botão que só some com a linha seria mentira: o
    lead sumiria da vista e do número, sem virar aprendizado. Fecha o card (`closed_won = false`)
    e grava no `deal_history` — é assim que o dono descobre, no fim do mês, quantos perdeu por
    demora.

12. **Sem pipeline configurado, "Perdido" ainda resolve a conversa.** O dono pediu para sumir da
    tela; a ausência de pipeline é problema de configuração, não motivo para o botão não funcionar.

13. **"Depois" e "Resolver" NÃO ganharam rota nova** — usam `POST /api/conversations/:id/status`,
    que já tem guard de visibilidade, permissão dinâmica, marcos de ciclo e relay de socket.
    Duplicar isso criaria uma segunda verdade sobre quem pode fechar conversa.

14. **`::timestamptz` explícito no `sql` cru.** Num template cru o driver não infere o tipo do
    parâmetro e rejeita `Date`; os helpers tipados (`lt`/`gte`) convertem sozinhos, o template
    não. Custou um ciclo de teste.

## Resultado

- **16 testes** em `dashboard/today` (era 9), **16** no parser WA (era 11), **17** novos em
  `@hm/shared` (`preview` + `phone-display`).
- Suítes: `@hm/shared` 143 · `@hm/channels` 221 · `@hm/workers` 493 · `@hm/web` 190 — todas verdes.
- Typecheck limpo em `@hm/api`, `@hm/web`, `@hm/workers`, `@hm/channels`, `@hm/shared`.
- Lint: 0 erros.

## O que NÃO foi feito, e por quê

- **Backfill de nomes históricos**: o WhatsApp não reexpõe o perfil de mensagens antigas. Os 199
  contatos ganham telefone formatado agora e nome quando escreverem de novo.
- **Nome de perfil no Instagram**: igsid não é telefone e o caminho é outro — slot próprio.
- **Rótulo "Sistema"** das 1.557 mensagens outbound importadas: é dado de importação, não bug
  desta tela — slot próprio.
