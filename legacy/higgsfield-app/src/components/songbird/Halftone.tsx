/**
 * Halftone printing.
 *
 * Every photograph in Songbird is a two-ink riso print: a warm plate for the
 * highlights, vermilion through the middle, deep ocean in the shadows, plus a dot
 * screen that is deliberately a hair out of register. The duotone itself is an SVG
 * component transfer so it holds up at 40px on the strip and at 200px on the
 * J-card.
 */
export function RisoFilters() {
  return (
    <svg className="riso-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <filter id="riso-photo" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.99 0.94 0.1" />
            <feFuncG type="table" tableValues="0.93 0.36 0.16" />
            <feFuncB type="table" tableValues="0.79 0.22 0.2" />
          </feComponentTransfer>
        </filter>
        <filter id="riso-paper" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" seed="7" result="n" />
          <feColorMatrix type="saturate" values="0" in="n" result="g" />
          <feComponentTransfer in="g">
            <feFuncA type="linear" slope="0.5" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}

export function HalftonePhoto({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <span className={`halftone ${className}`.trim()} role="img" aria-label={alt}>
      <img className="halftone__img" src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      <span className="halftone__screen" aria-hidden="true" />
      <span className="halftone__warm" aria-hidden="true" />
    </span>
  );
}
