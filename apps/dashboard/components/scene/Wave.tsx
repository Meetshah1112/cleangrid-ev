/**
 * The soft white edge where a scene gives way to the page below it.
 *
 * Drawn as the top of the next section rather than the bottom of the picture, so the section it
 * introduces owns its own shape and the scene above can be any height.
 */
export function Wave({ tone = 'paper', flip = false }: { readonly tone?: 'paper' | 'mist' | 'forest'; readonly flip?: boolean }) {
  const fill = tone === 'mist' ? 'var(--mist)' : tone === 'forest' ? 'var(--forest-deep)' : 'var(--paper)';
  return (
    <svg
      className={`wave${flip ? ' is-flipped' : ''}`}
      viewBox="0 0 1440 90"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0,58 C220,18 420,14 640,40 C860,66 1080,78 1280,48 C1360,36 1410,30 1440,30 L1440,90 L0,90 Z" fill={fill} />
    </svg>
  );
}
