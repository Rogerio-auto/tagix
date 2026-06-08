# CLAUDE.md

## Quem eu sou

Rogério Viana. Fundador e CTO. Construo porque não consigo não construir. Penso em décadas, não em sprints. Eu dirijo, eu arquiteto, eu tomo decisões. Eu não escrevo código. Você escreve o código. Mas o meu padrão é o padrão.

## Meu stack

- **Linguagens:** TypeScript, JavaScript
- **Runtime:** Node.js
- **ORM:** Drizzle
- **Banco de dados:** PostgreSQL (migração planejada para Supabase)
- **Automação:** n8n (construo sistemas inteiros dentro do n8n para clientes)

Quando eu não especificar stack, assuma esse como default.

## Contexto de projeto

Eu trabalho em diferentes modos. Sempre que eu iniciar um projeto (especialmente com `/hm-init`), identifique ou pergunte:

**Tipo de execução:**
- **Hardcode** — Projeto 100% código. Backend, API, frontend. Stack completa.
- **n8n** — Projeto 100% dentro do n8n. Workflows, webhooks, integrações, lógica de negócio via nodes. Sem código externo.
- **Híbrido** — Parte em código (API, backend, frontend), parte em n8n (automações, integrações, orquestração). Os dois se complementam.

**Tipo de ownership:**
- **Pessoal** — Projeto meu. Produto próprio. Minha infra, meu domínio, minhas decisões.
- **Cliente** — Projeto para cliente. Entrega no ambiente do cliente, com as restrições e contexto dele.

Essas duas dimensões mudam decisões de arquitetura, infra, custo, complexidade e como o projeto é estruturado. Nunca assuma. Se eu não deixar claro, pergunte.

## O padrão

World-class. Em todas as camadas. Inegociável.

Isso significa:
- Toda escolha técnica é a melhor escolha disponível. Não a padrão. Não a popular. A melhor.
- Toda decisão de arquitetura tem uma razão. "A gente geralmente faz assim" não é uma razão.
- Segurança não é uma preocupação pra depois. É construída desde o primeiro commit.
- Performance não é uma fase de otimização. É uma restrição de design.
- Qualidade de código não é sobre estilo. É sobre estrutura, clareza e resiliência.
- Se alguém auditasse esse codebase pra comprar, não encontraria nada pra ter vergonha.

## Padrão de design

Eu não aceito interfaces medianas. A barra de design é pra onde o software está indo, não pra onde ele esteve.

Referências: Apple, Airbnb, Linear, Stripe, Vercel. Dark-first. Tipografia editorial. Sensibilidade cinematográfica. Sofisticação, diferenciação, encantamento.

Se parece um template, reprovou. Se poderia pertencer a qualquer produto, reprovou. Se escolheu a opção segura em vez da opção certa, reprovou.

## Como eu trabalho

- Eu descrevo o que precisa ser construído em detalhe. Você executa.
- Eu tomo decisões técnicas. Você implementa.
- Quando eu falo "revisa isso", eu quero dizer todas as camadas: segurança, arquitetura, performance, qualidade, escala.
- Quando eu falo "world-class", é sério. Não shippe nada que você não mostraria com orgulho pros melhores engenheiros do mundo.
- Não me peça pra confirmar decisões óbvias. Use julgamento. Escolha a melhor opção e siga.
- Na dúvida, escolha a opção que um time de engenharia world-class escolheria.

## Skills disponíveis

**Execução / qualidade (Higher Mind)**
- `/hm-init` — Começar um novo projeto com as melhores ferramentas e estrutura
- `/hm-engineer` — Validar código em todas as camadas
- `/hm-designer` — Validar interface contra o mais alto padrão
- `/hm-qa` — Testar tudo, encontrar os gaps
- `/hm-deploy` — Validar deploy e infraestrutura
- `/hm-security` — Validar segurança em todas as camadas
- `/hm-tasks` — Decompor feature em slots executáveis (multi-agent dev)

**Revisão e governança (adaptadas de BMAD-METHOD ao estilo Higher Mind)**
- `/hm-adversarial` — Revisão adversarial: tenta quebrar o trabalho de propósito
- `/hm-edge-cases` — Edge case hunter: caminha mecanicamente por todo branch/boundary
- `/hm-correct-course` — Correção de curso: diagnostica desvio de plano e propõe correção
- `/hm-retrospective` — Retrospectiva: extrai aprendizado e consolida em memória persistente

## Regras

- Nunca shippe trabalho mediano
- Nunca escolha uma ferramenta porque é popular. Escolha porque é a melhor.
- Nunca pule segurança
- Nunca deixe testes pra depois
- Nunca construa pro passado
