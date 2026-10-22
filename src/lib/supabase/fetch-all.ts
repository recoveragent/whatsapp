// ============================================================
// Read every row of a PostgREST query, not just the first page.
//
// Supabase caps each response at the project's "max rows" setting
// (1 000 by default) and truncates SILENTLY — no error, no flag. A
// broadcast audience resolved with one plain `.select()` therefore
// dropped everyone past row 1 000 without telling anyone.
//
// Long `.in()` filters fail the other way: the ids go in the URL, so a
// few hundred UUIDs produce a request the gateway rejects as too long.
// `fetchAllInChunks` splits the id list and pages each chunk.
// ============================================================

/** Rows requested per page. The server may return fewer (its cap). */
export const FETCH_PAGE_SIZE = 1000;

/** Values per `.in()` filter — ~150 UUIDs keeps the URL around 6 KB. */
export const IN_CHUNK_SIZE = 150;

type PageQuery<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * Run `build(from, to)` page by page until a page comes back empty.
 *
 * `build` must apply a stable `.order()` (e.g. on `id`) before
 * `.range(from, to)`, or rows can shift between pages.
 *
 * Termination is on an EMPTY page, and `from` advances by the rows
 * actually returned — so a server cap smaller than `pageSize` can't
 * end the loop early or skip rows.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PageQuery<T>,
  pageSize: number = FETCH_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    from += data.length;
  }

  return rows;
}

/**
 * `fetchAllPages` over an `.in()` filter, split into chunks of
 * `chunkSize` values. `build(chunk, from, to)` applies the chunk as
 * the `.in()` filter, plus the order + range as above.
 */
export async function fetchAllInChunks<T, V = string>(
  values: readonly V[],
  build: (chunk: V[], from: number, to: number) => PageQuery<T>,
  chunkSize: number = IN_CHUNK_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    rows.push(...(await fetchAllPages((from, to) => build(chunk, from, to))));
  }
  return rows;
}
