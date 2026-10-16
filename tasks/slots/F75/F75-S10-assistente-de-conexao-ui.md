---
id: F75-S10
title: Assistente de conexão em 5 passos — autorizar, escolher, mapear com o Copiloto, testar e sincronizar
phase: F75
status: blocked
priority: high
estimated_size: L
model: opus
ui: true
depends_on: [F75-S09, F75-S03, F75-S04, F75-S05, F75-S12, F76-S03]
blocks: [F75-S15]
source_docs:
  - docs/features/INTEGRACOES.md
  - docs/design/copilot-integracoes.html
  - docs/design/copilot-integracoes-ux.md
  - docs/features/MASCOTE_ANIMACOES.md
agent_id: frontend-engineer
---
# F75-S10 — Assistente de conexão (UI): B3 e importação de planilha

## Objetivo

Conectar leva minutos e não assusta: autorizar sem copiar chave quando dá, escolher o que sincronizar e em que
direção, ver os campos caírem nos lugares certos (com o Copiloto propondo e marcando o que revisar), testar com 5
registros reais com o tamanho do problema na carga completa e duas saídas concretas, e acompanhar a primeira
sincronização com relatório. Nada é gravado até o passo 5; o progresso fica salvo por passo.

## Contexto

Maquete `?solo=wizard` (passos 1–5, `wizard-passo3-*`, `wizard-passo4-*`), nota de UX §5. APIs: credenciais e
OAuth (S03), proposta e gravação de mapeamento (S05), teste com amostra e progresso por socket (S04), rascunho e
ativação (S07), upload e relatório de planilha (S12). Indicador "pensando" do F76-S03 (`Thinking`) no passo 3 e
`LongWait` com progresso no passo 5.

## Escopo (faz)

- Rota `apps/web/app/(app)/integracoes/[slug]/conectar/page.tsx`: tela cheia (diálogo `role="dialog"`
  `aria-label`), topo com monograma, "Você pode sair e continuar depois", ×; trilho de 5 passos clicáveis só até o
  passo alcançado; rodapé "Passo N de 5", Voltar, Continuar (primário). Reabre no passo salvo (`wizardState`).
- **Passo 1 — Autorizar:** opções do manifesto: OAuth ("Entrar com a conta do <sistema>", recomendado, abre o
  fluxo e volta em `?passo=2`), chave colada (campo `password` com Mostrar, teste ao gravar, `fingerprint` depois),
  planilha (`csv-import`: área de soltar arquivo + escolher, mostra colunas e 5 linhas); caixa "As credenciais
  ficam num cofre criptografado…" da maquete; erros de OAuth (`?erro=`) explicados em PT-BR.
- **Passo 2 — O que sincronizar:** tabela com switch por entidade, segmentado de direção (`Leadium → externo` e
  `ambos` desabilitados quando o manifesto não tem `push`), volume quando o conector informa; checkbox "Criar um
  negócio ganho quando um pedido for faturado"; ligar escrita abre a confirmação **nível 4** (lista do que será
  escrito + "Revisei" que libera o botão).
- **Passo 3 — Mapear campos:** tabela "Campo no <sistema> → Campo no Leadium → Confiança" com `select` por linha,
  `obrigatório`, exemplo, medidor de confiança (≥ 80%) ou "revisar · 71%" (warn) ou "falta"; sub-mapa de enum
  (`Faturado → Ganho`); painel lateral do Copiloto com textarea do exemplo (mono 12 px), "Propor mapeamento" ⇒
  `Thinking` ("Lendo o exemplo…") enquanto propõe ⇒ linhas preenchidas com animação curta de entrada (só
  `opacity`/`transform`, reduced-motion ⇒ sem animação); "O exemplo é usado só para este mapeamento e não fica
  salvo."; obrigatório sem destino **bloqueia o Continuar** dizendo qual campo falta. No celular, o painel do
  Copiloto vira seção acima da tabela e a tabela vira lista empilhada.
- **Passo 4 — Testar:** tabela dos 5 registros (pronto/revisar), caixa de erro com tamanho ("1 de 5 com problema:
  telefone sem DDD… cerca de 3% dos clientes (≈ 72)") e as `fixes` como botões que aplicam o transform e
  re-testam.
- **Passo 5 — Sincronizar:** ativa, barras por entidade com contagem real via `integration:sync_progress`
  (`LongWait` com `progress`), "Pode fechar esta tela: avisamos quando terminar", relatório final (registros,
  negócios ganhos criados, ignorados com "Ver motivos", corrigidos) e "Ver painel da integração" / "Perguntar ao
  Copiloto sobre os dados" (este último só navega para `/copiloto?contexto=integracao:<id>` se a rota existir;
  senão não aparece).
- Planilha: o mesmo assistente com `file_upload` (passo 1 = arquivo; passo 2 escolhe a entidade e a coluna-chave;
  3, 4 e 5 iguais; relatório do S12 com "Baixar linhas rejeitadas").
- Acessibilidade: foco no título de cada passo ao trocar, `aria-live="polite"` para "Passo 3 de 5" e para o
  veredito do teste, trap de foco no diálogo, Esc pergunta antes de sair se há mudança não salva no passo.

## Fora de escopo

- Painel de saúde (S11). Qualquer endpoint.

### files_allowed

- `apps/web/app/(app)/integracoes/[slug]/conectar/**`
- `apps/web/features/integrations/wizard/**`
- `apps/web/e2e/specs/integrations-wizard.spec.ts`

### files_forbidden

- `apps/web/features/integrations/shared/**` (S09; pedir via `tasks/COMMS.md` se faltar algo no cliente da API)

## Definition of Done

- [ ] fiel à maquete B3 nos 5 passos, dois temas, 1440 e 375 (comparar com `wizard-*`)
- [ ] fechar no passo 3 e voltar reabre no passo 3 com o mapeamento (e2e)
- [ ] obrigatório sem destino bloqueia o Continuar e diz qual (teste)
- [ ] escrita no externo só liga depois do "Revisei" (teste)
- [ ] fluxo de planilha: subir CSV ⇒ mapear ⇒ testar ⇒ importar ⇒ relatório (e2e com API mockada)
- [ ] `Thinking` aparece no passo 3 só enquanto propõe; reduced-motion respeitado
- [ ] capturas 375/768/1440 × dark/light em `apps/web/e2e/.artifacts/f75-s10/`; axe sem violação séria;
      orçamento de peso (o assistente é chunk próprio, carregado só nesta rota)
- [ ] revisão `/hm-designer` aprovada contra B3

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm exec eslint apps/web/features/integrations/wizard "apps/web/app/(app)/integracoes"
pnpm --filter @hm/web exec vitest run features/integrations/wizard --maxWorkers=1
```

## Notas

- Agente: `frontend-engineer`. Máximo de 2 frontends em paralelo (memória): não rodar junto com dois slots de UI
  da F76.
