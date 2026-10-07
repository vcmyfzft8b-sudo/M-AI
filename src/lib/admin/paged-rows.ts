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
 * comes back short. The query must have a total order -- order by the column
 * and then by `id` -- or rows can repeat or go missing between pages.
 */
export async function loadEveryRow<T>(
  loadPage: (from: number, to: number) => PromiseLike<RowPage<T>>,
  pageSize = ADMIN_ROWS_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}
