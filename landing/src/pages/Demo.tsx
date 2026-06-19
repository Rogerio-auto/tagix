import { Link } from "react-router-dom";
import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../hooks/usePageMeta";

const Demo = () => {
  usePageMeta({
    title: "Agendar uma demonstração",
    description: "Veja a Leadium em ação: canais oficiais, agentes de IA, Flow Builder e CRM em uma única plataforma.",
  });

  return (
    <section className="py-16">
      <Container>
        <SectionHeading
          eyebrow="Demonstração"
          title="Veja a Leadium em ação"
          description="Apresentamos a plataforma de ponta a ponta e mostramos como ela se encaixa na forma como o seu time atende e vende."
          align="center"
        />
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-sm p-6 text-sm text-muted-foreground shadow-elev3">
            <h3 className="text-xl font-semibold text-foreground">O que vamos cobrir</h3>
            <ul className="mt-4 space-y-3">
              <li>• Inbox unificado de WhatsApp e Instagram (API oficial)</li>
              <li>• WhatsApp Coexistence com o app WhatsApp Business</li>
              <li>• Agentes de IA com base de conhecimento (RAG)</li>
              <li>• Flow Builder visual, CRM e campanhas</li>
              <li>• Dashboards role-aware, segurança e LGPD</li>
            </ul>
            <p className="mt-4">Adaptamos a conversa ao seu segmento e ao seu volume de atendimento.</p>
          </div>
          <div className="rounded-3xl border border-border/50 bg-card/40 backdrop-blur-sm p-6 shadow-elev3">
            <h3 className="text-xl font-semibold text-foreground">Como agendar</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Conte um pouco sobre a sua operação e o nosso time entra em contato para marcar a melhor data e horário.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <Button className="w-full" asChild>
                <Link to="/contato">Solicitar demonstração</Link>
              </Button>
              <Button variant="outline" className="w-full" asChild>
                <Link to="/precos">Ver planos</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

export default Demo;
