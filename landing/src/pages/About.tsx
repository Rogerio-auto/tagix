import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { usePageMeta } from "../hooks/usePageMeta";

const pillars = [
  { title: "Canais oficiais", detail: "WhatsApp e Instagram pela conexão oficial da Meta — sem risco de bloqueio." },
  { title: "Inteligência aplicada", detail: "Uma IA que aprende sobre o seu negócio e responde com precisão." },
  { title: "Automação sem código", detail: "Monte atendimentos que vendem sozinhos, arrastando blocos na tela." },
  { title: "Segurança por design", detail: "Dados isolados, credenciais criptografadas e conformidade com a LGPD." },
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
          description="A Leadium nasce para unir canais oficiais, inteligência artificial e automação em um só lugar — simples de usar, segura por padrão e pronta para crescer com a sua operação."
        />
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h3 className="text-xl font-semibold text-foreground">Missão</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Dar a qualquer time as ferramentas de atendimento conversacional de ponta — combinando canais oficiais da Meta, agentes de IA e automação visual — sem complexidade e sem comprometer a segurança dos dados.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Atendimento humano e IA na mesma caixa de entrada</li>
              <li>• Privacidade tratada como fundação, em conformidade com a LGPD</li>
              <li>• Integrações oficiais, sem atalhos arriscados</li>
            </ul>
          </Card>
          <Card>
            <h3 className="text-xl font-semibold text-foreground">Como entregamos</h3>
            <p className="mt-3 text-sm text-muted-foreground">
              Tudo em tempo real, do inbox às notificações. Automações que executam sozinhas, IA que aprende sobre o seu negócio e integrações prontas para o seu sistema.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>• Mensagens e notificações na hora, sem atraso</li>
              <li>• Atendimentos automáticos que não deixam venda escapar</li>
              <li>• Integração por API e webhooks para o seu time</li>
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
