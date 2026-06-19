import { Hero as AnimatedHero } from "../components/ui/animated-hero";
import { HeroGeometric } from "../components/ui/shape-landing-hero";
import { SparklesCore } from "../components/ui/sparkles";
import { Suspense, lazy } from "react";
import { usePageMeta } from "../hooks/usePageMeta";

// Lazy loaded sections
const SneakPeek = lazy(() => import("../components/sections/SneakPeek").then(m => ({ default: m.SneakPeek })));
const TimelineSection = lazy(() => import("../components/sections/TimelineSection").then(m => ({ default: m.TimelineSection })));
const SocialProof = lazy(() => import("../components/sections/SocialProof").then(m => ({ default: m.SocialProof })));
const FeatureGrid = lazy(() => import("../components/sections/FeatureGrid").then(m => ({ default: m.FeatureGrid })));
const Niches = lazy(() => import("../components/sections/Niches").then(m => ({ default: m.Niches })));
const PricingPreview = lazy(() => import("../components/sections/PricingPreview").then(m => ({ default: m.PricingPreview })));
const Testimonials = lazy(() => import("../components/sections/Testimonials").then(m => ({ default: m.Testimonials })));
const FAQSection = lazy(() => import("../components/sections/FAQSection").then(m => ({ default: m.FAQSection })));
const FinalCTA = lazy(() => import("../components/sections/FinalCTA").then(m => ({ default: m.FinalCTA })));

const SectionLoader = () => (
  <div className="w-full py-40 flex items-center justify-center opacity-20">
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const Home = () => {
  usePageMeta({
    title: "Atendimento, vendas e IA em uma plataforma",
    description: "A Leadium unifica WhatsApp e Instagram pela API oficial da Meta, agentes de IA (LangGraph + OpenRouter), Flow Builder visual, CRM e campanhas — tudo em um só lugar.",
  });

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden min-h-screen">
        {/* Sparkles de fundo */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <SparklesCore
            id="hero-sparkles"
            background="transparent"
            minSize={0.4}
            maxSize={1.2}
            particleDensity={80}
            className="w-full h-full"
            particleColor="#1FFF13"
            speed={0.8}
          />
        </div>

        {/* Conteúdo */}
        <div className="relative z-10">
          <HeroGeometric
            badge="Leadium · Atendimento + IA"
            title1="Atendimento, vendas"
            title2="e IA em um só lugar"
          >
            <AnimatedHero />
          </HeroGeometric>
        </div>
      </section>

      <div className="relative z-10 bg-background">
        <Suspense fallback={<SectionLoader />}>
          <SneakPeek />
          <SocialProof />
          <TimelineSection />
          <FeatureGrid />
          <Niches />
          <PricingPreview />
          <Testimonials />
          <FAQSection />
          <FinalCTA />
        </Suspense>
      </div>
    </>
  );
};

export default Home;
