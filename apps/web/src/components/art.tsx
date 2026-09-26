/**
 * Flat, warm illustrations used for tabs, empty states and promos. They are
 * decorative, so every one is hidden from assistive technology.
 */
export type IllustrationName =
  | "eat"
  | "creators"
  | "shops"
  | "visits"
  | "vouches"
  | "cup"
  | "photo"
  | "link"
  | "map";

function Paths({ name }: { name: IllustrationName }) {
  switch (name) {
    case "eat":
      return (
        <>
          <ellipse cx="20" cy="30" rx="15" ry="4" fill="#E8D9C7" />
          <circle cx="20" cy="21" r="13" fill="#fff" stroke="#E8D9C7" strokeWidth="2" />
          <circle cx="20" cy="21" r="8.5" fill="#F2B33D" />
          <path d="M14 20c2-3 5-4 9-2" stroke="#E4572E" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="17" cy="23.5" r="1.8" fill="#6BAF5B" />
          <circle cx="23" cy="23" r="1.6" fill="#6BAF5B" />
        </>
      );
    case "creators":
      return (
        <>
          <rect x="11" y="5" width="18" height="30" rx="4" fill="#3A3A3A" />
          <rect x="13" y="8" width="14" height="22" rx="2" fill="#F7C873" />
          <path d="M18 15.5l5 3-5 3z" fill="#fff" />
          <path d="M29 9c2.5-2.5 6 .5 3.5 3.5L29 16l-3.5-3.5C23 9.5 26.5 6.5 29 9z" fill="#E86A58" />
        </>
      );
    case "shops":
      return (
        <>
          <rect x="7" y="16" width="26" height="18" rx="2" fill="#F6DDBB" />
          <path d="M5 10h30l-2 7H7z" fill="#E4572E" />
          <path d="M11 10l-1.5 7M17 10l-.5 7M23 10l.5 7M29 10l1.5 7" stroke="#fff" strokeWidth="2.4" />
          <rect x="16" y="23" width="8" height="11" rx="1" fill="#9C6B45" />
          <rect x="9" y="21" width="5" height="5" rx="1" fill="#fff" />
          <rect x="26" y="21" width="5" height="5" rx="1" fill="#fff" />
        </>
      );
    case "visits":
      return (
        <>
          <ellipse cx="20" cy="32" rx="14" ry="3.5" fill="#E8D9C7" />
          <path d="M6 19h28a14 11 0 0 1-28 0z" fill="#E4572E" />
          <path d="M6 19h28" stroke="#C9461D" strokeWidth="2" />
          <path d="M15 14c0-2.5 2.5-2.5 2.5-5M22 14c0-2.5 2.5-2.5 2.5-5" stroke="#C9B9A6" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </>
      );
    case "vouches":
      return (
        <>
          <rect x="7" y="8" width="24" height="26" rx="4" fill="#fff" stroke="#E8D9C7" strokeWidth="2" />
          <path d="M12 16h14M12 21h10" stroke="#E8D9C7" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="28" cy="28" r="8" fill="#F2B33D" />
          <path d="M24.5 28l2.4 2.4 4.6-4.8" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case "cup":
      return (
        <>
          <path d="M12 7h16v8a8 8 0 0 1-16 0z" fill="#F2B33D" />
          <path d="M12 9H7a5 5 0 0 0 5 6M28 9h5a5 5 0 0 1-5 6" stroke="#F2B33D" strokeWidth="2.4" fill="none" />
          <rect x="17" y="22" width="6" height="6" fill="#D99A1F" />
          <rect x="12" y="28" width="16" height="5" rx="2" fill="#9C6B45" />
        </>
      );
    case "photo":
      return (
        <>
          <rect x="6" y="10" width="28" height="22" rx="4" fill="#3A3A3A" />
          <rect x="14" y="7" width="12" height="5" rx="2" fill="#3A3A3A" />
          <circle cx="20" cy="21" r="7" fill="#F7C873" />
          <circle cx="20" cy="21" r="3.5" fill="#E4572E" />
        </>
      );
    case "link":
      return (
        <>
          <rect x="5" y="9" width="30" height="22" rx="5" fill="#fff" stroke="#E8D9C7" strokeWidth="2" />
          <path d="M16 23a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M24 17a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" stroke="#E4572E" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </>
      );
    case "map":
      return (
        <>
          <path d="M5 10l9-3 12 3 9-3v23l-9 3-12-3-9 3z" fill="#DCE7D3" />
          <path d="M14 7v23M26 10v23" stroke="#C3D3B6" strokeWidth="2" />
          <path d="M20 26s-6-5-6-9.5a6 6 0 0 1 12 0C26 21 20 26 20 26z" fill="#E4572E" />
          <circle cx="20" cy="16.5" r="2.2" fill="#fff" />
        </>
      );
  }
}

export function Illustration({
  name,
  size = 40,
  className,
}: {
  name: IllustrationName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <Paths name={name} />
    </svg>
  );
}

const LEAVES = Array.from({ length: 6 }, (_, index) => {
  const angle = ((200 + (index / 5) * 110) * Math.PI) / 180;
  const x = 18 + 15 * Math.cos(angle);
  const y = 24 - 17 * Math.sin(angle);
  const rotation = (angle * 180) / Math.PI + 90;
  return { x: x.toFixed(1), y: y.toFixed(1), rotation: rotation.toFixed(0) };
});

/** A honey laurel branch; pair a flipped one on the right. */
export function Laurel({ size = 40, flip = false }: { size?: number; flip?: boolean }) {
  return (
    <svg
      width={Math.round(size * 0.7)}
      height={size}
      viewBox="0 0 31 44"
      aria-hidden="true"
      focusable="false"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M18 42C4 36 0 20 6 4" stroke="#D99A1F" strokeWidth="1.8" fill="none" />
      {LEAVES.map((leaf, index) => (
        <ellipse
          key={index}
          cx={leaf.x}
          cy={leaf.y}
          rx="3"
          ry="6.5"
          transform={`rotate(${leaf.rotation} ${leaf.x} ${leaf.y})`}
          fill="#F2B33D"
        />
      ))}
    </svg>
  );
}
