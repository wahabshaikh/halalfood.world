import * as React from "react";
import { cn } from "../../lib/utils";

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  default: "ui-button ui-button-default",
  secondary: "ui-button ui-button-secondary",
  outline: "ui-button ui-button-outline",
  ghost: "ui-button ui-button-ghost",
  danger: "ui-button ui-button-danger",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "ui-button-default-size",
  sm: "ui-button-sm",
  lg: "ui-button-lg",
  icon: "ui-button-icon",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(variantClass[variant], sizeClass[size], className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";