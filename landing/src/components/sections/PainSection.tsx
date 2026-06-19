import { motion } from "framer-motion";
import { X, Check } from "lucide-react";
import { Container } from "../ui/Container";
import { PAINS } from "../../utils/constants";

export const PainSection = () => (
  <section className="py-20 sm:py-28" aria-label="O custo do atendimento que demora">
    <Container>
      <div className="mx-auto mb-12 max-w-2xl text-center sm:mb-16">
        <span className="kicker mb-4 inline-flex">Você se reconhece?</span>
        <h2 className="font-head text-3xl font-extrabold uppercase leading-[1.05] tracking-tight text-foreground sm:text-5xl">
          Todo dia, venda escapa <span className="text-primary">sem você ver</span>
        </h2>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
          Não é falta de esforço. É o atendimento manual não dando conta. Veja o
          que muda quando a Leadium entra na operação.
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl gap-4 sm:gap-5">
        {PAINS.map((pain, i) => (
          <motion.div
            key={pain.id}
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.55, delay: i * 0.08, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="grid gap-3 rounded-3xl border border-border/60 bg-foreground/[0.02] p-4 sm:grid-cols-2 sm:gap-5 sm:p-6"
          >
            {/* Antes — a dor */}
            <div className="flex gap-3.5 rounded-2xl bg-foreground/[0.02] p-4 sm:p-5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                <X className="h-4 w-4" />
              </span>
              <p className="text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                {pain.before}
              </p>
            </div>

            {/* Depois — a transformação */}
            <div className="flex gap-3.5 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 sm:p-5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                <Check className="h-4 w-4" />
              </span>
              <p className="text-[15px] font-medium leading-relaxed text-foreground sm:text-base">
                {pain.after}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </Container>
  </section>
);
