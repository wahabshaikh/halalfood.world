"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@halalfood/ui/components/badge";
import { Button } from "@halalfood/ui/components/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@halalfood/ui/components/field";
import { Input } from "@halalfood/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@halalfood/ui/components/sheet";
import { cn } from "@halalfood/ui/lib/utils";
import { ChipRow } from "../src/components/blocks";
import { ChoiceChips, ToggleChip } from "../src/components/form-fields";
import { TONE_TEXT } from "../src/components/status-tone";
import {
  FACT_FILTER_COPY,
  FACT_FILTER_KEYS,
  SORT_COPY,
  SORT_OPTIONS,
  STATUS_FILTER_ORDER,
  activeFilterCount,
  type DiscoveryFilters,
  type FactFilterKey,
  type SortOption,
} from "@halalfood/core/discovery-filters";
import { STATUS_COPY, type HalalTaxonomyStatus } from "@halalfood/core/halal-taxonomy";
import { MEALS, SERVICE_TYPES } from "@halalfood/core/place-facts";

/**
 * The filter surface: a chip row that always shows the halal statuses, plus a
 * sheet for the factual, food and practical filters.
 *
 * Halal status stays on the top level because it is the first question the
 * product answers. Not halal is a selectable status rather than a hidden one —
 * knowing a place is unsuitable is useful information, not something to bury.
 */

const PRICE_BANDS = [1, 2, 3, 4];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function ChipGroup<T extends string | number>({
  legend,
  options,
  selected,
  label,
  onToggle,
}: {
  legend: string;
  options: readonly T[];
  selected: readonly T[];
  label: (value: T) => string;
  onToggle: (value: T) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <ChipRow className="gap-2">
        {options.map((option) => (
          <ToggleChip
            key={String(option)}
            pressed={selected.includes(option)}
            onPressedChange={() => onToggle(option)}
          >
            {label(option)}
          </ToggleChip>
        ))}
      </ChipRow>
    </FieldSet>
  );
}

/** "take-away" → "Take away". */
function sentence(value: string) {
  const words = value.replace(/-/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

const NOTE = "text-[13px] text-muted-foreground";

export default function MapFilters({
  filters,
  onChange,
  mobile = false,
}: {
  filters: DiscoveryFilters;
  onChange: (filters: DiscoveryFilters) => void;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(filters);

  const set = (patch: Partial<DiscoveryFilters>) => onChange({ ...filters, ...patch });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex gap-2",
          mobile ? "overflow-x-auto px-4.5 pb-3 [scrollbar-width:none]" : "flex-wrap py-1",
        )}
        aria-label="Filter halal places"
      >
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 shrink-0 rounded-full px-3.5 font-semibold",
              count > 0 && "border-foreground bg-secondary",
            )}
          >
            <HugeiconsIcon icon={FilterHorizontalIcon} size={14} aria-hidden="true" />
            Filters
            {count > 0 && (
              <Badge className="h-5 min-w-5 rounded-full bg-foreground px-1.5 text-background">
                {count}
              </Badge>
            )}
          </Button>
        </SheetTrigger>
        <ToggleChip
          pressed={filters.applyMyStandards}
          onPressedChange={() => set({ applyMyStandards: !filters.applyMyStandards })}
        >
          My standards
        </ToggleChip>
        {STATUS_FILTER_ORDER.map((status) => (
          <ToggleChip
            key={status}
            className={TONE_TEXT[STATUS_COPY[status].tone]}
            pressed={filters.statuses.includes(status)}
            onPressedChange={() => set({ statuses: toggle(filters.statuses, status) })}
          >
            {STATUS_COPY[status].label}
          </ToggleChip>
        ))}
      </div>

      <SheetContent side={mobile ? "bottom" : "right"} className="max-h-[90vh] gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg font-extrabold">Filters</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 content-start gap-6 overflow-y-auto p-4">
          <FieldSet>
            <FieldLegend variant="label">Sort by</FieldLegend>
            <ChoiceChips
              label="Sort by"
              value={filters.sort}
              onValueChange={(option) => option && set({ sort: option as SortOption })}
              options={SORT_OPTIONS.map((option) => ({ value: option, label: SORT_COPY[option] }))}
            />
            <p className={NOTE}>
              No restaurant can pay to move up this list. Sorting only ever
              reflects evidence, dining signal and distance.
            </p>
          </FieldSet>

          <ChipGroup
            legend="Halal status"
            options={STATUS_FILTER_ORDER}
            selected={filters.statuses}
            label={(status: HalalTaxonomyStatus) => STATUS_COPY[status].label}
            onToggle={(status) => set({ statuses: toggle(filters.statuses, status) })}
          />

          <div className="grid gap-2">
            <ChipGroup
              legend="Facts"
              options={FACT_FILTER_KEYS}
              selected={filters.facts}
              label={(key: FactFilterKey) => FACT_FILTER_COPY[key]}
              onToggle={(key) => set({ facts: toggle(filters.facts, key) })}
            />
            <p className={NOTE}>
              A fact filter only matches places where the fact is recorded. A
              place with an unknown answer is left out rather than assumed.
            </p>
          </div>

          <Field>
            <FieldLabel htmlFor="filter-dish">Dish</FieldLabel>
            <Input
              id="filter-dish"
              value={filters.dish ?? ""}
              placeholder="biryani, kunafa, shawarma…"
              onChange={(event) => set({ dish: event.target.value.trim() || null })}
            />
          </Field>

          <ChipGroup
            legend="Price"
            options={PRICE_BANDS}
            selected={filters.priceBands}
            label={(band: number) => "$".repeat(band)}
            onToggle={(band) => set({ priceBands: toggle(filters.priceBands, band) })}
          />

          <ChipGroup
            legend="Service"
            options={SERVICE_TYPES}
            selected={filters.serviceTypes}
            label={sentence}
            onToggle={(value) => set({ serviceTypes: toggle(filters.serviceTypes, value) })}
          />

          <ChipGroup
            legend="Meal"
            options={MEALS}
            selected={filters.meals}
            label={sentence}
            onToggle={(value) => set({ meals: toggle(filters.meals, value) })}
          />

          <FieldSet>
            <FieldLegend variant="label">Distance</FieldLegend>
            <ChoiceChips
              label="Distance"
              allowNone
              value={filters.maxDistanceKm === null ? null : String(filters.maxDistanceKm)}
              onValueChange={(km) => set({ maxDistanceKm: km === null ? null : Number(km) })}
              options={["1", "2", "5", "10"].map((km) => ({ value: km, label: `Within ${km} km` }))}
            />
          </FieldSet>
        </div>

        <SheetFooter className="flex-row justify-between border-t">
          <Button
            variant="ghost"
            className="font-bold underline"
            onClick={() =>
              onChange({
                ...filters,
                statuses: [],
                facts: [],
                cuisines: [],
                dish: null,
                priceBands: [],
                serviceTypes: [],
                meals: [],
                openNow: false,
                maxDistanceKm: null,
                sort: "recommended",
                applyMyStandards: false,
              })
            }
          >
            Clear all
          </Button>
          <Button size="xl" onClick={() => setOpen(false)}>
            Show results{count ? ` (${count})` : ""}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
