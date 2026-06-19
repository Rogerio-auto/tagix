import { Container } from "../ui/Container";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ScrollReveal } from "../ui/ScrollReveal";

export const FinalCTA = () => (
  <section className="pb-20 pt-10">
    <Container>
      <ScrollReveal>
        <div className="relative overflow-hidden rounded-[40px] border border-primary/20 bg-background px-10 py-16 text-foreground shadow-2xl">
          <div className="relative z-10">
            <Badge variant="secondary" className="mb-6">Pronto para começar?</Badge>
            <h3 className="text-4xl md:text-5xl font-bold mb-6">Atenda, venda e automatize <br/>com a <span className="text-primary">Leadium</span>.</h3>
            <p className="max-w-2xl text-muted-foreground text-lg mb-10">
              Conecte seus canais oficiais, configure agentes de IA e desenhe seus fluxos. Comece pelo plano Free e suba de nível quando a operação pedir.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-10 py-7 text-lg font-bold animate-pulse-subtle glow-primary shadow-lg shadow-primary/20" asChild>
                <a href="/precos">Começar grátis</a>
              </Button>
              <Button variant="outline" className="border-border hover:bg-accent rounded-full px-10 py-7 text-lg font-bold" asChild>
                <a href="/contato">Falar com o time</a>
              </Button>
            </div>
          </div>
          
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-96 h-96 bg-primary/20 blur-[120px] rounded-full" />
          <div className="absolute bottom-0 left-0 translate-y-1/4 -translate-x-1/4 w-64 h-64 bg-primary/10 blur-[80px] rounded-full" />
        </div>
      </ScrollReveal>
    </Container>
  </section>
);
