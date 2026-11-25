/** skAItch logo: a speech bubble holding a floor plan (same artwork as build/icon.svg). */
export function SkaitchMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="6 7 52 52" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} style={{ flex: '0 0 auto', display: 'block' }}>
      {title && <title>{title}</title>}
      <path d="M14 9H50Q56 9 56 15V41Q56 47 50 47H26L14 57V47Q8 47 8 41V15Q8 9 14 9Z" fill="#FFB000" />
      <path d="M17 17H47V39H17Z M32 17V27 M17 29H25" fill="none" stroke="#0D2B4A" strokeWidth="3.6" strokeLinecap="square" />
    </svg>
  );
}
