/** The halalfood.world mark: a warm pin holding a steaming bowl. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M16 30.5s-11-9.2-11-17.2A11 11 0 0 1 27 13.3c0 8-11 17.2-11 17.2z"
        fill="var(--brand)"
      />
      <path d="M9.2 13.2h13.6a6.8 6.8 0 0 1-13.6 0z" fill="#fff" />
      <path
        d="M13.3 10.4c0-1.2 1.2-1.2 1.2-2.6M17.5 10.4c0-1.2 1.2-1.2 1.2-2.6"
        stroke="#fff"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <BrandMark size={compact ? 30 : 34} />
      <span className={compact ? "logo-word is-compact" : "logo-word"}>
        halalfood<span>.world</span>
      </span>
    </span>
  );
}
