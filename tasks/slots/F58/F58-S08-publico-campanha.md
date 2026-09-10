---
id: F58-S08
title: Facilitar a escolha dos destinatários
phase: F58
status: review
priority: high
estimated_size: M
depends_on: [F58-S06]
blocks: [F58-S12]
agent_id: fullstack-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/features/PERMISSIONS.md
  - docs/UX_PRINCIPLES.md
claimed_at: 2026-09-10T03:04:04Z
completed_at: 2026-09-10T03:37:00Z

---
# F58-S08 — Facilitar a escolha dos destinatários

## Objetivo

Substituir a caixa de texto CSV por uma importação guiada, com prévia honesta do
público e consentimento explícito antes de qualquer ativação.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/audience/**`
- `apps/api/src/routes/campaigns/recipients.ts`
- `apps/api/src/routes/campaigns/recipients.test.ts`
- `apps/api/src/routes/campaigns/recipients.batch.test.ts`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/workers/**`

## Definition of Done

- [x] Upload aceita arquivo CSV e mantém colar dados como alternativa; parser trata aspas, vírgulas e cabeçalhos.
- [x] Mapeamento de telefone/nome/consentimento é mostrado antes da importação.
- [x] Prévia separa válidos, inválidos, duplicados, já existentes e sem consentimento.
- [x] Registro de consentimento exige origem legível; não existe checkbox ambíguo “dar opt-in”.
- [x] API processa 1.000+ linhas em lote, sem SELECT/INSERT por linha, e devolve relatório paginável.
- [x] Reimportação é idempotente e nunca remove destinatários silenciosamente.
- [x] Testes cobrem 1.001 linhas, duplicados, CSV citado, E.164 e isolamento RLS.

## Validação

```bash
pnpm --filter @hm/api test -- src/routes/campaigns/recipients.test.ts
pnpm --filter @hm/web test
pnpm --filter @hm/api typecheck
pnpm --filter @hm/web typecheck
```

## Notas

- Segmentação salva fica fora deste slot; o empty state pode anunciá-la como evolução futura sem CTA morto.

## Decisões tomadas na execução (2026-09-09)

1. **O `split(',')` tinha que morrer.** O parser anterior corrompia em silêncio o arquivo mais
   comum que existe: `+5566999342444,"Silva, João"` virava um nome cortado e uma coluna
   deslocada. Ninguém percebia até a mensagem sair errada para mil pessoas. O leitor novo é uma
   máquina de estados de um caractere — a única forma de tratar quebra de linha DENTRO de aspas.

2. **O arquivo vem do Excel em português, do Windows.** Por isso: ponto e vírgula como separador,
   BOM do UTF-8 removido, CRLF, e aspas escapadas (`""`). Cada um desses sozinho faz a importação
   inteira falhar com o arquivo certo na mão.

3. **BOM escrito como `﻿`, não literal.** O caractere é invisível no editor: literal, vira
   um bug que ninguém consegue ver ao ler o código. O lint concorda (`no-irregular-whitespace`).

4. **Sinônimos de cabeçalho em português e inglês.** O cliente anexa a planilha DELE. Se o
   cabeçalho diz "celular" e nós só entendemos "phone", nada funciona.

5. **O mapeamento de colunas é um PALPITE EXIBIDO.** Palpite escondido é um bug esperando a hora
   de aparecer com mil mensagens já enviadas.

6. **Arquivo sem cabeçalho não perde a primeira linha.** `looksLikeHeader` distingue
   `phone,name` de `+5566999342444,Ana`. Tratar a segunda como cabeçalho descartaria um contato,
   e o cliente jamais notaria que faltou um.

7. **Cinco categorias na prévia, porque são cinco decisões.** Juntar "inválido" com "repetido"
   pouparia código e custaria a decisão: só um dos dois é problema do arquivo.

8. **Repetido é detectado APÓS normalizar.** A planilha mistura `(66) 99934-2444` e
   `+5566999342444`; sem normalizar antes de comparar, a mesma pessoa receberia duas vezes.

9. **`normalizePhone` é conservador, e o teste pegou onde eu não fui.** `5551234` começa com "55"
   e tem sete dígitos — o bastante para o formato E.164 aceitar —, então virava um `+5551234`
   que parece válido, entra no público e falha (ou entrega para outra pessoa) só no envio.
   A correção foi exigir o tamanho do número NACIONAL, não só o formato.

10. **A exigência de consentimento vem do mercado, não é fixa.** Nos EUA marketing exige
    consentimento prévio; no Brasil, em canal já em uso, não. Fixar `true` bloquearia o cliente
    brasileiro sem base legal; fixar `false` deixaria o americano exposto.

11. **Não existe "dar opt-in a todos".** Existe registrar DE ONDE veio, e o campo é obrigatório
    (mín. 3 caracteres) tanto na importação quanto no registro em lote. Antes era opcional e
    virava NULL em silêncio. Marcar mil pessoas como "aceitaram receber" sem dizer onde não é
    consentimento: é uma afirmação sem prova — e nos EUA a prova é o que separa uma campanha de
    uma multa por mensagem.

12. **A importação virou LOTE: de 2.000+ round-trips para poucas consultas.** A versão anterior
    fazia SELECT + INSERT por linha dentro de uma transação. Em lista real isso não é lentidão, é
    timeout — e timeout no meio deixa o público pela metade sem ninguém saber quais faltaram.
    Medido: **1.001 linhas em 2,9s**; reimportação em 0,5s.

13. **O resumo cobre o arquivo inteiro; o relatório é limitado a 1.000 linhas.** Senão o cliente
    veria "1000 importados" para um arquivo de 1001.

14. **Reimportar nunca remove ninguém.** É a operação que o cliente faz quando acha que deu
    errado — exatamente a hora em que ele não pode perder metade do público.

15. **O arquivo é lido no NAVEGADOR.** A conferência acontece antes de qualquer byte sair da
    máquina do cliente.

## Resultado

- 38 testes em `@hm/web` (21 do leitor de CSV, 17 da classificação), 7 de integração em `@hm/api`
  contra Postgres real (1.001 linhas, reimportação, duplicados, E.164, consentimento).
- Typecheck limpo. Lint: 0 erros.
- Segmentação salva continua fora do slot, como previsto.
