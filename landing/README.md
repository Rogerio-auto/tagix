# Leadium Landing (porta 3333)

Landing page oficial da Leadium — plataforma multi-tenant de atendimento, vendas conversacionais e automação. Este app React 19 + Vite roda na porta **3333** e direciona todos os CTAs para o app de cadastro (porta 3002), que por sua vez comunica com o backend (porta 5000) e redireciona o usuário para o app principal (porta 3000).

## Principais recursos

- Hero, prova social, grid de recursos e seções por nicho
- Página de preços dedicada com 4 planos
- Contato com formulário validado (React Hook Form + Zod)
- Páginas utilitárias: About, Demo, ThankYou e 404 personalizado
- Componentes reutilizáveis (botões, cards, containers, badges)
- Helpers de redirecionamento (`src/utils/redirect.ts`) alinhados ao fluxo multiporta

## Tecnologias

- React 19 + TypeScript
- Vite 7 (porta fixa 3333 em `vite.config.ts`)
- TailwindCSS 4 + PostCSS
- React Router DOM 7
- Framer Motion (reservado para animações)
- React Hook Form + Zod + Axios

## Variáveis de ambiente

Use o arquivo [.env.example](.env.example) como base:

```bash
VITE_CADASTRO_URL=http://localhost:3002
VITE_APP_URL=http://localhost:3000
VITE_API_URL=http://localhost:5000
VITE_GA_ID=G-XXXXXXXXXX
VITE_META_PIXEL_ID=XXXXXXXXXX
VITE_HOTJAR_ID=XXXXXXX
```

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | inicia o Vite em http://localhost:3333 |
| `npm run build` | gera a build de produção |
| `npm run preview` | serve a build gerada |
| `npm run lint` | executa ESLint |

## Estrutura resumida

```
landing/
├── public/
├── src/
│   ├── components/
│   │   ├── layout (header, footer, layout shell)
│   │   ├── sections (Hero, PricingPreview, etc.)
│   │   └── ui (Button, Card, Container, Badge)
│   ├── pages (Home, Pricing, About, Contact, Demo, ThankYou, NotFound)
│   ├── utils (constants, redirect helpers)
│   └── hooks (usePageMeta)
└── .env.example
```

## Fluxo multiporta

```
Landing 3333 → CTAs → Cadastro 3002 → Backend 5000 → App 3000
```

Certifique-se de que os subdomínios apontem para cada aplicação (`landing.`, `cadastro.`, `api.`, `app.`) ao configurar o deploy.
