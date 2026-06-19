"use client";

import { MessageSquare, Bot, Users, BarChart3, Rocket } from "lucide-react";
import RadialOrbitalTimeline from "../ui/radial-orbital-timeline";
import { Button } from "../ui/Button";

const timelineData = [
  {
    id: 1,
    title: "Conecte",
    date: "Passo 1",
    content: "Ligue o WhatsApp que você já usa e o Instagram em minutos. Sem trocar de chip, sem perder o histórico das conversas.",
    category: "Setup",
    icon: MessageSquare,
    relatedIds: [2],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 2,
    title: "Automatize",
    date: "Passo 2",
    content: "Monte o atendimento arrastando blocos na tela e ative a IA, que aprende sobre o seu negócio e responde sozinha.",
    category: "Automation",
    icon: Bot,
    relatedIds: [1, 3],
    status: "completed" as const,
    energy: 95,
  },
  {
    id: 3,
    title: "Venda",
    date: "Passo 3",
    content: "Cada conversa vira um card no funil. Dispare ofertas para a base inteira e marque horários direto na agenda do time.",
    category: "Execution",
    icon: Users,
    relatedIds: [2, 4],
    status: "in-progress" as const,
    energy: 80,
  },
  {
    id: 4,
    title: "Acompanhe",
    date: "Passo 4",
    content: "Veja quanto vende, quanto o time demora e o que o cliente acha — com a satisfação avaliada automaticamente.",
    category: "Analytics",
    icon: BarChart3,
    relatedIds: [3, 5],
    status: "pending" as const,
    energy: 50,
  },
  {
    id: 5,
    title: "Cresça",
    date: "Passo 5",
    content: "Adicione times, departamentos e novas IAs trabalhando juntas conforme a operação aumenta. No seu ritmo.",
    category: "Growth",
    icon: Rocket,
    relatedIds: [4],
    status: "pending" as const,
    energy: 20,
  },
];

export function TimelineSection() {
  return (
    <section className="py-32 bg-background overflow-hidden relative" id="como-funciona">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="text-left">
            <span className="kicker mb-4 inline-flex">Como funciona</span>
            <h2 className="font-head text-4xl font-extrabold uppercase leading-[1.05] tracking-tight text-foreground mb-6 md:text-6xl">
              No ar hoje. <span className="text-primary">Vendendo amanhã.</span>
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg mb-8 max-w-xl leading-relaxed">
              Cinco passos simples: conectar, automatizar, vender, acompanhar e crescer. Sem TI, sem manual de cem páginas, sem fricção.
            </p>

            <div className="space-y-4">
              {[
                { title: "Continue no seu número", desc: "Liga o WhatsApp que você já usa, sem perder histórico." },
                { title: "IA que responde por você", desc: "Atende, qualifica e agenda — 24 horas, sem cansar." },
                { title: "Sem código, sem complicação", desc: "Monta o atendimento arrastando blocos na tela." }
              ].map((item) => (
                <div key={item.title} className="flex gap-4 p-4 rounded-2xl bg-foreground/5 border border-foreground/10 hover:border-primary/30 transition-all">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Rocket className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">{item.title}</h4>
                    <p className="text-sm text-foreground/50">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-10">
              <Button size="lg" className="rounded-full px-8" asChild>
                <a href="/precos">Começar jornada</a>
              </Button>
            </div>
          </div>
          
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 blur-3xl opacity-30 rounded-full" />
            <RadialOrbitalTimeline timelineData={timelineData} />
          </div>
        </div>
      </div>
    </section>
  );
}
