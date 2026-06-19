import { PLANS } from "../utils/constants";
import { getSignupUrl } from "../utils/redirect";
import { Container } from "../components/ui/Container";
import { SectionHeading } from "../components/ui/SectionHeading";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { usePageMeta } from "../hooks/usePageMeta";

const Pricing = () => {
  usePageMeta({
    title: "Planos e preços",
    description: "Escolha o melhor plano para o seu negócio com 30 dias de teste gratuito.",
  });

  return (
    <section className="py-16">
      <Container>
        <SectionHeading
          eyebrow="Planos"
          title="Comece grátis e cresça com a sua operação"
          description="Do plano Free ao Business, você só sobe de nível quando precisar de mais canais, IA e governança. Sem fidelidade."
          align="center"
        />
        <div className="grid gap-6 md:grid-cols-2">
          {PLANS.map((plan) => (
            <Card key={plan.id} glow={plan.id === "pro"} className="border-none shadow-none bg-card/50">
              {plan.badge && (
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">{plan.badge}</span>
              )}
              <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-3xl font-semibold text-foreground">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>
                <p className="text-3xl font-semibold text-foreground">
                  R$ {plan.price}
                  <span className="text-base font-normal text-muted-foreground/60">/mês</span>
                </p>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{plan.quota}</p>
              <ul className="mt-4 space-y-2 text-sm text-foreground/80">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {plan.notIncluded && plan.notIncluded.length > 0 && (
                <p className="mt-4 text-xs text-muted-foreground/60">Não inclui: {plan.notIncluded.join(", ")}</p>
              )}
              <Button className="mt-6 w-full" size="lg" asChild>
                <a href={getSignupUrl(plan.id)}>{plan.cta}</a>
              </Button>
            </Card>
          ))}
        </div>
        <div className="mt-10 rounded-3xl border border-primary/20 bg-primary/5 p-6 text-sm text-foreground/60 italic text-center">
          <p>
            Todos os planos rodam sobre a API oficial da Meta, com arquitetura multi-tenant, isolamento por workspace (RLS) e conformidade com a LGPD.
          </p>
        </div>
      </Container>
    </section>
  );
};

export default Pricing;
