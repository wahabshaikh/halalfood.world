"use client";

/** A plain select that reloads the board for another city. */
export function CityPicker({ value, period, cities }: { value: string; period: string; cities: { slug: string; name: string }[] }) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-full border border-input px-4">
      <span className="sr-only">City</span>
      <select
        value={value}
        onChange={(event) => window.location.assign(`/community?city=${event.target.value}&period=${period}`)}
        className="bg-transparent text-[15px] font-extrabold outline-none"
      >
        {cities.map((city) => (
          <option key={city.slug} value={city.slug}>
            {city.name}
          </option>
        ))}
      </select>
    </label>
  );
}
