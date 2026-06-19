import { ContainerScroll } from "../ui/container-scroll-animation";
import { MessageSquare, Bot, Workflow, BarChart3 } from "lucide-react";

const PANELS = [
  { icon: MessageSquare, label: "Inbox unificado", hint: "WhatsApp + Instagram" },
  { icon: Bot, label: "Agentes de IA", hint: "LangGraph + OpenRouter" },
  { icon: Workflow, label: "Flow Builder", hint: "Automação visual" },
  { icon: BarChart3, label: "Dashboards", hint: "CSAT e qualidade" },
];

export function SneakPeek() {
  return (
    <section className="flex flex-col overflow-hidden bg-background py-10 md:py-20">
      <ContainerScroll
        titleComponent={
          <>
            <h2 className="text-3xl font-semibold text-foreground md:text-5xl lg:text-7xl">
              Toda a sua operação <br />
              <span className="text-primary text-5xl md:text-[6.5rem] font-bold mt-2 leading-none">
                Em uma única tela
              </span>
            </h2>
          </>
        }
      >
        <div className="grid h-full w-full grid-cols-2 gap-4 overflow-hidden rounded-xl bg-card/40 p-4 sm:grid-cols-4 md:gap-6 md:p-8">
          {PANELS.map((panel) => {
            const Icon = panel.icon;
            return (
              <div
                key={panel.label}
                className="flex flex-col items-start justify-end gap-3 rounded-2xl border border-border/50 bg-background/60 p-4 md:p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-foreground md:text-base">{panel.label}</p>
                  <p className="text-xs text-muted-foreground">{panel.hint}</p>
                </div>
              </div>
            );
          })}
        </div>
      </ContainerScroll>
    </section>
  );
}
