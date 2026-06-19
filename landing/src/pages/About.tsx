import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { usePageMeta } from "../hooks/usePageMeta";

const pillars = [
  { title: "Canais oficiais", detail: "WhatsApp e Instagram pela API oficial da Meta, como Tech Provider." },
  { title: "Inteligência aplicada", detail: "Agentes em LangGraph roteados pelo OpenRouter, com base de conhecimento." },
  { title: "Automação sem código", detail: "Flow Builder visual com cerca de 22 tipos de nó e gatilhos." },
  { title: "Segurança por design", detail: "Multi-tenant com RLS, credenciais criptografadas e conformidade LGPD." },
];

const About = () => {
  usePageMeta({
    title: "Sobre a Leadium",
    description: "A visão e a arquitetura por trás da plataforma de atendimento, vendas conversacionais e automação da Leadium.",
  });

  return (
    <section className="py-16">
      <Container>
        <SectionHeading
          eyebrow="Sobre"
          title="A plataforma para atender, vender e automatizar com IA"
          description="A Leadium nasce para unificar canais oficiais, inteligência artificial e automação em uma base sólida, multi-tenant e segura — pronta para crescer com a sua operação."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h3 className="text-xl font-semibold text-foreground">Missão</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Dar a qualquer time as ferramentas de atendimento conversacional de ponta — combinando canais oficiais da Meta, agentes de IA e automação visual — sem complexidade e sem comprometer a segurança dos dados.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Atendimento humano e IA na mesma caixa de entrada</li>
              <li>• Conformidade LGPD e isolamento por workspace (RLS)</li>
              <li>• Integrações oficiais, sem atalhos arriscados</li>
            </ul>
          </Card>
          <Card>
            <h3 className="text-xl font-semibold text-foreground">Arquitetura</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Plataforma multi-tenant sobre Postgres com Row-Level Security, autenticação Supabase, agentes de IA em LangGraph + OpenRouter e tempo real via Socket.io. API pública v1 documentada em OpenAPI.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Tempo real para inbox e notificações</li>
              <li>• Flow Builder com execução monitorada em fila</li>
              <li>• API pública v1 e webhooks para integração</li>
            </ul>
          </Card>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {pillars.map((item) => (
            <div key={item.title} className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-sm p-5">
              <h4 className="text-lg font-semibold text-foreground">{item.title}</h4>
              <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

export default About;
