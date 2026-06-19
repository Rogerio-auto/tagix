import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'

export interface BackgroundSceneProps {
  /** Número de feixes de luz animados */
  beamCount?: number
}

const BACKGROUND_BEAM_COUNT = 60

const BackgroundScene: React.FC<BackgroundSceneProps> = ({
  beamCount = BACKGROUND_BEAM_COUNT,
}) => {
  const [beams, setBeams] = useState<
    Array<{ id: number; style: CSSProperties }>
  >([])

  useEffect(() => {
    const generated = Array.from({ length: beamCount }).map((_, i) => {
      const riseDur = Math.random() * 2 + 4   // 4–6s subida
      const fadeDur = riseDur                  // sync com fade
      const dropDur = Math.random() * 3 + 3   // 3–6s queda

      return {
        id: i,
        style: {
          left: `${Math.random() * 100}%`,
          width: `${Math.floor(Math.random() * 3) + 1}px`,
          animationDelay: `${Math.random() * 5}s`,
          animationDuration: `${riseDur}s, ${fadeDur}s, ${dropDur}s`,
        } satisfies CSSProperties,
      }
    })
    setBeams(generated)
  }, [beamCount])

  return (
    <div
      className="scene"
      role="img"
      aria-label="Animated digital data background"
    >
      <div className="floor" />
      <div className="main-column" />
      <div className="light-stream-container">
        {beams.map((beam) => (
          <div key={beam.id} className="light-beam" style={beam.style} />
        ))}
      </div>
    </div>
  )
}

export default BackgroundScene
