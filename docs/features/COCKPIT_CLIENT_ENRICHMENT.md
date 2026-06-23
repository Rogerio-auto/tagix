# Feature — Enriquecimento do Cliente no Cockpit + Catálogo de Produtos + Reorg da Sidebar (F47)

> **Domínio:** LiveChat (Cockpit) × CRM (Contatos/Pipeline/Conversões) + Settings + Navegação.
> **Status:** spec aprovada pelo founder (2026-06-23). Decomposta em 11 slots (F47-S01…S11).
> **Padrão:** world-class, dark-first DS v2, RLS multi-tenant, zero `any`.

---

## 1. Problema

O Cockpit do LiveChat (`ContactInfoPanel`) hoje mostra status/IA/roteamento/contexto/notas, mas
**nenhum dado cadastral do cliente, nenhum vínculo com o card da pipeline e nenhum acesso a
conversão/valor**. O atendente não consegue, no fluxo do atendimento:

1. Ver/enriquecer o cadastro do cliente (nome, endereço, documento, dados gerais).
2. Vincular um **produto** do catálogo ou lançar um **valor** direto.
3. Fazer esse valor alimentar a **conversão** do sistema.
4. Materializar/atualizar o **card** (deal) na pipeline a partir da conversa.

Além disso não existe **catálogo de produtos** no workspace, e a **sidebar** não tem perfil do
usuário nem logout — entrada de identidade/sessão está dispersa.

## 2. Decisões travadas (founder)

- **Produto = catálogo completo.** Nova tabela `products` (nome, SKU, preço, ativo) + **line-items**
  no card (`deal_items`: produto × qtd × preço). A soma dos itens alimenta `deals.value_cents`.
  Gestão do catálogo vive em **Configurações** (`/settings/products`).
- **Cadastro = colunas estruturadas.** `contacts` ganha `address jsonb` tipado
  `{cep, street, number, complement, district, city, state}` + `document` (CPF/CNPJ). Endereço
  com autopreenchimento **ViaCEP**. `custom_fields` (já existe) segue para campos por nicho (F43).
- **Card nasce de dois jeitos:** botão explícito no Cockpit **e** auto-criação na primeira vez que
  valor/produto é preenchido sem deal vinculado à conversa.
- **Card alimentado pelo cadastro via READ-THROUGH:** o card exibe o cadastro vivo do contato
  (`deal.contact_id` → contato), sempre fresco, sem cópia divergente. **Snapshot** do cadastro é
  gravado em `deal.custom_fields.contact_snapshot` **no fechamento** (won/lost) para fidelidade
  histórica (ex.: endereço de entrega como era na venda).
- **`<ContactPanel>` reutilizável:** um único componente (editável no Cockpit, read-only nas demais
  telas) plugado em **Cockpit** (LiveChat), **DealDetailDrawer + MobileDealSheet** (Pipeline) e
  **página de Contatos**. "Ver mais informações do cliente em outras seções" = este componente.

## 3. Modelo de dados (migration única — S01)

```
products            (NOVO, workspace-scoped, RLS, soft-delete)
  id, workspace_id, name, sku?, description?, price_cents bigint, currency='BRL',
  active boolean=true, created_at, updated_at, deleted_at
  · idx(workspace_id) where deleted_at is null
  · unique(workspace_id, sku) where sku is not null and deleted_at is null

deal_items          (NOVO, workspace-scoped, RLS)
  id, workspace_id, deal_id → deals(cascade), product_id → products(set null),
  name_snapshot text, qty integer (>0), unit_price_cents bigint, currency, position, created_at
  · product_id NULLABLE = item ad-hoc ("digitar valor direto" sem produto de catálogo)
  · Σ(qty × unit_price_cents) → deals.value_cents (recomputado no servidor — S03)
  · idx(deal_id)

contacts            (ALTER)
  + address jsonb default '{}'  →  { cep, street, number, complement, district, city, state }
  + document text               →  CPF/CNPJ (cadastro geral)
```

RLS multi-tenant em `products` e `deal_items` (policy por `workspace_id`, como nas demais tabelas).
`deals.value_cents` permanece a fonte de valor para a conversão (`valueFrom: 'deal'`).

## 4. API (S02–S04)

| Método | Rota | Perm | Slot |
|---|---|---|---|
| GET/POST/PATCH/DELETE | `/api/products` | `product.view` / `product.edit` | S02 |
| POST/PATCH/DELETE | `/api/deals/:id/items` | `deal.edit` | S03 |
| POST | `/api/conversations/:id/deal` (cria/auto-cria deal ligado) | `deal.edit` | S04 |
| PATCH | `/api/contacts/:id` (estende: `address`, `document`) | `contact.edit` | S04 |
| GET | `/api/deals/:id` + `/api/conversations/:id` (expõem cadastro read-through) | view | S04 |

- **Recompute (S03):** qualquer mutação de `deal_items` recomputa `deals.value_cents = Σ(qty×unit_price)`
  na mesma transação e grava `deal_history(event_type='field_updated')`.
- **Auto-create (S04):** ao lançar 1º item/valor numa conversa sem deal, cria o deal (estágio default
  do pipeline default, título = nome do contato) ligado por `deals.conversation_id`.
- **Snapshot (S04):** ao fechar (won/lost), grava `deal.custom_fields.contact_snapshot` com o cadastro
  vigente do contato.

## 5. Frontend

- **`<ContactPanel>` (S06):** dados + endereço (ViaCEP) + documento + `custom_fields` + resumo
  financeiro. Modo `editable` (Cockpit, gate `contact.edit`) e `readOnly` (demais telas).
- **Cockpit (S06/S07/S08):** seções novas **Cliente**, **Card/Negócio** (criar card, itens/produto,
  valor, auto-enrich) e **Conversão** (reusa `MarkConversionModal` herdando o valor do card) + resumo
  financeiro do contato.
- **Catálogo de Produtos (S05):** seção no registry de settings + rota `/settings/products` (CRUD).
- **Cross-surface (S09):** `<ContactPanel>` read-through no `DealDetailDrawer`, `MobileDealSheet`
  e na página de Contatos.
- **Sidebar (S10):** perfil do usuário (nome + role + avatar) + logout (`POST /auth/logout`),
  organização da nav, polish profissional — paridade mobile (BottomNav/TopBar).

## 6. Permissões (PERMISSIONS.md §2.2)

- `product.view` = ALL (todos veem o catálogo p/ vincular no cockpit).
- `product.edit` = ADMINS (OWNER/ADMIN — gestão do catálogo em settings).
- Itens do card / valor reusam `deal.edit` (STAFF). Conversão reusa `deal.convert` (STAFF).
- Cadastro reusa `contact.edit` (STAFF). Esconder no frontend é UX; autoridade = backend + RLS.

## 7. UX (UX_PRINCIPLES.md)

- §2.3 drawer/painel, não modal full-screen (Cockpit é painel; detalhe = drawer; sheet no mobile §8).
- §2.6 empty states com CTA (catálogo vazio, sem card, sem itens).
- §2.7 feedback imediato (loading nos saves; skeleton nas seções).
- §2.9 confirmação proporcional em delete (produto = soft-delete; item = simples).
- §2.11 erro em 3 partes. §3.9 timeline em histórico. §8 mobile cidadão de 1ª classe.

## 8. Slots & ondas

| Slot | Agente | Objetivo |
|---|---|---|
| F47-S01 | db | Schema+migration: `products`, `deal_items`, `contacts.address/document`, RLS, repos |
| F47-S02 | backend | API `/api/products` CRUD + perms `product.*` |
| F47-S03 | backend | API `/api/deals/:id/items` + recompute `value_cents` + history |
| F47-S04 | backend | Card-da-conversa (criar/auto), PATCH cadastro, read-through, snapshot |
| F47-S05 | frontend | Catálogo de Produtos em Settings (`/settings/products`) |
| F47-S06 | frontend | `<ContactPanel>` reutilizável + Cockpit seção Cliente (ViaCEP) |
| F47-S07 | frontend | Cockpit: Card + Itens/Produto + valor + auto-enrich |
| F47-S08 | frontend | Cockpit: Conversão (herda valor) + resumo financeiro |
| F47-S09 | frontend | Cross-surface: `<ContactPanel>` na Pipeline + Contatos |
| F47-S10 | frontend | Reorg da Sidebar: perfil + logout + nav + polish |
| F47-S11 | qa/security | QA + Segurança + e2e (RLS, authz, drift de valor, dedup) |

**Ondas:** A=`S01,S10` → B=`S02,S03,S04` → C=`S05,S06` → D=`S07,S09` → E=`S08` → F=`S11`.
(Cockpit `ContactInfoPanel.tsx` é espinha compartilhada por S06→S07→S08 ⇒ sequenciais; S09 é paralelo.)

## 9. Não-objetivos

- ❌ Estoque/inventário de produto (quantidade em estoque, reserva). Só catálogo + preço.
- ❌ Multi-moeda por item (herda a moeda do produto/deal; default BRL).
- ❌ Cobrança/checkout do valor (isso é F42 Pagamentos). Aqui o valor só alimenta conversão/card.
- ❌ Custom roles para produto. Reusa matriz existente.
