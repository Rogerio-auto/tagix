import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Play, Circle } from "lucide-react";
import { Button } from "../ui/Button";
import { HERO, HERO_ROTATING, HERO_HIGHLIGHTS } from "../../utils/constants";
import { useIsMobile } from "../../hooks/useIsMobile";

// Partículas só carregam (e só rodam) no desktop — performance no mobile.
const SparklesCore = lazy(() =>
  import("../ui/sparkles").then((m) => ({ default: m.SparklesCore }))
);

export const Hero = () => {
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  const words = useMemo(() => HERO_ROTATING, []);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setTimeout(
      () => setIndex((i) => (i === words.length - 1 ? 0 : i + 1)),
      2200
    );
    return () => clearTimeout(id);
  }, [index, words, reduceMotion]);

  const showParticles = !isMobile && !reduceMotion;

  return (
    <section className="relative isolate overflow-hidden">
      {/* Fundo: partículas leves só no desktop */}
      {showParticles && (
        <div className="pointer-events-none absolute inset-0 z-0">
          <Suspense fallback={null}>
            <SparklesCore
              id="hero-sparkles"
              background="transparent"
              minSize={0.4}
              maxSize={1.1}
              particleDensity={36}
              className="h-full w-full"
              particleColor="#1FFF13"
              speed={0.6}
            />
          </Suspense>
        </div>
      )}

      {/* Glow ambiente — barato, roda em qualquer device */}
      <div className="pointer-events-none absolute -top-24 left-1/2 z-0 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />

      <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-5xl flex-col items-center justify-center px-5 pb-16 pt-24 text-center sm:px-6 md:min-h-[92vh] md:pt-28">
        {/* Badge de autoridade */}
        <motion.a
          href={HERO.ctaSecondary.href}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-[12px] font-semibold tracking-wide text-foreground/80 backdrop-blur-sm transition-colors hover:border-primary/50 hover:text-foreground sm:text-sm"
        >
          <Circle className="h-2 w-2 fill-primary text-primary" />
          {HERO.badge}
        </motion.a>

        {/* H1 — único, dominante, mobile-first */}
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="font-head text-[2.85rem] font-extrabold uppercase leading-[0.98] tracking-tight text-foreground sm:text-6xl md:text-7xl lg:text-[5.25rem]"
        >
          {HERO.titleLead}
          <span className="relative mt-1 flex h-[1.12em] w-full items-center justify-center overflow-hidden">
            {/* fantasma para travar a altura na maior palavra */}
            <span className="invisible whitespace-nowrap" aria-hidden="true">
              agendamento
            </span>
            {words.map((word, i) => (
              <motion.span
                key={word}
                className="absolute whitespace-nowrap bg-gradient-to-r from-brand via-brand-bright to-brand bg-clip-text px-2 text-transparent"
                initial={false}
                animate={
                  index === i
                    ? { y: "0%", opacity: 1 }
                    : { y: index > i ? "-115%" : "115%", opacity: 0 }
                }
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 60, damping: 16 }
                }
              >
                {word}
              </motion.span>
            ))}
          </span>
        </motion.h1>

        {/* Subhead concreto */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6 }}
          className="mt-7 max-w-xl text-balance font-body text-base font-normal leading-relaxed text-muted-foreground sm:text-lg"
        >
          {HERO.subhead}
        </motion.p>

        {/* CTAs grandes, thumb-friendly */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-9 flex w-full max-w-md flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center"
        >
          <Button
            size="lg"
            className="group h-14 rounded-full px-9 text-base"
            asChild
          >
            <a href={HERO.ctaPrimary.href}>
              {HERO.ctaPrimary.label}
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="group h-14 rounded-full px-9 text-base"
            asChild
          >
            <a href={HERO.ctaSecondary.href}>
              <Play className="mr-1 h-4 w-4 transition-transform group-hover:scale-110" />
              {HERO.ctaSecondary.label}
            </a>
          </Button>
        </motion.div>

        {/* Prova rápida — 3 sinais honestos */}
        <motion.dl
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4"
        >
          {HERO_HIGHLIGHTS.map((item) => (
            <div
              key={item.label}
              className="group rounded-2xl border border-border/60 bg-foreground/[0.025] px-5 py-5 text-left backdrop-blur-sm transition-colors hover:border-primary/40"
            >
              <dt className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground/60">
                {item.label}
              </dt>
              <dd className="mt-1.5 font-head text-lg font-bold uppercase tracking-wide text-foreground transition-colors group-hover:text-primary">
                {item.value}
              </dd>
              <dd className="mt-1 text-[13px] leading-snug text-muted-foreground/80">
                {item.detail}
              </dd>
            </div>
          ))}
        </motion.dl>
      </div>

      {/* Fade para a próxima seção */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
};
