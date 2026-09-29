import { Avatar, AvatarFallback, AvatarImage } from "@halalfood/ui/components/avatar";
import { monogram } from "./blocks";

/** A diner's photo, or their initials on a soft tint when they have none. */
export function PersonAvatar({
  name,
  avatarUrl,
  size = 44,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
}) {
  return (
    <Avatar aria-hidden="true" className="shrink-0 after:hidden" style={{ width: size, height: size }}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
      <AvatarFallback
        className="bg-[#F6C9B0] font-extrabold text-foreground"
        style={{ fontSize: Math.round(size / 3) }}
      >
        {monogram(name.replace(/^@/, "")) || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
