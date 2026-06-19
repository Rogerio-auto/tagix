import { PLANS } from "../../utils/constants";
import { getSignupUrl } from "../../utils/redirect";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";
import { Button } from "../ui/Button";
import { ScrollReveal } from "../ui/ScrollReveal";

export const PricingPreview = () => (
  <section className="py-24" id="precos">
    <Container>
      <ScrollReveal>
        <SectionHeading
          eyebrow="Planos Flexíveis"
          title="Escolha o plano ideal para sua escala"
          description="Sem taxas de ativação, sem fidelidade. Cancele quando quiser."
          align="center"
        />
      </ScrollReveal>
      <div className="grid lg:grid-cols-4 rounded-3xl overflow-hidden bg-card/30 backdrop-blur-sm">
        {PLANS.map((plan, idx) => (
          <ScrollReveal key={plan.id} delay={idx * 0.1}>
            <div className={`flex h-full flex-col p-8 transition-all duration-500 ${plan.badge ? 'bg-primary/5' : ''}`}>
              {plan.badge ? (
                <div className="mb-4">
                  <span className="bg-primary text-[var(--text-on-brand)] text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    {plan.badge}
                  </span>
                </div>
              ) : (
                <div className="mb-4 h-6" />
              )}
              <h3 className="text-2xl font-bold text-foreground">{plan.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground min-h-[40px] leading-relaxed">{plan.description}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-foreground">R$ {plan.price}</span>
                <span className="text-muted-foreground">/mês</span>
              </div>
              <p className="mt-2 text-xs font-semibold text-primary/90 uppercase tracking-widest">{plan.quota}</p>
              
              <ul className="mt-8 flex-1 space-y-4 text-sm">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-foreground/90">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                    <span className="leading-tight">{feature}</span>
                  </li>
                ))}
                {plan.notIncluded && plan.notIncluded.map((feature) => (
                   <li key={feature} className="flex items-start gap-3 text-muted-foreground/60">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/20 flex-shrink-0" />
                    <span className="line-through leading-tight">{feature}</span>
                  </li>
                ))}
              </ul>

              <Button 
                variant={plan.badge ? "default" : "outline"}
                className={`mt-10 w-full rounded-full py-6 font-bold transition-all duration-300 ${plan.badge ? 'glow-primary shadow-lg shadow-primary/20' : ''}`} 
                asChild
              >
                <a href={getSignupUrl(plan.id)}>{plan.cta}</a>
              </Button>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </Container>
  </section>
);
