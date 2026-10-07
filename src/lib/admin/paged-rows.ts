/**
 * PostgREST answers any select with at most `max_rows` rows (1000 on our
 * projects) and says nothing about the rest. An admin read that needs every row
 * in a window -- not a count, the rows themselves -- has to page for them.
 *
 * The signups chart on /admin/users once read profiles in one select: with
 * 5,737 signups since March it plotted an arbitrary 1,000 of them, leaving
 * weeks at zero and the busy days a fraction of their height.
 */
export const ADMIN_ROWS_PAGE_SIZE = 1000;

export type RowPage<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Calls `loadPage(from, to)` (inclusive, as `.range()` takes them) until a page
 * comes back empty. The query must have a total order -- order by the column
 * and then by `id` -- or rows can repeat or go missing between pages.
 *
 * It advances by the rows that actually came back and stops only on an empty
 * page, never on a short one: a short page cannot tell the end of the table
 * from a `max_rows` lower than the page size, and stopping there would bring
 * back the bug this exists to fix. The price is one empty request at the end.
 */
export async function loadEveryRow<T>(
  loadPage: (from: number, to: number) => PromiseLike<RowPage<T>>,
  pageSize = ADMIN_ROWS_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (;;) {
    const { data, error } = await loadPage(rows.length, rows.length + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return rows;
    }

    rows.push(...data);
  }
}
