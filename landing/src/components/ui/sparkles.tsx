import { useId, useCallback } from "react";
import { ParticlesProvider, Particles } from "@tsparticles/react";
import type { Container } from "@tsparticles/engine";
import { loadSlim } from "@tsparticles/slim";
import { cn } from "@/lib/utils";
import { motion, useAnimation } from "framer-motion";

type ParticlesProps = {
  id?: string;
  className?: string;
  background?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
  particleColor?: string;
  particleDensity?: number;
};

export const SparklesCore = (props: ParticlesProps) => {
  const {
    id,
    className,
    background,
    minSize,
    maxSize,
    speed,
    particleColor,
    particleDensity,
  } = props;

  const controls = useAnimation();
  const generatedId = useId();

  const particlesLoaded = useCallback(async (container?: Container) => {
    if (container) {
      await controls.start({
        opacity: 1,
        transition: { duration: 1 },
      });
    }
  }, [controls]);

  const init = useCallback(loadSlim, []);

  return (
    <ParticlesProvider init={init}>
      <motion.div animate={controls} className={cn("opacity-0 w-full h-full", className)}>
        <Particles
          id={id ?? generatedId}
          className="w-full h-full"
          particlesLoaded={particlesLoaded}
          options={{
            background: {
              color: { value: background ?? "transparent" },
            },
            fullScreen: { enable: false, zIndex: 1 },
            fpsLimit: 120,
            interactivity: {
              events: {
                onClick: { enable: true, mode: "push" },
                onHover: { enable: false, mode: "repulse" },
              },
              modes: {
                push: { quantity: 4 },
                repulse: { distance: 200, duration: 0.4 },
              },
            },
            particles: {
              color: { value: particleColor ?? "#ffffff" },
              move: {
                direction: "none",
                enable: true,
                outModes: { default: "out" },
                random: false,
                speed: { min: 0.1, max: 1 },
                straight: false,
              },
              number: {
                density: { enable: true, width: 400, height: 400 },
                value: particleDensity ?? 120,
              },
              opacity: {
                value: { min: 0.1, max: 1 },
                animation: {
                  enable: true,
                  speed: speed ?? 4,
                  sync: false,
                },
              },
              shape: { type: "circle" },
              size: {
                value: { min: minSize ?? 1, max: maxSize ?? 3 },
              },
            },
            detectRetina: true,
          }}
        />
      </motion.div>
    </ParticlesProvider>
  );
};
