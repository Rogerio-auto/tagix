import { Hero } from "../components/sections/Hero";
import { Suspense, lazy, type ComponentType } from "react";
import { usePageMeta } from "../hooks/usePageMeta";
import { StickyMobileCTA } from "../components/sections/StickyMobileCTA";
import { SectionBoundary } from "../components/ui/SectionBoundary";

// Lazy loaded sections
const PainSection = lazy(() => import("../components/sections/PainSection").then(m => ({ default: m.PainSection })));
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

/**
 * Cada seção é isolada por um Suspense próprio (lazy/loader não bloqueia as
 * outras) e por um SectionBoundary (erro em uma seção degrada em silêncio,
 * nunca quebra a página inteira). Essencial no mobile, onde animações pesadas
 * podem falhar em devices específicos.
 */
const Section = ({
  name,
  component: SectionComponent,
}: {
  name: string;
  component: ComponentType;
}) => (
  <SectionBoundary name={name}>
    <Suspense fallback={<SectionLoader />}>
      <SectionComponent />
    </Suspense>
  </SectionBoundary>
);

const Home = () => {
  usePageMeta({
    title: "Cada conversa virando venda — no automático",
    description:
      "A Leadium responde, qualifica e agenda sozinha no WhatsApp e Instagram que você já usa. Atendimento, IA e automação em um só lugar — pare de perder cliente por demora.",
  });

  return (
    <>
      <Hero />

      <div className="relative z-10 bg-background">
        <Section name="SocialProof" component={SocialProof} />
        <Section name="PainSection" component={PainSection} />
        <Section name="TimelineSection" component={TimelineSection} />
        <Section name="FeatureGrid" component={FeatureGrid} />
        <Section name="Niches" component={Niches} />
        <Section name="PricingPreview" component={PricingPreview} />
        <Section name="Testimonials" component={Testimonials} />
        <Section name="FAQSection" component={FAQSection} />
        <Section name="FinalCTA" component={FinalCTA} />
      </div>

      <StickyMobileCTA />
    </>
  );
};

export default Home;
