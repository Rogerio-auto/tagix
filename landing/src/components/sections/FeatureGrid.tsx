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
        <div className="mb-14 text-center sm:mb-20">
          <SectionHeading
            eyebrow="O que você ganha"
            title="Mais venda fechada, menos cliente perdido"
            description="Não é uma lista de recursos — é o que cada parte da Leadium tira do seu ombro. Atender, qualificar, agendar e acompanhar deixa de depender de alguém lembrar."
            align="center"
          />
        </div>
      </ScrollReveal>
      <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, idx) => {
          const highlighted = feature.badge === "Exclusivo";
          return (
            <ScrollReveal key={feature.id} delay={idx * 0.08}>
              <Card
                className={
                  "flex h-full flex-col rounded-3xl p-7 backdrop-blur-sm transition-all duration-300 sm:p-8 " +
                  (highlighted
                    ? "border-primary/40 bg-primary/[0.05] hover:border-primary/70"
                    : "border-foreground/10 bg-foreground/[0.03] hover:border-primary/50 hover:bg-foreground/[0.05]")
                }
              >
                <div className="flex-1">
                  {feature.badge && (
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.35em] text-primary">
                      {feature.badge}
                    </span>
                  )}
                  <h3 className="mt-5 font-head text-xl font-bold uppercase tracking-wide text-foreground sm:text-2xl">
                    {feature.title}
                  </h3>
                  <p className="mt-3.5 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                    {feature.description}
                  </p>
                  <ul className="mt-7 space-y-3.5">
                    {feature.bullets.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span className="text-sm font-medium text-muted-foreground">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </ScrollReveal>
          );
        })}
      </div>
    </Container>
  </section>
);
