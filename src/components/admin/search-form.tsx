"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { startNavigation } from "./pending-link";

/**
 * The search box above a table.
 *
 * It was a plain GET form, which meant a full page load with no feedback at
 * all: on a slow connection the field simply sat there after Enter. Pushing the
 * URL through the router instead keeps the search shareable and reloadable, and
 * gives the button something to report while the server works.
 *
 * Every other query parameter is preserved so searching does not silently drop
 * the range or the plan filter, and `page` is cleared so the results do not
 * open on a page the new search does not have.
 */
export function SearchForm({
  name = "q",
  label,
  placeholder,
  defaultValue,
  width = "16rem",
}: {
  name?: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  width?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const value = new FormData(event.currentTarget).get(name);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const query = typeof value === "string" ? value.trim() : "";

    if (query) {
      params.set(name, query);
    } else {
      params.delete(name);
    }

    params.delete("page");

    startNavigation();
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{ display: "flex", gap: "0.5rem" }}
      data-pending={isPending || undefined}
    >
      <input
        className="admin-input"
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        style={{ width }}
        aria-label={label}
      />
      <button
        type="submit"
        className="admin-button"
        data-pending={isPending || undefined}
        disabled={isPending}
      >
        {isPending && (
          <Loader2 size={13} className="admin-spin" aria-hidden="true" />
        )}
        {isPending ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
