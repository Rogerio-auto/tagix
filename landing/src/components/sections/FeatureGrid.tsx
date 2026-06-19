import { FEATURES } from "../../utils/constants";
import { Container } from "../ui/Container";
import { Card } from "../ui/Card";
import { SectionHeading } from "../ui/SectionHeading";
import { ScrollReveal } from "../ui/ScrollReveal";

export const FeatureGrid = () => (
  <section id="features" className="py-32 bg-background relative overflow-hidden">
    <div className="absolute top-0 right-0 w-1/3 h-1/3 bg-primary/5 blur-[120px] -z-10" />
    <Container>
      <ScrollReveal>
        <div className="mb-20 text-center">
          <SectionHeading
            eyebrow="Plataforma completa"
            title="Tudo para atender, vender e automatizar em um só lugar"
            description="Atendimento omnichannel, agentes de IA, Flow Builder, CRM, campanhas, calendário, dashboards, API pública e segurança — integrados, não improvisados."
            align="center"
          />
        </div>
      </ScrollReveal>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, idx) => (
          <ScrollReveal key={feature.id} delay={idx * 0.1}>
            <Card className="flex flex-col h-full bg-foreground/[0.03] backdrop-blur-sm border-foreground/10 hover:border-primary/50 hover:bg-foreground/[0.05] transition-all duration-300 p-8 rounded-3xl">
              <div className="flex-1">
                {feature.badge && (
                  <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-primary bg-primary/10 px-3 py-1 rounded-full">{feature.badge}</span>
                )}
                <h3 className="mt-6 text-2xl font-bold text-foreground">{feature.title}</h3>
                <p className="mt-4 text-muted-foreground leading-relaxed">{feature.description}</p>
                <ul className="mt-8 space-y-4">
                  {feature.bullets.map((item) => (
                    <li key={item} className="flex items-start gap-3">
                      <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-sm text-muted-foreground font-medium">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </ScrollReveal>
        ))}
      </div>
    </Container>
  </section>
);
