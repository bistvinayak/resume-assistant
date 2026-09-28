// Arjun logo: the archer's bullseye-and-arrow mark (same as the Chrome extension icon) plus the wordmark.
export default function Brand({ size = 18 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.4) }}>
      <img src={`${import.meta.env.BASE_URL}arjun-icon.png`} alt="" width={Math.round(size * 1.35)} height={Math.round(size * 1.35)} />
      <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: `${size}px`, color: '#1c1917' }}>
        arjun<span style={{ color: '#f59e0b' }}>.</span>
      </span>
    </span>
  );
}
