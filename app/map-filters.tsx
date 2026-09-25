"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
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
} from "../src/lib/discovery-filters";
import { STATUS_COPY, type HalalTaxonomyStatus } from "../src/lib/halal-taxonomy";
import { MEALS, SERVICE_TYPES } from "../src/lib/place-facts";

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
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      <div className="chip-row">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            className={`filter-chip${selected.includes(option) ? " is-active" : ""}`}
            aria-pressed={selected.includes(option)}
            onClick={() => onToggle(option)}
          >
            {label(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

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
    <>
      <div
        className={mobile ? "sheet-filter-row" : "filter-row"}
        aria-label="Filter halal places"
      >
        <button
          type="button"
          className={`filter-chip is-filters${count ? " is-active" : ""}`}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          Filters
          {count > 0 && <span className="filter-chip-count">{count}</span>}
        </button>
        <button
          type="button"
          className={`filter-chip${filters.applyMyStandards ? " is-active" : ""}`}
          aria-pressed={filters.applyMyStandards}
          onClick={() => set({ applyMyStandards: !filters.applyMyStandards })}
        >
          My standards
        </button>
        {STATUS_FILTER_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={`filter-chip status-chip tone-${STATUS_COPY[status].tone}${filters.statuses.includes(status) ? " is-active" : ""}`}
            aria-pressed={filters.statuses.includes(status)}
            onClick={() => set({ statuses: toggle(filters.statuses, status) })}
          >
            {STATUS_COPY[status].label}
          </button>
        ))}
      </div>

      {open && (
        <div className="filter-sheet-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="filter-sheet-head">
              <h2>Filters</h2>
              <button
                type="button"
                className="selected-preview-close"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="filter-sheet-body">
              <fieldset className="filter-group">
                <legend>Sort by</legend>
                <div className="chip-row">
                  {SORT_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`filter-chip${filters.sort === option ? " is-active" : ""}`}
                      aria-pressed={filters.sort === option}
                      onClick={() => set({ sort: option as SortOption })}
                    >
                      {SORT_COPY[option]}
                    </button>
                  ))}
                </div>
                <p className="filter-note">
                  No restaurant can pay to move up this list. Sorting only ever
                  reflects evidence, dining signal and distance.
                </p>
              </fieldset>

              <ChipGroup
                legend="Halal status"
                options={STATUS_FILTER_ORDER}
                selected={filters.statuses}
                label={(status: HalalTaxonomyStatus) => STATUS_COPY[status].label}
                onToggle={(status) => set({ statuses: toggle(filters.statuses, status) })}
              />

              <ChipGroup
                legend="Facts"
                options={FACT_FILTER_KEYS}
                selected={filters.facts}
                label={(key: FactFilterKey) => FACT_FILTER_COPY[key]}
                onToggle={(key) => set({ facts: toggle(filters.facts, key) })}
              />
              <p className="filter-note">
                A fact filter only matches places where the fact is recorded. A
                place with an unknown answer is left out rather than assumed.
              </p>

              <fieldset className="filter-group">
                <legend>Dish</legend>
                <input
                  className="ui-input"
                  value={filters.dish ?? ""}
                  placeholder="biryani, kunafa, shawarma…"
                  onChange={(event) => set({ dish: event.target.value.trim() || null })}
                />
              </fieldset>

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
                label={(value: string) => value.replace(/-/g, " ")}
                onToggle={(value) =>
                  set({ serviceTypes: toggle(filters.serviceTypes, value) })
                }
              />

              <ChipGroup
                legend="Meal"
                options={MEALS}
                selected={filters.meals}
                label={(value: string) => value.replace(/-/g, " ")}
                onToggle={(value) => set({ meals: toggle(filters.meals, value) })}
              />

              <fieldset className="filter-group">
                <legend>Distance</legend>
                <div className="chip-row">
                  {[1, 2, 5, 10].map((km) => (
                    <button
                      key={km}
                      type="button"
                      className={`filter-chip${filters.maxDistanceKm === km ? " is-active" : ""}`}
                      aria-pressed={filters.maxDistanceKm === km}
                      onClick={() =>
                        set({ maxDistanceKm: filters.maxDistanceKm === km ? null : km })
                      }
                    >
                      Within {km} km
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="filter-sheet-foot">
              <button
                type="button"
                className="ui-button ui-button-ghost"
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
              </button>
              <button
                type="button"
                className="ui-button ui-button-default"
                onClick={() => setOpen(false)}
              >
                Show results{count ? ` (${count})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
