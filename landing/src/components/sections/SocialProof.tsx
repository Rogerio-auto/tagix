import { Container } from "../ui/Container";
import { Card } from "../ui/Card";

const PILLARS = [
  {
    title: "WhatsApp",
    detail: "Cloud API oficial da Meta + Coexistence com o app Business",
  },
  {
    title: "Instagram",
    detail: "Mensagens diretas pela API oficial da Meta",
  },
  {
    title: "OpenRouter",
    detail: "Roteamento entre os modelos de IA líderes do mercado",
  },
  {
    title: "Supabase",
    detail: "Autenticação e dados sobre Postgres com RLS",
  },
  {
    title: "API & Webhooks",
    detail: "API pública v1 documentada em OpenAPI",
  },
  {
    title: "LGPD",
    detail: "Privacidade e segurança como fundação",
  },
];

export const SocialProof = () => (
  <section className="py-12" aria-label="Canais e integrações oficiais">
    <Container>
      <p className="text-center text-xs font-semibold uppercase tracking-[0.6em] text-muted-foreground/60">
        Construída sobre fundações oficiais
      </p>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {PILLARS.map((pillar) => (
          <div
            key={pillar.title}
            className="flex flex-col items-center justify-center rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm p-4 text-center"
          >
            <span className="text-sm font-bold uppercase tracking-widest text-foreground">{pillar.title}</span>
            <span className="mt-2 text-[11px] leading-snug text-muted-foreground">{pillar.detail}</span>
          </div>
        ))}
      </div>
      <Card className="mt-12 text-center p-8 bg-card/30 border-border/40">
        <p className="text-lg text-foreground leading-relaxed">
          A Leadium é uma plataforma multi-tenant de atendimento, vendas conversacionais e automação —
          com canais oficiais da Meta, agentes de IA e Flow Builder visual em um único lugar.
        </p>
        <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">Atendimento · IA · Automação · CRM</p>
      </Card>
    </Container>
  </section>
);
