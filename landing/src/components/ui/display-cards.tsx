"use client";

import { cn } from "../../lib/utils";
import { Sparkles } from "lucide-react";
import { motion, useMotionValue, useTransform } from "framer-motion";
import { useState, useEffect } from "react";

interface DisplayCardProps {
  className?: string;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  date?: string;
  iconClassName?: string;
  titleClassName?: string;
  style?: React.CSSProperties;
  index?: number;
  onSendToBack?: () => void;
}

function DisplayCard({
  className,
  icon = <Sparkles className="size-4 text-primary" />,
  title = "Destaque",
  description = "Conheça novos conteúdos",
  date = "Agora mesmo",
  titleClassName = "text-primary",
  style,
  index = 0,
  onSendToBack,
}: DisplayCardProps) {
  const [isZIndexHigh, setIsZIndexHigh] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  // Efeito de rotação e escala enquanto arrasta
  const rotateDrag = useTransform(x, [-300, 300], [-30, 30]);
  const scaleDrag = useTransform(x, [-150, 0, 150], [1.1, 1, 1.1]);
  const opacityDrag = useTransform(x, [-400, -300, 0, 300, 400], [0, 1, 1, 1, 0]);

  // Posição base na pilha com um leve efeito de profundidade 3D
  const baseRotation = -4 + (index * 2);
  const baseX = index * 8;
  const baseY = index * 12;

  return (
    <motion.div
      style={{
        ...style,
        x,
        y,
        rotate: isZIndexHigh ? rotateDrag : baseRotation,
        scale: isZIndexHigh ? scaleDrag : 1,
        opacity: opacityDrag,
        zIndex: isZIndexHigh ? 100 : (50 - index),
        left: "50%",
        marginLeft: isMobile ? `calc(-9rem + ${baseX}px)` : `calc(-13rem + ${baseX}px)`,
        top: baseY,
      }}
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
      onDragStart={() => setIsZIndexHigh(true)}
      onDragEnd={(_, info) => {
        setIsZIndexHigh(false);
        // Se arrastou o suficiente (reduzido para mobile ser mais fácil), manda para o fim da fila
        if (Math.abs(info.offset.x) > 60 || Math.abs(info.offset.y) > 60) {
          onSendToBack?.();
          x.set(0);
          y.set(0);
        }
      }}
      whileTap={{ cursor: "grabbing" }}
      className={cn(
        "absolute flex h-64 w-[18rem] sm:w-[26rem] select-none flex-col justify-between rounded-[2rem] border border-border bg-card/90 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:border-primary/40 group touch-none",
        className
      )}
    >
      {/* Glossy Overlay */}
      <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-foreground/5 to-transparent pointer-events-none" />
      
      <div className="flex items-center gap-4 relative z-10">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner group-hover:scale-110 transition-transform duration-500">
          <div className="absolute inset-0 bg-primary/10 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          {icon}
        </div>
        <div className="flex flex-col">
          <p className={cn("text-2xl font-bold tracking-tight text-foreground", titleClassName)}>{title}</p>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">Intelligence Deck</p>
        </div>
      </div>
      
      <p className="text-xl font-medium leading-relaxed text-foreground/80 relative z-10">
        {description}
      </p>
      
      <div className="flex items-center justify-between border-t border-border/50 pt-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse shadow-[0_0_10px_rgba(var(--primary),0.8)]" />
          <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{date}</span>
        </div>
        <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
          <Sparkles size={16} className="text-primary" />
          <span className="text-[10px] font-black text-primary">PREMIUM</span>
        </div>
      </div>

      {/* Dica visual de arrastar no primeiro card */}
      {index === 0 && (
        <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-60 animate-bounce pointer-events-none">
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.3em]">Arraste para explorar</p>
          <div className="w-px h-6 bg-gradient-to-b from-blue-500 to-transparent" />
        </div>
      )}
    </motion.div>
  );
}

interface DisplayCardsProps {
  cards?: DisplayCardProps[];
}

export default function DisplayCards({ cards: initialCards }: DisplayCardsProps) {
  const [cards, setCards] = useState(initialCards || []);

  // Sincroniza se as props mudarem
  useEffect(() => {
    if (initialCards) {
      setCards(initialCards);
    }
  }, [initialCards]);

  const sendToBack = (index: number) => {
    setCards((prev) => {
      const newCards = [...prev];
      const [card] = newCards.splice(index, 1);
      newCards.push(card);
      return newCards;
    });
  };

  if (!cards || cards.length === 0) return null;

  return (
    <div className="relative h-[550px] w-full flex items-center justify-center py-20 px-4">
      <div className="relative w-full max-w-sm h-full flex items-center justify-center">
        {cards.map((cardProps, index) => (
          <DisplayCard 
            key={cardProps.title} 
            index={index} 
            onSendToBack={() => sendToBack(index)}
            {...cardProps} 
          />
        ))}
      </div>
    </div>
  );
}
