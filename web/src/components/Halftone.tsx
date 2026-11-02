/**
 * The print filters. Photos print in one ink, deep ocean, on warm paper, like a
 * single-drum riso pass; SAM's stickers stay in full colour and pop off them.
 */
export function RisoFilters() {
  return (
    <svg className="riso-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <filter id="riso-ocean" colorInterpolationFilters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.075 0.16 0.55 0.97" />
            <feFuncG type="table" tableValues="0.19 0.3 0.62 0.945" />
            <feFuncB type="table" tableValues="0.27 0.42 0.72 0.89" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
