---
id: F61-S01
title: Service worker — app shell, versionamento e a saída de emergência
phase: F61
status: done
priority: critical
estimated_size: M
depends_on: []
blocks: [F61-S03, F61-S05, F61-S06]
source_docs:
  - docs/features/APP_MOBILE_PLAN.md
agent_id: frontend-engineer
claimed_at: 2026-09-09T20:59:58Z
completed_at: 2026-09-09T21:08:40Z

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
- `eslint.config.mjs`

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

- [x] `/api/**` nunca é servido do cache; teste cobre a decisão de rota.
- [x] Kill switch remove o SW e limpa os caches.
- [x] Cache de versão anterior é apagado no `activate`.
- [x] Nenhuma troca de versão no meio da sessão.
- [x] Erro no handler cai para a rede, nunca para tela branca.
- [x] `sw.js` servido com `no-store`.
- [x] Registro não bloqueia o primeiro paint.

## Validação

```bash
pnpm --filter @hm/web typecheck
pnpm --filter @hm/web test
pnpm lint
```

## Notas

- A régua deste slot é a reversibilidade, não a velocidade. Velocidade é a F61-S06.

## Decisões tomadas na execução (2026-09-09)

1. **Kill switch antes do cache.** `/sw-kill.json` com `disabled: true` faz qualquer worker
   instalado limpar os caches, sair do registro e recarregar os clientes. Não existe rollback de
   deploy para service worker: um SW quebrado continua servindo a versão quebrada para quem nunca
   mais vai receber a correção, porque a correção chega por uma rede que ele intercepta.

2. **Falha de rede na checagem do kill switch NÃO desliga nada.** O padrão seguro é continuar
   funcionando — desligar por causa de um 4G ruim tiraria o cache justamente de quem mais precisa
   dele.

3. **A regra de cache mora fora do worker.** `sw-strategy.js` é módulo ESM puro que o SW importa
   em runtime e o Vitest importa no teste. Um SW roda num contexto que o Vitest não tem, e a
   decisão que mais importa — "isto pode vir do cache?" — é justamente a que precisa de teste.
   O teste carrega o arquivo REAL, não uma reimplementação.

4. **Service worker de tipo `module`** (Safari 15.4+, Chrome 91+) para permitir esse `import`.
   Onde não houver suporte, o registro rejeita e o app segue sem SW — que é o comportamento de
   hoje. É melhoria progressiva, não dependência.

5. **`/api`, `/auth` e `/socket.io` são rede pura, sem exceção.** "12 leads esperando" servido do
   cache de ontem é pior que um erro honesto: o erro faz o dono tentar de novo, o número velho faz
   ele ir dormir tranquilo. Há teste inclusive para o caso adversarial (`/api/contacts/avatar.png`
   continua sendo rede) e para o quase-falso-positivo (`/apiary/...` não é `/api/`).

6. **Nada é pré-cacheado no `install`.** Pré-cache exige conhecer os nomes com hash do build, o
   que acoplaria o SW ao pipeline do Next. O ganho real vem do cache-first em `/_next/static`, que
   se preenche sozinho na primeira visita.

7. **Sem `skipWaiting` automático.** Trocar o código sob os pés de quem está no meio de uma
   resposta a cliente é como recarregar a página sozinho. A versão nova assume na próxima
   navegação, ou quando a página mandar `skip-waiting`.

8. **`network-only` não chama `respondWith`.** Deixar o navegador seguir o caminho normal é mais
   barato e menos arriscado que reimplementar um passthrough dentro do worker.

9. **`no-store` em `sw.js`, `sw-strategy.js` e `sw-kill.json`.** Um worker cacheado pelo HTTP é o
   mesmo problema um nível acima; um interruptor cacheado não desliga nada. Verificado no build de
   produção: `Cache-Control: no-store, must-revalidate`.

10. **`start_url` passa a ser `/hoje`, e `id` continua `/`.** Quem instala no celular quer três
    respostas rápidas, não navegar. Mudar o `id` faria o navegador tratar como um app diferente e
    perder a instalação existente.

11. **Registro depois do primeiro paint, só em produção sob HTTPS.** Registrar durante o
    carregamento disputa banda com o conteúdo que o SW deveria acelerar — deixaria a primeira
    visita mais lenta para tornar a segunda mais rápida. Em dev, o SW serviria build antigo e
    transformaria "não atualizou" no bug mais confuso do projeto.

12. **Globais de service worker declarados no ESLint.** Sem isso o `no-undef` acusava 24 erros em
    código correto, e um lint que erra sobre código correto é um lint que as pessoas aprendem a
    ignorar.

## Resultado

- 12 testes novos em `shared/pwa/strategy.test.ts`; suíte web 202/202.
- Typecheck limpo. Lint: 0 erros (as 109 warnings são dívida pré-existente de DS/i18n).
- Build de produção verificado servindo `sw.js` com `no-store` e o manifest com `start_url: /hoje`.

## Como desligar em produção, se precisar

```bash
# Em /opt/leadium, editar apps/web/public/sw-kill.json para {"disabled": true} e deployar.
# Todo worker instalado se apaga na próxima checagem (imediata no activate, 6h no fetch).
```
