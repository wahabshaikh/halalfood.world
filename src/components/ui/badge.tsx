import * as React from "react";
import { cn } from "../../lib/utils";

export type BadgeVariant = "default" | "muted" | "accent" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  default: "ui-badge ui-badge-default",
  muted: "ui-badge ui-badge-muted",
  accent: "ui-badge ui-badge-accent",
  outline: "ui-badge ui-badge-outline",
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn(variantClass[variant], className)} {...props} />;
}