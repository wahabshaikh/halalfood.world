import { HugeiconsIcon } from "@hugeicons/react";
import { SentIcon } from "@hugeicons/core-free-icons";
import { Button } from "@halalfood/ui/components/button";

/**
 * "Send" opens the recs composer for a place, a list, or a friend. It is a
 * plain link, so it works without JavaScript, and sign-in is asked for on the
 * composer rather than here.
 */
export function SendRecLink({
  place,
  list,
  to,
  label = "Send",
  variant = "ghost",
  className,
}: {
  place?: string;
  list?: string;
  to?: string;
  label?: string;
  variant?: "ghost" | "outline" | "secondary";
  className?: string;
}) {
  const params = new URLSearchParams();
  if (place) params.set("place", place);
  else if (list) params.set("list", list);
  if (to) params.set("to", to);
  const query = params.toString();
  return (
    <Button asChild variant={variant} className={className}>
      <a href={`/send${query ? `?${query}` : ""}`}>
        <HugeiconsIcon icon={SentIcon} size={18} aria-hidden="true" />
        {label}
      </a>
    </Button>
  );
}
