"use client";

import { Checkbox } from "@halalfood/ui/components/checkbox";
import { Field, FieldLabel } from "@halalfood/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@halalfood/ui/components/select";
import { Toggle } from "@halalfood/ui/components/toggle";
import { ToggleGroup, ToggleGroupItem } from "@halalfood/ui/components/toggle-group";
import { cn } from "@halalfood/ui/lib/utils";

/** A labelled shadcn Select over a fixed list of options. */
export function SelectField<Value extends string>({
  id,
  label,
  value,
  onValueChange,
  options,
  className,
}: {
  id: string;
  label: React.ReactNode;
  value: Value;
  onValueChange: (value: Value) => void;
  options: readonly { value: Value; label: React.ReactNode }[];
  className?: string;
}) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={(next) => onValueChange(next as Value)}>
        <SelectTrigger id={id} className={cn("w-full")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * Pill-shaped single-choice chips. With `allowNone`, tapping the selected chip
 * clears it.
 */
export function ChoiceChips<Value extends string>({
  label,
  value,
  onValueChange,
  options,
  allowNone = false,
  className,
}: {
  label: string;
  value: Value | null | undefined;
  onValueChange: (value: Value | null) => void;
  options: readonly { value: Value; label: React.ReactNode }[];
  allowNone?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={2}
      aria-label={label}
      className={cn("flex-wrap", className)}
      value={value ?? ""}
      onValueChange={(next) => {
        if (next) onValueChange(next as Value);
        else if (allowNone) onValueChange(null);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-9 rounded-full! px-3.5 font-semibold data-[state=on]:border-foreground data-[state=on]:bg-secondary"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A checkbox with its label to the right. */
export function CheckboxField({
  id,
  checked,
  onCheckedChange,
  children,
  className,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Field orientation="horizontal" className={className}>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <FieldLabel htmlFor={id} className="leading-snug font-normal">
        {children}
      </FieldLabel>
    </Field>
  );
}

/** A pill that toggles on and off on its own (for multi-select filters). */
export function ToggleChip({
  pressed,
  onPressedChange,
  className,
  children,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "h-9 shrink-0 rounded-full px-3.5 font-semibold data-[state=on]:border-foreground data-[state=on]:bg-secondary",
        className,
      )}
    >
      {children}
    </Toggle>
  );
}
