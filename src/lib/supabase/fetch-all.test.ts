import { describe, expect, it } from "vitest";

import { fetchAllInChunks, fetchAllPages } from "./fetch-all";

/** A fake table that truncates every response at `cap` rows, like PostgREST's max-rows. */
function cappedTable(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: { from: number; to: number }[] = [];
  const query = (from: number, to: number) => {
    calls.push({ from, to });
    const end = Math.min(to + 1, from + cap);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { query, calls };
}

describe("fetchAllPages", () => {
  it("returns every row past the 1 000-row server cap", async () => {
    const { query } = cappedTable(2_345, 1_000);
    const rows = await fetchAllPages(query);
    expect(rows).toHaveLength(2_345);
    expect(rows.at(-1)).toEqual({ id: 2_344 });
  });

  it("doesn't stop early or skip rows when the server cap is below the page size", async () => {
    const { query } = cappedTable(1_220, 500);
    const rows = await fetchAllPages(query, 1_000);
    expect(rows.map((r) => r.id)).toEqual(
      Array.from({ length: 1_220 }, (_, i) => i),
    );
  });

  it("handles an empty table with a single request", async () => {
    const { query, calls } = cappedTable(0, 1_000);
    expect(await fetchAllPages(query)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("throws on a query error instead of returning a partial list", async () => {
    await expect(
      fetchAllPages(() =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
      ),
    ).rejects.toThrow("boom");
  });
});

describe("fetchAllInChunks", () => {
  it("splits the .in() values and pages each chunk", async () => {
    const ids = Array.from({ length: 702 }, (_, i) => `id-${i}`);
    const chunkSizes: number[] = [];

    const rows = await fetchAllInChunks(ids, (chunk, from, to) => {
      if (from === 0) chunkSizes.push(chunk.length);
      return Promise.resolve({
        data: chunk.slice(from, to + 1).map((id) => ({ id })),
        error: null,
      });
    });

    expect(chunkSizes).toEqual([150, 150, 150, 150, 102]);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it("makes no requests for an empty list", async () => {
    let called = false;
    await fetchAllInChunks([], () => {
      called = true;
      return Promise.resolve({ data: [], error: null });
    });
    expect(called).toBe(false);
  });
});
