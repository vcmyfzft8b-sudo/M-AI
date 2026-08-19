"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * The filter row above the chart.
 *
 * Each control writes its value into the query string and navigates, so the
 * whole view — filters, chart metric, range — is shareable and survives a
 * reload. Selecting a filter resets pagination, which would otherwise leave the
 * table on a page that no longer exists.
 */

export type FilterOption = { value: string; label: string };

export type FilterDef = {
  /** Query-string key. */
  name: string;
  /** Shown as the "all" option. */
  allLabel: string;
  options: FilterOption[];
};

export function FilterBar({
  filters,
  children,
}: {
  filters: FilterDef[];
  /** Extra controls rendered at the end of the row. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function update(name: string, value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");

    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }

    params.delete("page");

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="admin-filters" data-pending={isPending}>
      {filters.map((filter) => {
        const current = searchParams?.get(filter.name) ?? "";

        return (
          <label
            className="admin-filter"
            key={filter.name}
            data-set={current !== ""}
          >
            <span className="sr-only">{filter.allLabel}</span>
            <select
              value={current}
              aria-label={filter.allLabel}
              onChange={(event) => update(filter.name, event.target.value)}
            >
              <option value="">{filter.allLabel}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {children}
    </div>
  );
}
