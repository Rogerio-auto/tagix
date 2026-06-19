"use client";

import { MessageSquare, Bot, Users, BarChart3, Rocket } from "lucide-react";
import RadialOrbitalTimeline from "../ui/radial-orbital-timeline";
import { Button } from "../ui/Button";

const timelineData = [
  {
    id: 1,
    title: "Conexão",
    date: "Passo 1",
    content: "Conecte WhatsApp e Instagram pela API oficial da Meta — incluindo Coexistence com o app WhatsApp Business.",
    category: "Setup",
    icon: MessageSquare,
    relatedIds: [2],
    status: "completed" as const,
    energy: 100,
  },
  {
    id: 2,
    title: "IA & Fluxos",
    date: "Passo 2",
    content: "Crie agentes de IA (LangGraph + OpenRouter) e desenhe fluxos no Flow Builder visual, sem código.",
    category: "Automation",
    icon: Bot,
    relatedIds: [1, 3],
    status: "completed" as const,
    energy: 95,
  },
  {
    id: 3,
    title: "Vendas",
    date: "Passo 3",
    content: "Dispare campanhas com templates aprovados pela Meta, organize o funil no CRM e gerencie a agenda do time.",
    category: "Execution",
    icon: Users,
    relatedIds: [2, 4],
    status: "in-progress" as const,
    energy: 80,
  },
  {
    id: 4,
    title: "Análise",
    date: "Passo 4",
    content: "Acompanhe dashboards role-aware com conversões, CSAT e qualidade do atendimento avaliada por IA.",
    category: "Analytics",
    icon: BarChart3,
    relatedIds: [3, 5],
    status: "pending" as const,
    energy: 50,
  },
  {
    id: 5,
    title: "Escala",
    date: "Passo 5",
    content: "Cresça com multi-agente, roteamento agente↔departamento, times e a API pública v1 com webhooks.",
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
            <h2 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
              Do primeiro canal à <span className="text-primary">escala</span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-xl">
              Cinco passos para colocar a Leadium para rodar: conectar canais, automatizar com IA, vender, medir e escalar — no seu ritmo.
            </p>
            
            <div className="space-y-6">
              {[
                { title: "Canais oficiais", desc: "WhatsApp e Instagram pela API oficial da Meta." },
                { title: "Automação com IA", desc: "Flow Builder visual e agentes que consultam sua base de conhecimento." },
                { title: "Segurança por design", desc: "Multi-tenant com RLS, credenciais criptografadas e LGPD." }
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
