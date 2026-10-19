import { useId } from 'react';
import { joinClass, resolveRig, svgSafeId } from './rig';
import type { RigArtProps } from './rig';

/**
 * Robô do Leadium, LOD de celular, desenhado À MÃO na grade de 40 (não é o 48 reduzido).
 *
 * Posto `inline` (< lg): caixa 40×40 na linha do logotipo; nunca voa nem acena. Os braços
 * viram tocos fundidos ao contorno do corpo (dentro do grupo `body`); `arm-l`, `arm-r` e
 * `hand-r` existem vazios para o contrato de camadas ser o mesmo nos dois LODs.
 *
 * Proporção puxada para a leitura em tamanho pequeno: olhos do mesmo 4×6 do 48 numa cabeça
 * menor (rosto maior em relação ao corpo), visor com as mesmas margens 2,5/3,5.
 */
export function RigInline40({ className, ...props }: RigArtProps) {
  const r = resolveRig('inline-40', props);
  const shadowId = svgSafeId(useId(), 'm-shadow');

  return (
    <svg
      viewBox="0 0 40 40"
      width={40}
      height={40}
      aria-hidden="true"
      focusable="false"
      className={joinClass('m-rig', className)}
      data-rig="inline-40"
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
        cx="20"
        cy="38.25"
        rx="10.5"
        ry="1.75"
        fill={`url(#${shadowId})`}
        style={r.style('shadow')}
      />

      <g data-layer="fig" style={r.style('fig')}>
        <circle
          data-layer="halo"
          className="m-halo"
          cx="20"
          cy="16"
          r="13"
          style={r.style('halo')}
        />

        <g data-layer="arm-l" style={r.style('arm-l')} />
        <g data-layer="arm-r" style={r.style('arm-r')}>
          <g data-layer="hand-r" style={r.style('hand-r')} />
        </g>

        <g data-layer="body" style={r.style('body')}>
          <path className="m-line" d="M16.75 30.5 13.5 34.5M23.25 30.5l3.25 4" />
          <path
            className="m-solid"
            d="M17.5 28.75h5q2.75 0 2.75 2.75l-.65 2.9q-.5 1.85-2.6 1.85h-4q-2.1 0-2.6-1.85l-.65-2.9q0-2.75 2.75-2.75Z"
          />
        </g>

        <g data-layer="head" style={r.style('head')}>
          <g data-layer="antenna" style={r.style('antenna')}>
            <path className="m-line" d="M20 6.75V4.5" />
            <circle
              data-layer="antenna-tip"
              className="m-tip"
              cx="20"
              cy="2.75"
              r="2"
              style={r.style('antenna-tip')}
            />
          </g>
          <rect className="m-solid" x="7.75" y="6.75" width="24.5" height="18.5" rx="8.5" />
          <rect
            data-layer="visor"
            className="m-visor"
            x="11"
            y="10"
            width="18"
            height="12"
            rx="6"
            style={r.style('visor')}
          />

          <g data-layer="eyes" className="m-eyes" style={r.style('eyes')}>
            <g data-layer="eyes-open" className="m-eyeset" style={r.style('eyes-open')}>
              <rect className="m-eye" x="14" y="13" width="4" height="6" rx="2" />
              <rect className="m-eye" x="22" y="13" width="4" height="6" rx="2" />
            </g>
            <path
              data-layer="eyes-closed"
              className="m-eyeset m-eye-line"
              d="M14.75 16.25h2.5M22.75 16.25h2.5"
            />
            <path
              data-layer="eyes-happy"
              className="m-eyeset m-eye-line"
              d="M14.25 17.5Q16 13.5 17.75 17.5M22.25 17.5Q24 13.5 25.75 17.5"
            />
            <g data-layer="eyes-squint" className="m-eyeset">
              <path className="m-eye-line" d="M14.75 17.5h2.5" />
              <rect className="m-eye" x="22" y="12" width="4" height="6" rx="2" />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
