import React from "react";
import { NICHES } from "../../utils/constants";
import DisplayCards from "../ui/display-cards";
import { motion } from "framer-motion";
import { Badge } from "../ui/Badge";
import { 
  Sun, 
  GraduationCap, 
  Activity, 
  Building2, 
  Ticket, 
  Scale, 
  ShoppingBag 
} from "lucide-react";

const iconMap: Record<string, React.ReactNode> = {
  solar: <Sun className="w-6 h-6 text-primary" />,
  education: <GraduationCap className="w-6 h-6 text-primary" />,
  health: <Activity className="w-6 h-6 text-primary" />,
  realestate: <Building2 className="w-6 h-6 text-primary" />,
  events: <Ticket className="w-6 h-6 text-primary" />,
  law: <Scale className="w-6 h-6 text-primary" />,
  retail: <ShoppingBag className="w-6 h-6 text-primary" />,
};

export const Niches: React.FC = () => {
  const displayCards = NICHES.map((niche) => ({
    title: niche.label,
    description: niche.useCase,
    date: "Caso de uso",
    icon: iconMap[niche.id] || <Sun className="w-6 h-6 text-primary" />,
  }));

  return (
    <section id="niches" className="py-24 relative overflow-hidden bg-background min-h-[800px] flex items-center">
      <div className="container px-4 mx-auto relative z-10 text-foreground">
        <div className="flex flex-col lg:flex-row items-center gap-20">
          <div className="lg:w-5/12 text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <Badge className="mb-4 bg-primary/10 text-primary border-primary/20 px-3 py-1">
                FEITO PARA O SEU SEGMENTO
              </Badge>
              <h2 className="font-head text-4xl md:text-6xl font-extrabold uppercase mb-6 tracking-tight leading-[1.05]">
                Fala a língua <span className="text-primary">do seu negócio</span>
              </h2>
              <p className="text-lg sm:text-xl text-muted-foreground mb-10 leading-relaxed">
                Imobiliária qualifica e agenda visita. Clínica marca consulta e
                lembra o paciente. Loja vende pelo catálogo. A Leadium se molda à
                forma como o seu setor vende — não o contrário.
              </p>

              <div className="flex flex-col items-center lg:items-start gap-4">
                <div className="flex items-center gap-3 text-sm font-medium text-foreground/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  Funil e etapas do seu jeito de vender
                </div>
                <div className="flex items-center gap-3 text-sm font-medium text-foreground/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  Atendimentos automáticos, sem programar
                </div>
                <div className="flex items-center gap-3 text-sm font-medium text-foreground/80">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  Times separados para atender vários clientes
                </div>
              </div>
            </motion.div>
          </div>

          <div className="lg:w-7/12 flex justify-center items-center relative perspective-1000">
            <motion.div 
              className="relative w-full max-w-md h-[400px] md:h-[500px] flex items-center justify-center"
              initial={{ opacity: 0, rotateY: -20, scale: 0.8 }}
              whileInView={{ opacity: 1, rotateY: 0, scale: 1 }}
              viewport={{ once: false, amount: 0.5 }}
              transition={{ duration: 1.2, ease: "circOut" }}
            >
              <DisplayCards cards={displayCards} />
              
              {/* Decorative Glow */}
              <div className="absolute -inset-20 bg-primary/20 blur-[120px] -z-10 rounded-full animate-pulse-subtle" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] border border-primary/5 rounded-full -z-20 opacity-20" />
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};
