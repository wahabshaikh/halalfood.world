import { cn } from "@halalfood/ui/lib/utils";

const TINTS = [
  "#E7B48A",
  "#D7956A",
  "#EBCDAA",
  "#C98457",
  "#F0D5B6",
  "#D6A47C",
  "#E4A983",
  "#F2C79D",
];

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1)
    result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

export function placeInitials(name: string) {
  // Skip words like "&" so "Pomegranate & Coal" reads "PC", not "P&".
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "HF";
}

/**
 * Listings rarely have photos yet, so every place gets a warm, stable
 * placeholder: a tint chosen from its id, a plate and its initials.
 */
export function PlacePhoto({
  seed,
  name,
  className,
}: {
  seed: string;
  name: string;
  className?: string;
}) {
  const tint = TINTS[hash(seed) % TINTS.length];
  return (
    <div
      className={cn(
        "relative flex aspect-[1/0.95] w-full items-center justify-center overflow-hidden rounded-2xl",
        className,
      )}
      style={{ background: tint }}
      aria-hidden="true"
    >
      <svg
        className="w-1/3 max-w-24"
        viewBox="0 0 48 48"
        fill="none"
        stroke="#8A5533"
        strokeWidth="1.6"
      >
        <ellipse cx="24" cy="30" rx="18" ry="6" />
        <path d="M8 29c1-9 7.5-15 16-15s15 6 16 15" />
        <path d="M24 10v4M18 20c1.5-1.5 3.5-2.5 6-2.5" />
      </svg>
      <span className="absolute bottom-2.5 left-3 text-xs font-black tracking-widest text-[#5a3620]">{placeInitials(name)}</span>
    </div>
  );
}
