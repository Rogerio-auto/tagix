---
id: F61-S01
title: Service worker — app shell, versionamento e a saída de emergência
phase: F61
status: in-progress
priority: critical
estimated_size: M
depends_on: []
blocks: [F61-S03, F61-S05, F61-S06]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-09-09T20:59:58Z

---
# F61-S01 — Service worker

## Objetivo

Fazer o app abrir rápido em visita repetida no 4G, sem nunca mostrar dado velho como se
fosse novo — e sem poder travar o produto de forma irreversível.

## Contexto

`APP_MOBILE_PLAN` §5. O manifest já existe (`app/manifest.ts`), os ícones existem, e o
`appleWebApp` já está no layout. **O que não existe é o service worker** — a F36-S02 deixou o
offline-shell como opcional e ele nunca foi registrado. Sem SW não há instalação de verdade,
não há push (o handler de push É o SW), e cada abertura paga a rede inteira.

### O risco que define o desenho

Um service worker é o único código do produto que **sobrevive ao deploy**. Se um SW quebrado
for para produção, ele continua servindo a versão quebrada do cache — inclusive para quem
nunca mais vai receber a correção, porque a correção chega por uma rede que o SW intercepta.
Não existe "reverter o deploy" para isso.

Por isso este slot é desenhado ao contrário do usual: **primeiro a saída de emergência, depois
o cache**. Um SW que não acelera nada é um inconveniente; um SW que não sai é um incidente sem
fim.

### Por que escrito à mão, e não Workbox / next-pwa

O comportamento que precisamos cabe em ~150 linhas legíveis: três estratégias, um versionamento
e um kill switch. Workbox traz um runtime que não vamos ler e uma configuração que esconde
exatamente a decisão que mais importa aqui (o que NUNCA pode ser cacheado). `next-pwa` está
sem manutenção ativa e acopla o build a um wrapper. Aqui, cada `fetch` interceptado é uma
decisão explícita e auditável.

## Escopo

### files_allowed

- `apps/web/public/sw.js`
- `apps/web/app/layout.tsx`
- `apps/web/app/manifest.ts`
- `apps/web/shared/pwa/**`
- `apps/web/next.config.mjs`

### files_forbidden

- `apps/web/features/**`
- `apps/api/**`

## Escopo (faz)

### 1. Saída de emergência (antes de tudo)

- O SW consulta `/sw-kill` no `activate` e a cada 6h. Resposta `disabled` → limpa todos os
  caches, `unregister()` e recarrega os clientes. Um arquivo estático resolve o pior caso.
- `sw.js` servido com `Cache-Control: no-store`: o navegador nunca serve um SW velho do
  próprio cache HTTP.
- Todo `fetch` interceptado dentro de `try/catch`: erro no handler cai para a rede, nunca
  para tela branca.

### 2. Estratégia por rota — e o que NUNCA é cacheado

| Alvo | Estratégia | Porquê |
|---|---|---|
| `/_next/static/**` | cache-first, imutável | o hash está no nome; nunca muda sob o mesmo path |
| Navegação (documentos) | network-first, cache como rede de segurança | o dono prefere esperar 300ms a ver a tela de ontem |
| `/api/**` | **rede pura, nunca cache** | "12 leads esperando" de ontem é pior que erro honesto |
| `/icons/**`, fontes | stale-while-revalidate | mudam pouco e não mentem sobre o negócio |

**A regra que não se negocia:** dado de negócio não entra em cache neste slot. Leitura offline
é F61-S06 e exige carimbo de "visto às 14:32", que não existe ainda.

### 3. Versionamento e atualização

- Nome do cache derivado do build id; `activate` apaga todo cache de versão anterior.
- **Sem `skipWaiting` automático.** Trocar o código sob os pés de quem está no meio de uma
  resposta a cliente é como recarregar a página sozinho. A versão nova assume na próxima
  navegação, ou quando o usuário aceitar.

### 4. Registro

- Componente cliente que registra o SW **depois** do primeiro paint (não competir com o
  carregamento inicial), e só em produção sob HTTPS.
- `start_url` do manifest passa a ser `/hoje`: o app instalado abre na tela do dono.

## Fora de escopo

- Push (F61-S03) — o SW ganha o `push` handler lá.
- Leitura offline de dado de negócio (F61-S06).
- Fluxo de instalação e detecção de standalone (F61-S05).

## Definition of Done

- [ ] `/api/**` nunca é servido do cache; teste cobre a decisão de rota.
- [ ] Kill switch remove o SW e limpa os caches.
- [ ] Cache de versão anterior é apagado no `activate`.
- [ ] Nenhuma troca de versão no meio da sessão.
- [ ] Erro no handler cai para a rede, nunca para tela branca.
- [ ] `sw.js` servido com `no-store`.
- [ ] Registro não bloqueia o primeiro paint.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua deste slot é a reversibilidade, não a velocidade. Velocidade é a F61-S06.
