import { useId } from 'react';
import { joinClass, resolveRig, svgSafeId } from './rig';
import type { RigArtProps } from './rig';

/**
 * Robô do Leadium, LOD `md`, desenhado na grade de 48 (F76-S10). Arte original.
 *
 * Postos `heading` e `perch` (lg+). Traço único de 1,5 px; borda externa de cada contorno em
 * pixel inteiro (o caminho fica 0,75 para dentro). Cores só por `--m-*` (mapeadas em
 * `rig.css` sob `[data-companion]`); nenhum hex. Camadas e pivôs: `rig.json`.
 *
 * Anatomia (y de cima para baixo): ponta da antena 1,25–5,75 · haste até a cabeça · cabeça
 * 9–39 × 8–30 (cápsula) · visor 13–35 × 12–26 · olhos 4×6 em 17 e 27 · pescoço vazio de 2 px ·
 * corpo 17–31 × 32–43 · braços saem de DENTRO do corpo (a junta some sob o preenchimento) ·
 * sombra de contato centrada em y 45,5.
 *
 * Estático por natureza: `pose` aplica o quadro-chave em estilo inline; o motor (S11) anima.
 */
export function RigMd48({ className, ...props }: RigArtProps) {
  const r = resolveRig('md-48', props);
  const shadowId = svgSafeId(useId(), 'm-shadow');

  return (
    <svg
      viewBox="0 0 48 48"
      width={48}
      height={48}
      aria-hidden="true"
      focusable="false"
      className={joinClass('m-rig', className)}
      data-rig="md-48"
      data-eyes={r.eyes}
      data-tip={r.tip}
      data-look={r.look}
      data-pose={props.pose ?? 'rest'}
    >
      <defs>
        <radialGradient id={shadowId}>
          <stop offset="0" style={{ stopColor: 'var(--m-shadow)' }} />
          <stop offset="1" style={{ stopColor: 'var(--m-shadow)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      <ellipse
        data-layer="shadow"
        className="m-shadow"
        cx="24"
        cy="45.5"
        rx="13"
        ry="2.5"
        fill={`url(#${shadowId})`}
        style={r.style('shadow')}
      />

      <g data-layer="fig" style={r.style('fig')}>
        <circle
          data-layer="halo"
          className="m-halo"
          cx="24"
          cy="19"
          r="15"
          style={r.style('halo')}
        />

        <g data-layer="arm-l" style={r.style('arm-l')}>
          <path className="m-line" d="M20 34.5 16.25 40.25" />
        </g>
        <g data-layer="arm-r" style={r.style('arm-r')}>
          <path className="m-line" d="M28 34.5l1.875 2.875" />
          <g data-layer="hand-r" style={r.style('hand-r')}>
            <path className="m-line" d="M29.875 37.375 31.75 40.25" />
          </g>
        </g>

        <g data-layer="body" style={r.style('body')}>
          <path
            className="m-solid"
            d="M21.5 32.75h5q3.75 0 3.75 3.5l-.85 3.35q-.65 2.65-3.4 2.65h-4q-2.75 0-3.4-2.65l-.85-3.35q0-3.5 3.75-3.5Z"
          />
        </g>

        <g data-layer="head" style={r.style('head')}>
          <g data-layer="antenna" style={r.style('antenna')}>
            <path className="m-line" d="M24 8.75V5.5" />
            <circle
              data-layer="antenna-tip"
              className="m-tip"
              cx="24"
              cy="3.5"
              r="2.25"
              style={r.style('antenna-tip')}
            />
          </g>
          <rect className="m-solid" x="9.75" y="8.75" width="28.5" height="20.5" rx="9.25" />
          <rect
            data-layer="visor"
            className="m-visor"
            x="13"
            y="12"
            width="22"
            height="14"
            rx="7"
            style={r.style('visor')}
          />

          <g data-layer="eyes" className="m-eyes" style={r.style('eyes')}>
            <g data-layer="eyes-open" className="m-eyeset" style={r.style('eyes-open')}>
              <rect className="m-eye" x="17" y="16" width="4" height="6" rx="2" />
              <rect className="m-eye" x="27" y="16" width="4" height="6" rx="2" />
            </g>
            <path
              data-layer="eyes-closed"
              className="m-eyeset m-eye-line"
              d="M17.75 19.25h2.5M27.75 19.25h2.5"
            />
            <path
              data-layer="eyes-happy"
              className="m-eyeset m-eye-line"
              d="M17.25 20.5Q19 16.5 20.75 20.5M27.25 20.5Q29 16.5 30.75 20.5"
            />
            <g data-layer="eyes-squint" className="m-eyeset">
              <path className="m-eye-line" d="M17.75 20.5h2.5" />
              <rect className="m-eye" x="27" y="15" width="4" height="6" rx="2" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
