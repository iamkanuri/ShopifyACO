// Abstract brand mark: a lens / aperture / focus reticle. Deliberately
// name-agnostic (no letter, no cart, no robot) so it works behind any
// PUBLIC_BRAND_NAME. Strokes use currentColor so the container sets the color.
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* lens ring */}
      <circle cx="16" cy="16" r="12.5" />
      {/* aperture triangle (focus opening) */}
      <path d="M16 8 L22.9 20 L9.1 20 Z" />
      {/* focal point */}
      <circle cx="16" cy="16" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
