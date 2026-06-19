import { PRINCIPLES } from "../../utils/constants";
import { Container } from "../ui/Container";
import { SectionHeading } from "../ui/SectionHeading";
import { Card } from "../ui/Card";

export const Testimonials = () => (
  <section className="py-16">
    <Container>
      <SectionHeading
        eyebrow="Nossos princípios"
        title="O que a Leadium garante desde o primeiro dia"
        description="Somos uma plataforma nova — então preferimos falar do que entregamos, não de números que ainda não vivemos."
        align="center"
      />
      <div className="grid gap-6 md:grid-cols-3">
        {PRINCIPLES.map((principle) => (
          <Card key={principle.title} className="p-6">
            <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-primary">Princípio</p>
            <h3 className="mt-4 text-lg font-bold text-foreground">{principle.title}</h3>
            <p className="mt-3 text-base text-muted-foreground leading-relaxed">{principle.description}</p>
          </Card>
        ))}
      </div>
    </Container>
  </section>
);
