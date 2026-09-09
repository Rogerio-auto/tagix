# Feature — CONTENT STUDIO

> **Documento:** plano de produto + arquitetura do módulo de conteúdo do tagix
> **Versão:** 0.1 — 2026-09-08
> **Status:** PROPOSTA — aguarda aprovação. Nenhuma linha de código antes disso.
> **Fases sugeridas:** F62 → F66
> **Contexto de negócio:** [`AGENCIA_PLAN.md`](./AGENCIA_PLAN.md)
> **Research de base:** [`../research/2026-09-08-modelo-agencia-local.md`](../research/2026-09-08-modelo-agencia-local.md)

---

## 0. Decisões travadas nesta rodada

| Decisão | Valor | Consequência |
|---|---|---|
| Tenant | **Workspace = empresa cliente da agência.** Você é a agência. | Sem hierarquia agência→subconta, sem white-label revendido. Template de workspace é ferramenta interna de onboarding, não feature vendida. |
| Publicação | **Produz + agenda + publica** (Instagram/Facebook, TikTok) | Entra App Review Meta para `instagram_content_publish`, app TikTok próprio, fila de publicação por rede com falha isolada. |
| Fotos | **Quatro trilhas:** produto/comida, ambiente/serviço, pessoas/retrato, imóveis | Política de intervenção por trilha (§4.2) é requisito, não detalhe. |
| Idioma | **Bilíngue por padrão** (pt-BR + en-US) | Voz de marca calibrada por idioma, não traduzida. Dobra custo de LLM por peça — entra no cálculo de margem (§7). |
| Mercados | **Brasil E Estados Unidos** no mesmo produto | Voz, gatilhos e calendário são sensíveis ao `market` do workspace (§3.5). Nenhuma regra de mercado fora do market pack de [`AGENCIA_PLAN`](./AGENCIA_PLAN.md) §3.1. |
| Nicho de partida | **Reforma e construção residencial** (recomendação em `AGENCIA_PLAN` §7) | Define a matéria-prima de conteúdo e faz da trilha "ambiente/serviço" da F65 a mais importante, não a terceira. |
| Teto de custo | **~US$ 50 / cliente / mês** de IA, dentro do preço de US$ 800 | Budget guard com corte **antes** da chamada. As regras de custo do §5.2 deixam de ser boa prática e viram restrição contratual. |

---

## 1. O problema

Uma empresa de dono brasileiro — construtora, clínica, salão, restaurante, corretor — nos EUA ou no
Brasil, não tem problema de ferramenta. Tem três problemas de trabalho:

1. **Não sabe o que gravar.** Liga a câmera sem tese, fala genérico, o vídeo não vende.
2. **Grava e o material morre.** Horas de vídeo, áudio de WhatsApp, fotos do celular — nada vira peça.
3. **A foto está ruim.** Luz de restaurante, foto de obra no contraluz, retrato no celular.

A agência hoje resolve isso à mão, e é exatamente esse trabalho manual que trava a escala: cada
cliente novo custa horas de estrategista e editor. O Content Studio existe para transformar essas
horas em pipeline, **sem** virar gerador de conteúdo genérico — que é o destino de toda ferramenta
que pula a etapa de voz.

**Princípio central, herdado do padrão editorial da casa:** o modelo decide significado, tese,
narrativa e julgamento. O código lê mídia, normaliza timestamps, mede duração, silêncio, repetição
e sobreposição, valida JSON e renderiza. Nenhum dos dois substitui o outro, e todo campo de todo
artefato registra a origem (`source: "model" | "deterministic"`). É isso que torna o sistema
auditável — um número num relatório ou foi medido por código ou foi julgado por um agente, e o
leitor sabe qual.

---

## 2. Os quatro subsistemas

```text
                    ┌──────────────────────────────────────┐
                    │  1. VOZ DE MARCA (fundação)          │
                    │  material existente → voice card     │
                    │  versionado, bilíngue, com memória   │
                    └───────────────┬──────────────────────┘
                                    │ alimenta tudo abaixo
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐   ┌───────────────────────┐   ┌───────────────────┐
│ 2. ESTRATÉGIA     │   │ 3. STUDIO DE MATERIAL │   │ 4. FOTOS          │
│ (antes de gravar) │   │ (depois de gravar)    │   │                   │
│ tensão → tese →   │   │ upload → transcrição  │   │ upload → trilha → │
│ hooks → roteiro → │   │ → digest → seleção →  │   │ correção /        │
│ crítica → plano   │   │ cortes, carrossel,    │   │ composição →      │
│ de gravação       │   │ legenda, e-mail       │   │ proveniência      │
└─────────┬─────────┘   └───────────┬───────────┘   └─────────┬─────────┘
          └───────────────┬─────────┴─────────────────────────┘
                          ▼
              ┌───────────────────────────┐
              │ 5. APROVAÇÃO + PUBLICAÇÃO │
              │ calendário, fila por rede │
              └───────────────────────────┘
```

A ordem não é arbitrária. **A voz vem primeiro porque é o que separa este módulo de qualquer
gerador de legenda do mercado**, e porque ela sozinha já é um entregável de onboarding que o
cliente percebe como valor no primeiro dia.

---

## 3. Subsistema 1 — Voz de marca

### 3.1 O que é

Não é um campo de texto "descreva seu tom de voz". Formulário produz mentira: todo mundo escreve
"próximo, profissional e descontraído". O voice card é **extraído de evidência**.

Entrada: o material que a empresa já tem — posts antigos, áudios de WhatsApp do dono, vídeos,
página do site, avaliações de clientes. Saída: um `voice_card` que a pessoa revisa e corrige.

### 3.2 O que o voice card carrega

| Bloco | Conteúdo | Origem |
|---|---|---|
| Identidade | quem é, há quanto tempo, o que faz, por que começou | evidência + entrevista curta |
| Público em camadas | comunidade brasileira local / público americano / indicação | declarado + inferido |
| Oferta e prova | o que vende, preço-âncora, provas reais (avaliações, casos, números) | declarado, com fonte |
| Léxico | palavras que a pessoa **usa de verdade**, bordões, jeito de abrir e fechar | extraído do material |
| Antiléxico | o que nunca sai da boca dela; o que soa a marketing | extraído + confirmado |
| Ritmo | frase curta ou longa, direto ou contador de história, formal ou coloquial | medido no material |
| Faceta pt-BR / faceta en-US | duas calibrações separadas, **não tradução** | duas passagens |
| Limites | o que não pode ser prometido (regulado: saúde, imigração, financeiro) | declarado, obrigatório |

### 3.3 Schema (Drizzle, workspace-scoped, RLS obrigatória)

```
brand_profiles          1 por workspace · nicho, mercado, cidade, fusos, idiomas ativos
brand_voice_versions    versionado (espelha o padrão de agent_prompt_versions, já existente)
                        · voice_card jsonb · locale · status draft|active|archived
                        · derived_from (ids das evidências) · approved_by · approved_at
brand_evidence          material fonte · kind post|audio|video|site|review · storage_key
                        · extracted jsonb · content_sha256 (dedup)
brand_memories          feedback duradouro + embedding vector(1536)
                        "roteiros mais diretos", "não usar 'transformar'"
```

`brand_memories` é o mecanismo que faz o sistema **melhorar com o uso** em vez de repetir o mesmo
erro: cada rejeição de peça pode virar memória, e a memória entra no contexto das gerações
seguintes por similaridade. É o mesmo padrão de `kb_chunks`, reaproveitando o índice HNSW já
existente.

### 3.4 Por que isso é a fundação

Sem voice card, a estratégia gera tese genérica e o studio gera legenda de template. Com voice
card versionado e aprovado, toda peça posterior tem um contrato contra o qual ser criticada — e a
etapa de crítica editorial (§4.1) tem o que medir.

### 3.5 Voz é sensível ao mercado, não só ao idioma

Dois clientes do mesmo nicho, um no Brasil e outro na Flórida, não recebem o mesmo conteúdo
traduzido. Muda a prova (avaliação no Google Maps americano versus indicação de WhatsApp), muda a
objeção (licença e seguro do contractor versus prazo e reforma sem sair de casa), muda a
sazonalidade e mudam as datas comerciais.

Por isso `brand_profiles.market` alimenta o pipeline inteiro, e o template de nicho é
`<nicho>/<mercado>` — mesma estrutura de [`AGENCIA_PLAN`](./AGENCIA_PLAN.md) §3.3. O voice card
carrega faceta por **idioma**; o brief carrega o **mercado**. São eixos diferentes: um contractor na
Flórida fala português com a comunidade brasileira sobre objeções americanas.

E o antiléxico é o lugar onde o mercado morde mais rápido: promessa que passa no Brasil ("garantia
total", "o melhor preço da região") vira exposição sob as regras de publicidade da FTC. O bloco
"Limites" do §3.2 é preenchido a partir do market pack, não do gosto do cliente.

---

## 4. Subsistema 2 — Estratégia antes de gravar

### 4.1 O pipeline

```text
gatilho → pesquisa → tensão → tese → hooks → roteiro → crítica → (revisão) → plano de gravação
```

Cada etapa é um artefato validado por Zod antes de ser gravado. O pipeline é **retomável por
etapa** (`--stages`), então refazer só o roteiro não refaz a pesquisa nem gasta de novo.

- **Gatilho** — pergunta real de cliente (vinda da inbox! o tagix já tem as conversas),
  sazonalidade, objeção recorrente, lançamento, data comercial americana.
- **Pesquisa** — base do cliente (`kb_documents` já existe) + conversas reais da inbox +
  web quando o fato for volátil. Todo fato carrega confiança e frescor; fato volátil sem fonte
  primária datada não entra na peça.
- **Tensão → tese → mecanismo** — antes de qualquer hook. **Thesis-before-hook é regra**: nenhum
  hook é gerado antes de existir tese, mecanismo e lacuna cognitiva definidos. É o que impede o
  sistema de produzir "3 dicas para o seu negócio".
- **Hooks** — 6+ candidatos, cada um com o mecanismo que o sustenta e nota em critérios
  explícitos, com violações apontadas.
- **Roteiro** — parágrafos com marcação visual (o que aparece na tela em cada trecho) e claims
  com confiança declarada.
- **Crítica editorial obrigatória** — profundidade, originalidade, promessa versus entrega,
  defensabilidade da afirmação, alinhamento hook/corpo, aderência ao voice card, frases proibidas
  do antiléxico. Veredito + **a menor mudança que resolve**. Loop de revisão com teto.

### 4.2 O plano de gravação — a peça que falta em toda ferramenta

O cliente é dono de restaurante, não criador de conteúdo. Entregar um roteiro é entregar metade.
A saída inclui:

- ordem de gravação (o que gravar junto, para não montar a câmera duas vezes)
- para cada cena: o que falar, **em quantos takes**, e o que a câmera precisa mostrar
- o que gravar de B-roll no próprio negócio (prato saindo, mão trabalhando, antes/depois)
- o que **não** dizer (limites do §3.2, regulatório)
- checagem de luz e enquadramento em uma linha por cena

### 4.3 Estados

```
draft → researching → thesis_ready → script_ready → in_review
      → approved → recorded → assembled → scheduled → published
      (rejected / archived a qualquer momento, com motivo)
```

Aprovação é humana e explícita. **Nada publica sozinho.**

---

## 5. Subsistema 3 — Studio de material

### 5.1 O caminho

```text
upload (vídeo/áudio/foto/PDF/link)
  → normalização (ffmpeg: áudio 16k mono; vídeo probe)
  → transcrição por palavra (adapter, §5.3)
  → digest em blocos de ~20s          ← nenhum agente lê o transcript inteiro
  → seleção de momentos (agente, sobre o digest)
  → janelas por palavra só dos candidatos
  → peças: corte vertical legendado · carrossel · legenda · e-mail · roteiro de anúncio
```

### 5.2 A regra de custo que torna isso viável

Medição feita no pipeline de referência (podcast de 3h, 6.057 segmentos, 40.363 palavras):

| Estratégia | Tokens | Fator |
|---|---|---|
| Transcript completo no contexto | 1.346.173 | 1× |
| Digest em blocos de ~20s | 62.758 | **21,5× menos** |
| Janelas por palavra só dos candidatos | 2.974 | **452× menos** |

Nove de cada dez tokens de um transcript são o array de palavras, e ele não participa de nenhuma
decisão editorial — só da legenda. Segunda regra, aprendida por erro na referência: **nenhum passo
decodifica o vídeo inteiro antes da seleção**. Extrair índice visual do vídeo todo travou num
material de 3h15; adiado para as janelas dos candidatos, o mesmo passo caiu para ~8s.

Estas duas regras são a diferença entre margem e prejuízo por cliente. Entram como restrição de
design, não como otimização posterior.

### 5.3 Transcrição — decisão

Interface `ITranscriptionProvider` com dois adapters, igual ao padrão `IChannelAdapter`/`IStorageDriver`
já usado na casa:

- **API (padrão em produção).** Custo previsível por minuto, latência baixa, sem competir por CPU
  na VPS que já roda cinco workers, o Postgres, o Redis e o RabbitMQ.
- **Local (Whisper) para dev e para lote.** Custo zero, roda na máquina Windows ou num worker
  dedicado. É o modo usado para reprocessar arquivo antigo em massa sem queimar orçamento.

O provider exato e o preço por minuto se verificam na implementação — número volátil não entra em
documento de plano como se fosse fato.

### 5.4 Montagem

Duas perguntas diferentes, dois caminhos:

- **"Onde foi dita esta frase que já foi aprovada?"** — o cliente gravou o roteiro aprovado,
  tropeçou, refez quatro vezes. O sistema localiza cada cena na gravação, escolhe a melhor
  tentativa, apara as bordas, colapsa o tempo morto e cola. É conformidade contra um roteiro.
- **"O que aqui presta?"** — material longo sem roteiro (live, palestra, atendimento gravado).
  Descoberta de momentos publicáveis. Problema diferente, pipeline diferente.

Ambos produzem uma EDL determinística; a renderização é etapa separada e pesada (container
próprio, fila própria — não pode competir com o worker de mídia da inbox).

---

## 6. Subsistema 4 — Aprimoramento de fotos

### 6.1 A distinção que organiza tudo

Não é "filtro forte" versus "filtro fraco". É **factual**:

| Nível | O que faz | Altera o fato? |
|---|---|---|
| **Correção** | exposição, cor, balanço de branco, ruído, verticais/perspectiva, upscale, recorte por formato, remoção de fundo | Não |
| **Composição** | fundo novo, céu trocado, virtual staging, remoção/inserção de objeto | **Sim** |

Correção é determinística (libvips/sharp — já no repo para stickers — e ffmpeg). Composição é
generativa. Separar as duas no schema, na UI e na política é o que impede o produto de virar
passivo do cliente.

### 6.2 Política por trilha — inegociável

| Trilha | Correção | Composição | Regra dura |
|---|---|---|---|
| Produto / comida | livre | fundo, superfície, ambiente | **O produto não pode ser trocado nem embelezado além do que é.** Foto de comida que não é a comida servida é propaganda enganosa. |
| Ambiente / serviço | livre | céu, remoção de entulho e carro | Antes/depois exige que ambos passem pelo **mesmo** tratamento — tratar só o "depois" é fraude visual. |
| Pessoas / retrato | livre | **bloqueada** | Nunca alterar rosto ou corpo. Nem "suavizar pele", nem afinar, nem trocar expressão. Correção de luz e enquadramento, só. |
| Imóveis | livre | staging virtual, céu | Staging virtual **exige marcação visível** na imagem. É exigência de disclosure de associações de corretores nos EUA, e o custo de errar é do cliente. |

### 6.3 Proveniência

Toda imagem de saída carrega `enhancement_ops` — a lista ordenada do que foi aplicado, com
parâmetros, provider e versão. O cliente sabe o que assinou, e a agência consegue defender a peça
se alguém questionar. Custo de implementação: baixo. Valor quando for cobrado: alto.

### 6.4 Schema

```
media_assets        upload original · storage_key · kind · exif jsonb · content_sha256
photo_enhancements  asset_id · track · level correction|composition
                    · ops jsonb · provider · output_key · status · approved_by
```

Providers atrás de `IImageEnhancer`. Nomes de modelo generativo e preço por imagem se decidem na
implementação, com medição — não aqui.

---

## 7. Aprovação e publicação

- **Calendário editorial** por workspace, com fuso do mercado do cliente (§`AGENCIA_PLAN` §3).
- **Aprovação do cliente dentro do tagix**: comentário por peça, revisão, aprovado. O cliente não
  precisa de e-mail nem WhatsApp para aprovar — reduz o ciclo de dias para horas.
- **Publicação por rede, com falha isolada.** Instagram/Facebook via Meta (extensão do App Review
  que a plataforma já tem para mensageria: `instagram_content_publish`, `pages_manage_posts`);
  TikTok via Content Posting API (app e review próprios). Falha em uma rede não derruba as outras;
  cada rede tem estado, retry e limite de publicações por janela próprios.
- **Nada publica sem aprovação humana registrada.**

Limites de taxa, formatos aceitos e regras de container de cada API se verificam na documentação
oficial no momento da implementação de cada slot — são fatos voláteis.

---

## 8. Arquitetura — onde cada coisa roda

| Camada | Responsabilidade | Onde |
|---|---|---|
| `@hm/content-core` (novo pacote TS) | contratos Zod de todo artefato, máquina de estados, regras de crítica | `packages/content-core` |
| API Node | CRUD, upload, transições de estado, entitlements, enfileiramento | `apps/api/src/routes/content` |
| **Worker `content`** (o 6º) | ingestão, transcrição, digest, seleção, fotos | `apps/workers/src/content` |
| **Worker `render`** (7º, container próprio) | montagem e renderização de vídeo | isolado — é pesado |
| `agent-runtime` (Python) | grafos LangGraph: extração de voz, pesquisa, tese, hooks, roteiro, crítica | `apps/agent-runtime` — ADR já decidiu Python para agentes |
| Storage | original, derivados, saídas | R2 via `IStorageDriver`, já existe |
| Custo | toda chamada em `llm_usage_logs` | tabela já existe, estender `request_type` |

**Reuso do `craft-content`:** o projeto vizinho já resolveu o pipeline editorial (`packages/editorial-core`,
TS + Zod), a arquitetura de cortes com as medições de custo do §5.2, a montagem por takes, o kit de
renderização e o guarda de orçamento do OpenRouter. A decisão é **portar o conhecimento e os
contratos, não o runtime**: o `craft-content` é mono-usuário, orientado a sistema de arquivos, sem
`workspace_id` e sem RLS. Reaproveitar o runtime importaria a ausência de multi-tenancy para dentro
de um produto multi-tenant — exatamente o tipo de dívida que este repositório existe para não ter.

### 8.1 Segurança e multi-tenancy

Cada tabela nova nasce com `workspace_id` e política RLS **no mesmo PR** — regra F0-S04, sem
exceção. Além disso:

- Upload de mídia reusa a validação já endurecida em `uploads.ts`: allowlist por **bytes reais**,
  não por header do cliente; SVG bloqueado; teto de tamanho; key sanitizada por workspace.
  O teto atual de 25 MB não serve para vídeo bruto — entra upload em partes (slot próprio).
- Material do cliente é dado sensível. `sensitivity` por asset, e material marcado como
  confidencial nunca vai para provider externo.
- Conteúdo de cliente que entra em prompt é dado, nunca instrução — o endurecimento anti-injeção
  já feito em F56-S11 se aplica a todo agente novo deste módulo.

---

## 9. Faseamento

| Fase | Entrega | Por que nesta ordem |
|---|---|---|
| **F62 — Voz de marca** | ingestão de evidência, extração, voice card bilíngue versionado, revisão humana, memórias | Fundação. As outras três dependem. E entrega valor sozinha no onboarding. |
| **F63 — Estratégia** | pipeline pergunta→crítica, plano de gravação, aprovação | Resolve o problema nº 1 do cliente e não depende de infra pesada de mídia. |
| **F64 — Studio de material** | upload grande, transcrição, digest, seleção, peças, montagem, render | Fase mais pesada de infra. Vem depois porque consome o roteiro aprovado da F63. |
| **F65 — Fotos** | quatro trilhas, correção e composição, política, proveniência | Independente das anteriores. Pode correr em paralelo com F64 se houver braço. |
| **F66 — Calendário e publicação** | aprovação do cliente, calendário, filas Meta e TikTok | Depende de ter peça pronta. App Review roda em paralelo desde a F64 — o prazo é da Meta, não seu. |

**Caminho crítico externo:** o App Review da Meta para publicação e o app do TikTok não dependem de
código pronto para começar. Abrir os dois no início da F64 evita que a F66 fique esperando terceiro.

---

## 10. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Conteúdo genérico | O produto vira gerador de legenda; cliente cancela em 2 meses | Voz por evidência (F62) + crítica editorial obrigatória com veredito de reprovação real |
| Custo de LLM por cliente estoura a margem | Prejuízo por cliente, invisível até a fatura | Regras do §5.2 como restrição de design + `llm_usage_logs` por workspace + teto por peça e por mês, com corte antes da chamada (o padrão de budget guard já existe no `craft-content`) |
| Render de vídeo derruba a inbox | Incidente de produção no produto principal | Worker e container separados, fila própria, limite de concorrência |
| Foto que altera o fato | Passivo do cliente e da agência | Política do §6.2 aplicada em código, não em documentação; proveniência em toda saída |
| App Review negado | F66 escorrega | Abrir cedo, runbook próprio (existe precedente: `meta-app-review-instagram.md`) |
| Escopo do módulo engolir a plataforma | F57/F58 param | Content Studio é módulo com entitlement próprio; nenhum slot dele toca `files_allowed` de campanhas ou inbox |

---

## 11. Decisões — resolvidas e em aberto

**Resolvidas em 2026-09-08:**

| Questão | Resposta | Efeito neste documento |
|---|---|---|
| A empresa cliente entra no tagix? | **Sim** | Calendário, aprovação de peça e dashboard são telas do produto (§7). Some a alternativa "relatório enviado" |
| Teto de custo de IA por cliente | **~US$ 50/mês**, dentro do preço de US$ 800 | Budget guard com corte antes da chamada. §5.2 vira restrição contratual |
| Nicho | **Recomendação: reforma e construção**, um só, com o teste dos três clientes (`AGENCIA_PLAN` §7) | A trilha "ambiente/serviço" da F65 sobe de prioridade. A matéria-prima (antes/depois, obra andando) é abundante e gratuita |
| Mercados | **BR e US** | §3.5. Template por nicho × mercado |

**Ainda em aberto:**

1. **Retenção de material bruto.** Vídeo bruto em R2 é o maior custo de armazenamento do módulo.
   Precisa de política de expiração do original depois da peça pronta — o worker `retention` já
   existe e a decisão é de negócio (o cliente espera reaver o bruto seis meses depois?).
2. **Volume-alvo de peças por cliente/mês.** É o que converte o teto de US$ 50 em número por peça,
   e o que decide se a renderização cabe na VPS ou precisa de máquina própria.
3. **Quem aprova a peça no cliente** — o dono, ou alguém dele? Muda a UI de aprovação e o SLA do
   calendário. Em construção, o dono costuma estar em obra e responder por WhatsApp: talvez a
   aprovação precise sair do produto e ir para o WhatsApp, com o produto só registrando.
