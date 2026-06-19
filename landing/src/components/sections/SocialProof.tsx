import { Container } from "../ui/Container";
import { ShieldCheck, Instagram, MessageCircle, Lock } from "lucide-react";

const PILLARS = [
  {
    icon: MessageCircle,
    title: "WhatsApp oficial",
    detail: "Conexão oficial pela Meta — sem risco de bloqueio",
  },
  {
    icon: Instagram,
    title: "Instagram oficial",
    detail: "Direct e comentários no mesmo lugar",
  },
  {
    icon: ShieldCheck,
    title: "Aprovado pela Meta",
    detail: "Dentro das regras das plataformas, sem gambiarra",
  },
  {
    icon: Lock,
    title: "Dados protegidos",
    detail: "Tudo isolado e criptografado, em conformidade com a LGPD",
  },
];

export const SocialProof = () => (
  <section className="py-14 sm:py-16" aria-label="Canais oficiais e segurança">
    <Container>
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.5em] text-muted-foreground/60 sm:text-xs">
        Oficial de verdade — onde o seu cliente já está
      </p>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div
              key={pillar.title}
              className="flex flex-col items-center justify-center rounded-2xl border border-border/50 bg-card/40 p-5 text-center backdrop-blur-sm transition-colors hover:border-primary/30"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-bold uppercase tracking-wide text-foreground">
                {pillar.title}
              </span>
              <span className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
                {pillar.detail}
              </span>
            </div>
          );
        })}
      </div>
    </Container>
  </section>
);
