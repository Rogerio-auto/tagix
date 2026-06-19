"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowRight, Link, Zap } from "lucide-react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";

interface TimelineItem {
  id: number;
  title: string;
  date: string;
  content: string;
  category: string;
  icon: React.ElementType;
  relatedIds: number[];
  status: "completed" | "in-progress" | "pending";
  energy: number;
}

interface RadialOrbitalTimelineProps {
  timelineData: TimelineItem[];
}

export default function RadialOrbitalTimeline({
  timelineData,
}: RadialOrbitalTimelineProps) {
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>(
    {}
  );
  const [viewMode] = useState<"orbital">("orbital");
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [pulseEffect, setPulseEffect] = useState<Record<number, boolean>>({});
  const [centerOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const getRelatedItems = useCallback((itemId: number): number[] => {
    const currentItem = timelineData.find((item) => item.id === itemId);
    return currentItem ? currentItem.relatedIds : [];
  }, [timelineData]);

  const centerViewOnNode = useCallback((nodeId: number) => {
    if (viewMode !== "orbital" || !nodeRefs.current[nodeId]) return;

    const nodeIndex = timelineData.findIndex((item) => item.id === nodeId);
    const totalNodes = timelineData.length;
    // Posição base fixa do nó (sem considerar a rotação global)
    const nodeBaseAngle = (nodeIndex / totalNodes) * 360;

    // Queremos que este nó específico fique no topo (270 graus)
    // Então giramos o PARENT para (270 - nodeBaseAngle)
    setRotationAngle(270 - nodeBaseAngle);
  }, [timelineData, viewMode]);

  const toggleItem = useCallback((id: number) => {
    setExpandedItems((prev) => {
      const isClosing = prev[id];
      const newState: Record<number, boolean> = {};

      if (!isClosing) {
        newState[id] = true;
        setActiveNodeId(id);
        setAutoRotate(false);

        const relatedItems = getRelatedItems(id);
        const newPulseEffect: Record<number, boolean> = {};
        relatedItems.forEach((relId) => {
          newPulseEffect[relId] = true;
        });
        setPulseEffect(newPulseEffect);

        centerViewOnNode(id);
      } else {
        setActiveNodeId(null);
        setAutoRotate(true);
        setPulseEffect({});
      }

      return newState;
    });
  }, [getRelatedItems, centerViewOnNode]);

  // Rotation effect
  useEffect(() => {
    if (!autoRotate) return;

    let frameId: number;
    const animate = () => {
      setRotationAngle((prev) => (prev + 0.15) % 360);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [autoRotate]);

  // 20-second Animation Cycle Logic
  useEffect(() => {
    let timer: any;
    let isRotating = true;
    let lastItemId: number | null = null;

    const runStep = () => {
      if (isRotating) {
        // Rotating Phase (10s)
        setExpandedItems({});
        setActiveNodeId(null);
        setPulseEffect({});
        setAutoRotate(true);
        timer = setTimeout(() => {
          isRotating = false;
          runStep();
        }, 10000);
      } else {
        // Expanding Phase (10s)
        // Escolhe um item diferente do último para evitar o bug de repetir o mesmo
        const availableItems = timelineData.filter(item => item.id !== lastItemId);
        const randomIndex = Math.floor(Math.random() * availableItems.length);
        const randomItem = availableItems[randomIndex];
        
        if (randomItem) {
          lastItemId = randomItem.id;
          toggleItem(randomItem.id);
        }
        
        timer = setTimeout(() => {
          isRotating = true;
          runStep();
        }, 10000);
      }
    };

    runStep();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timelineData, toggleItem]);

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setExpandedItems({});
      setActiveNodeId(null);
      setPulseEffect({});
      setAutoRotate(true);
    }
  };

  const calculateNodePosition = useCallback((index: number, total: number) => {
    // Posição angular fixa na órbita
    const angle = (index / total) * 360;
    const radius = 200;
    const radian = (angle * Math.PI) / 180;

    const x = radius * Math.cos(radian);
    const y = radius * Math.sin(radian);

    // Z-index e opacidade baseados na posição relativa ao topo (visual)
    const visualAngle = (angle + rotationAngle) % 360;
    const visualRadian = (visualAngle * Math.PI) / 180;
    // O topo é 270 graus, onde sin é -1. Queremos o maior z-index e opacidade lá.
    const zIndex = Math.round(100 - 50 * Math.sin(visualRadian));
    const opacity = Math.max(0.5, Math.min(1, 0.4 + 0.6 * ((1 - Math.sin(visualRadian)) / 2)));

    return { x, y, angle, zIndex, opacity };
  }, [rotationAngle]);

  const isRelatedToActive = (itemId: number): boolean => {
    if (!activeNodeId) return false;
    const relatedItems = getRelatedItems(activeNodeId);
    return relatedItems.includes(itemId);
  };

  return (
    <div
      className="w-full h-[600px] flex flex-col items-center justify-center bg-transparent overflow-hidden"
      ref={containerRef}
      onClick={handleContainerClick}
    >
      <div className="relative w-full max-w-4xl h-full flex items-center justify-center">
        <div
          className="absolute w-full h-full flex items-center justify-center transition-transform duration-700 ease-in-out"
          ref={orbitRef}
          style={{
            perspective: "1000px",
            transform: `translate(${centerOffset.x}px, ${centerOffset.y}px) rotate(${rotationAngle}deg)`,
          }}
        >
          {/* Centered Glowing Orb */}
          <div 
            className="absolute w-16 h-16 rounded-full bg-gradient-to-br from-primary via-blue-500 to-indigo-600 animate-pulse flex items-center justify-center z-20 shadow-[0_0_40px_rgba(47,180,99,0.4)]"
            style={{ transform: `rotate(${-rotationAngle}deg)` }}
          >
            <div className="absolute w-24 h-24 rounded-full border border-primary/20 animate-ping opacity-60"></div>
            <div
              className="absolute w-28 h-28 rounded-full border border-blue-500/20 animate-ping opacity-40"
              style={{ animationDelay: "0.5s" }}
            ></div>
            <div className="w-8 h-8 rounded-full bg-background/20 backdrop-blur-xl border border-foreground/30 shadow-inner"></div>
          </div>

          {/* Orbital Path Line */}
          <div className="absolute w-[400px] h-[400px] rounded-full border border-primary/10 shadow-[inset_0_0_20px_rgba(59,130,246,0.05)]"></div>

          {timelineData.map((item, index) => {
            const position = calculateNodePosition(index, timelineData.length);
            const isExpanded = expandedItems[item.id];
            const isRelated = isRelatedToActive(item.id);
            const isPulsing = pulseEffect[item.id];
            const Icon = item.icon;

            const nodeStyle = {
              transform: `translate(${position.x}px, ${position.y}px) rotate(${-rotationAngle}deg)`,
              zIndex: isExpanded ? 500 : position.zIndex,
              opacity: isExpanded ? 1 : position.opacity,
            };

            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) nodeRefs.current[item.id] = el;
                }}
                className="absolute transition-all duration-700 ease-in-out cursor-pointer"
                style={nodeStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleItem(item.id);
                }}
              >
                {/* Glow behind the node */}
                <div
                  className={`absolute rounded-full -inset-1 ${
                    isPulsing ? "animate-pulse duration-1000" : ""
                  }`}
                  style={{
                    background: `radial-gradient(circle, ${isExpanded ? "rgba(59,130,246,0.3)" : "rgba(59,130,246,0.15)"} 0%, rgba(0,0,0,0) 70%)`,
                    width: `${item.energy * 0.5 + 40}px`,
                    height: `${item.energy * 0.5 + 40}px`,
                    left: `-${(item.energy * 0.5 + 40 - 40) / 2}px`,
                    top: `-${(item.energy * 0.5 + 40 - 40) / 2}px`,
                  }}
                ></div>

                <div
                  className={`
                  w-12 h-12 rounded-full flex items-center justify-center
                  ${
                    isExpanded
                      ? "bg-blue-600 text-white"
                      : isRelated
                      ? "bg-primary/40 text-white"
                      : "bg-background/80 text-foreground"
                  }
                  border-2 
                  ${
                    isExpanded
                      ? "border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.5)]"
                      : isRelated
                      ? "border-primary/60 animate-pulse"
                      : "border-border/50"
                  }
                  backdrop-blur-md transition-all duration-300 transform
                  ${isExpanded ? "scale-150" : "hover:scale-110"}
                `}
                >
                  <Icon size={18} />
                </div>

                <div
                  className={`
                  absolute top-14 left-1/2 -translate-x-1/2 whitespace-nowrap
                  text-[10px] sm:text-xs font-bold tracking-widest uppercase
                  transition-all duration-300
                  ${isExpanded ? "text-blue-400 scale-125" : "text-muted-foreground/70"}
                `}
                >
                  {item.title}
                </div>

                {isExpanded && (
                  <Card className="absolute top-24 left-1/2 -translate-x-1/2 w-72 bg-background/95 backdrop-blur-xl border-blue-500/30 shadow-2xl shadow-blue-600/20 overflow-visible z-[210] animate-in fade-in zoom-in-95 duration-500">
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 w-[2px] h-4 bg-gradient-to-t from-blue-500/50 to-transparent"></div>
                    <CardHeader className="p-5 pb-3">
                      <div className="flex justify-between items-center mb-1">
                        <Badge
                          className={`px-2 py-0 text-[10px] font-black border-none ${
                            item.status === 'completed' 
                              ? 'bg-primary/20 text-primary' 
                              : 'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {item.status === "completed"
                            ? "QUALIFICADO"
                            : item.status === "in-progress"
                            ? "PROCESSANDO"
                            : "AGUARDANDO"}
                        </Badge>
                        <span className="text-[10px] font-mono text-muted-foreground/80 tracking-tighter">
                          {item.date}
                        </span>
                      </div>
                      <CardTitle className="text-base font-bold text-foreground">
                        {item.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-5 pt-0">
                      <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                        {item.content}
                      </p>

                      <div className="mt-5 pt-4 border-t border-border/10">
                        <div className="flex justify-between items-center text-[10px] mb-2 font-bold tracking-widest text-muted-foreground">
                          <span className="flex items-center uppercase">
                            <Zap size={10} className="mr-1.5 text-blue-500 fill-blue-500" />
                            Progresso
                          </span>
                          <span className="font-mono text-blue-400">{item.energy}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-primary animate-shimmer"
                            style={{ width: `${item.energy}%`, backgroundSize: '200% 100%' }}
                          ></div>
                        </div>
                      </div>

                      {item.relatedIds.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-border/10">
                          <div className="flex items-center mb-3 text-muted-foreground">
                            <Link size={10} className="mr-1.5" />
                            <h4 className="text-[10px] uppercase tracking-[0.2em] font-black text-foreground/90">
                              Nodos Conectados
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item.relatedIds.map((relatedId) => {
                              const relatedItem = timelineData.find(
                                (i) => i.id === relatedId
                              );
                              return (
                                <Button
                                  key={relatedId}
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-3 py-0 text-[10px] font-bold rounded-full border-border/20 bg-foreground/5 hover:bg-blue-600/30 hover:border-blue-500/50 text-foreground hover:text-white transition-all duration-300 shadow-sm"
                                   onClick={(e: any) => {
                                    e.stopPropagation();
                                    toggleItem(relatedId);
                                  }}
                                >
                                  {relatedItem?.title}
                                  <ArrowRight
                                    size={10}
                                    className="ml-1.5 opacity-70"
                                  />
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
