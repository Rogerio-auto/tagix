---
id: F58-S09
title: Escolher a mensagem com prévia e variáveis
phase: F58
status: done
priority: critical
estimated_size: M
depends_on: [F58-S05, F58-S06]
blocks: [F58-S12]
agent_id: frontend-engineer
source_docs:
  - docs/features/CAMPAIGNS.md
  - docs/features/WHATSAPP_MESSAGE_TEMPLATES.md
  - docs/DESIGN_SYSTEM.md
claimed_at: 2026-10-07T17:14:00Z
completed_at: 2026-10-07T17:34:29Z

---
# F58-S09 — Escolher a mensagem com prévia e variáveis

## Objetivo

Eliminar o campo de nome técnico do template. O usuário escolhe um modelo
aprovado, vê exatamente o que será enviado, preenche as variáveis e testa no
próprio telefone antes de continuar.

## Escopo

### files_allowed

- `apps/web/features/campaigns/editor/message/**`

### files_forbidden

- `apps/web/features/campaigns/editor/CampaignEditor.tsx`
- `apps/api/**`

## Definition of Done

- [x] Picker lista somente modelos aprovados do canal, com busca, categoria e idioma. — `TemplatePicker.tsx` (Drawer) sobre `GET /api/campaigns/builder/options?channelId=` (só `APPROVED` + `isAvailable`); busca no nome legível e no texto, sem acento; facetas só com valores existentes (`filterTemplates`/`facetValues`, testados).
- [x] Preview de celular renderiza header, body, footer, mídia e botões sem executar HTML externo. — `PhonePreview.tsx`: só nós de texto, mídia como marcador (sem `<img>`), link de botão como texto (sem `href`). Teste com `<script>`, `<img onerror>` e `javascript:` no modelo/valor.
- [x] Cada variável é mapeada para nome/campo do contato ou valor fixo, com exemplo real e fallback obrigatório. — `VariableMapper.tsx`: dado do contato / campo personalizado / texto fixo; exemplo resolvido com o `sampleContact` (ou texto reserva); `validateMessages` exige `fallback` não vazio (espelho do Zod da API).
- [x] Sequência permite adicionar/reordenar mensagens e definir atraso em linguagem humana. — adicionar (até 8), subir/descer (botões + Alt+↑/↓), remover com confirmação no próprio botão; espera "N minutos/horas/dias depois da mensagem anterior" (1 min–90 dias); "parar a sequência para quem responder".
- [x] **Enviar teste** mostra destinatário, loading, sucesso/falha e impede clique duplicado. — `TestSendPanel.tsx`: número explícito no campo e na confirmação; botão `loading` + trava síncrona por ref; `Idempotency-Key` por intenção (`intentFor`, testado) → clique duplo vira replay; sucesso diz "na fila" (a API responde 202, não "entregue").
- [x] Modelo pausado/rejeitado após seleção bloqueia avanço e oferece escolher outro/sincronizar. — catálogo revalida ao voltar para a aba; modelo fora da lista → `template_unavailable` bloqueia `canAdvance`; `TemplateUnavailable.tsx` mostra o status (Pausado/Precisa de ajustes…) e o motivo da Meta via central de modelos + "Escolher outro modelo" / "Sincronizar com a Meta". Erro `CAMPAIGN_TEMPLATE_NOT_USABLE` no teste reconfere o catálogo.
- [x] Testes cobrem template sem variável, múltiplos idiomas, mídia, botões e variável ausente. — `model.test.ts` (35) + `PhonePreview.test.tsx` (10) = 45 testes.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm --filter @hm/web build
```

## Notas

- O payload final continua usando `templateName/languageCode/components`; essa tradução não deve aparecer para o usuário.

## Entrega (F58-S09)

Tudo em `apps/web/features/campaigns/editor/message/`:

- `model.ts` — regra pura: leitura dos componentes Meta, espaços `{{n}}`, resolução de valor
  (espelho de `builder/render.ts`), segmentos da prévia, formatação do WhatsApp, sequência,
  espera humana, validação completa e a tradução para o contrato (`toStepsPayload` → `templateName`,
  `languageCode`, `bindings`, `delaySeconds`, `stopOnReply`) + hidratação (`fromStoredSteps`,
  `decodeStoredBindings` do envelope `binding_contract/v1`, `attachResolvedTemplates`).
- `queries.ts` — catálogo de aprovados (todas as páginas, revalida no foco), situação do modelo
  na central, sincronizar, envio de teste com `Idempotency-Key`.
- `MessageStep.tsx` (etapa), `TemplatePicker.tsx`, `PhonePreview.tsx`, `VariableMapper.tsx`,
  `TestSendPanel.tsx`, `TemplateUnavailable.tsx`, `MessageHelp.tsx`, `index.ts`.

### Contrato com o orquestrador (F58-S13)

`<MessageStep value onChange mode channelId campaignId sampleContact? customFieldKeys?
defaultTestPhone? senderName? readOnly? showAllErrors? onReadinessChange? />`.
`onReadinessChange` publica `{ canAdvance, issues, payload }`; `payload` é o corpo pronto do
`PUT /api/campaigns/:id/steps` (`{ steps: payload }`). O estado inicial vem de
`fromStoredSteps(detail.steps)` ou `emptyMessageStep()`. A etapa não salva sozinha.

### Decisões

- **Catálogo inteiro no cliente** (páginas de 100, teto 1.000): filtro instantâneo, facetas exatas e
  a MESMA lista responde "o modelo escolhido continua aprovado?". Acima do teto, aviso na tela.
- **Prévia local, servidor como juiz.** A prévia reage a cada tecla; o envio de teste e o preflight
  (F58-S06) continuam validando no servidor. A regra local espelha `render.ts` e é testada.
- **Nada inventado.** O primeiro espaço do texto sugere "Nome do contato", mas o texto reserva vem
  vazio e é exigido; o exemplo aprovado pela Meta é só dica (iria para mil pessoas).
- **Botão com link variável não testa** (mesma recusa da API até o F58-S12): o teste fica bloqueado
  com explicação em vez de falhar no servidor.
- **`fetch` próprio em `queries.ts`**: o `api-client` compartilhado não aceita cabeçalho extra
  (`Idempotency-Key`) nem lê o `code` dos erros do criador.
- Tokens: a etapa não usa `--brand` (fica para o CTA do orquestrador); variáveis em `info`,
  pendência em `warn`, bloqueio em `danger`.

### Validação

- `pnpm --filter @hm/web typecheck` (tsc --noEmit): verde.
- `pnpm --filter @hm/web test`: 47 arquivos, 536 testes verdes (45 novos).
- `eslint apps/web/features/campaigns/editor/message`: 0 erros, 0 avisos.
- `pnpm --filter @hm/web build`: verde (exit 0). A etapa ainda não é importada por rota — o build prova que nada quebrou; a cobertura do módulo vem do typecheck e dos testes.
- Validação visual pendente (Rogério): a etapa ainda não está montada no wizard — entra no F58-S13.
