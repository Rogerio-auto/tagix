# ONBOARDING — Onboarding & Verticalização (F43)

> **Fase:** F43 (próxima livre — F42 = billing, já done).
> **Origem:** levantamento de produto 2026-06-19 (Rogério). Escopo travado.
> **Macro-objetivo:** quando uma empresa entra na Leadium, o sistema já **vem pronto
> para o nicho dela** (funil, agente, etiquetas, conversões, departamentos, fluxos) e
> a **guia pelos primeiros passos** (boas-vindas, pesquisa, checklist, tour). Acaba o
> "sistema vazio e incompleto" do primeiro acesso.

**Fora desta fase (vai para a F44):** cadastro self-serve ("Começar grátis") +
hardening de loading/validação de sessão (Supabase Auth). Decisão do Rogério: virar
fase própria, reconstruída junto. O first-run desta fase roda para **owner provisionado
+ membros convidados** — não depende de signup.

**Fora de escopo (decisão explícita):** base de conhecimento (KB) inicial por nicho.

---

## 1. Estado atual (o que já existe)

- `NicheOnboardingWizard` (`apps/web/features/onboarding/`) **existe mas está órfão** —
  não é montado em lugar nenhum. Escolhe nicho → cria pipeline + agente.
- Presets cobrem **só 2 nichos** (`real_estate`, `clinic`) e só **pipeline + agente**:
  `packages/db/src/seed/pipeline_templates.ts`, `seed/agent_templates_niche.ts`.
  A rota `POST /api/onboarding/niche` (montada em `app.ts:169`) faz pipeline+agente.
- Ajuda contextual = `HelpHint` (`?`) passivo, **3 chaves** (dashboard/pipeline/flow).
- **Não há** flag de first-run, **não há** lib de tour, **não há** checklist.
- A landing (`landing/src/utils/constants.ts → NICHES`) anuncia **7 nichos**:
  Imobiliário, Saúde, Educação, Solar (Energia Solar), Varejo, Jurídico, Agências.
  Hoje 5 deles são vaporware. **Esta fase fecha esse gap.**

Schemas já existentes reaproveitados: `tags`, `conversions`/`conversionTypes`,
`org.departments`, `flows`, `workspaces` (tem `industry` + `settings` jsonb), `members`
(tem prefs jsonb). **Não existe** tabela de respostas rápidas (`quick_replies`).

---

## 2. Frente A — Niche Blueprints (o "vir pronto pro nicho")

### 2.1 Modelo declarativo `NicheBlueprint`
Fonte única por nicho. Tipo declarativo descrevendo o pacote completo do nicho:

```ts
interface NicheBlueprint {
  key: string;            // 'real_estate' | 'health' | 'education' | 'solar' | 'retail' | 'law' | 'agency'
  name: string;           // rótulo pt-BR ("Imobiliária")
  industry: string;       // grava em workspaces.industry
  pipeline: { name; description; customFields[]; stages[] };
  agents: AgentTemplateRef[];   // 1+ agente(s) do nicho
  tags: { name; color }[];
  conversionTypes: { name; ... }[];
  departments: { name; description? }[];
  quickReplies: { title; body; departmentName? }[];
  flows: FlowTemplate[];        // boas-vindas/qualificação/agendamento/recuperação
}
```

### 2.2 Instanciador único `instantiateNicheBlueprint(tx, workspaceId, blueprint)`
- **Idempotente** (re-onboarding / re-seed não duplica): cada recurso ancora numa UNIQUE
  (pipeline: workspace+name; tags: workspace+name; etc.) com `onConflictDoNothing`/upsert.
- **RLS-safe**: roda dentro da transação scoped do workspace (`req.scoped`), nunca como OWNER
  no caminho de usuário.
- Aplica todos os recursos do blueprint numa transação. Grava `workspaces.industry`.

### 2.3 Conteúdo dos 7 nichos
Todos com pipeline + agente + tags + tipos de conversão + departamentos + respostas rápidas.
**Flows escalonados:** Imobiliário, Saúde e Jurídico saem com flows prontos; Educação,
Solar, Varejo e Agências entram com `flows: []` e são preenchidos depois (slot dedicado).

---

## 3. Frente B — First-run (welcome + pesquisa + checklist)

### 3.1 Estado de onboarding
- `workspaces.onboarding` (jsonb novo): `{ niche_key, applied_at, survey, setup_completed }`.
- `members.tour_state` (jsonb novo): `{ <tourId>: { completed_at, dismissed } }`.

### 3.2 Welcome + pesquisa + nicho
No **primeiro login** (estado `onboarding.niche_key == null`): modal de boas-vindas →
**mini-pesquisa** (tipo de negócio, tamanho do time, objetivo) → sugere/confirma o nicho →
aplica o blueprint (2.2). Reaproveita e expande o `NicheOnboardingWizard`.

### 3.3 Checklist "Primeiros passos"
Widget no dashboard. **Estado derivado do dado real** (não checkbox manual): conectar
WhatsApp, confirmar/ativar agente, importar contatos, publicar 1º flow, enviar 1ª campanha.
Cada item linka para a tela. Some quando completo ou dispensado.

---

## 4. Frente C — Tour guiado

### 4.1 Engine in-house (DS v2)
Spotlight/coachmark **próprio**, sem dependência pesada (casa com dark-first). Passos
**declarativos por tela**, ancorados via `data-tour-id`. Estado persistido por membro (3.1).
`Esc`/skip/próximo, foco gerenciado, respeita `motion-safe`.

### 4.2 Conteúdo dos tours
Dashboard, Conversas/Inbox, Pipeline, Agentes, Flows — "aqui serve tal coisa, é assim que se
usa". Reaproveita textos do `HelpHint` e expande.

---

## 5. Permissão & segurança

- Aplicar blueprint = ação administrativa → endpoint gated por **`workspace.edit`**
  (ADMIN/OWNER), coerente com `apps/api/src/routes/audit.ts`. Estado de onboarding por
  workspace idem; `tour_state` é por membro (o próprio).
- Idempotência multi-recurso é o **risco-chave** do instanciador (2.2): cada insert ancora
  numa UNIQUE; testes cobrem dupla-aplicação.

---

## 6. Slots (ondas)

- **Onda 1 (fundação):** F43-S01 (schema), F43-S02 (engine do blueprint).
- **Onda 2 (conteúdo + API + first-run):** F43-S03 (7 nichos), F43-S04 (API), F43-S05
  (welcome/pesquisa/nicho), F43-S06 (checklist).
- **Onda 3 (tour + flows restantes):** F43-S07 (engine de tour), F43-S08 (conteúdo+âncoras),
  F43-S09 (flows dos 4 nichos restantes).
