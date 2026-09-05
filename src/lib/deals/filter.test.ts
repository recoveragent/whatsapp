import { describe, expect, it } from "vitest";
import { filterPipelineDeals, hasActivePipelineDealFilters } from "./filter";
import type { Deal } from "@/types";

function makeDeal(overrides: Partial<Deal> & Pick<Deal, "id">): Deal {
  return {
    user_id: "u1",
    pipeline_id: "p1",
    stage_id: "s1",
    contact_id: "c1",
    title: "Deal",
    value: 0,
    created_at: "2026-03-01T10:00:00.000Z",
    ...overrides,
  } as Deal;
}

describe("filterPipelineDeals", () => {
  const deals = [
    makeDeal({
      id: "d1",
      title: "Enterprise plan",
      created_at: "2026-03-01T10:00:00.000Z",
      contact: {
        id: "c1",
        name: "Imtiaz khan",
        phone: "+919876543210",
        company: "Acme Corp",
      } as never,
    }),
    makeDeal({
      id: "d2",
      title: "Follow up",
      created_at: "2026-03-10T10:00:00.000Z",
      contact: {
        id: "c2",
        name: "cosmo",
        phone: "+911111111111",
      } as never,
    }),
  ];

  it("matches search across contact fields", () => {
    expect(filterPipelineDeals(deals, { search: "acme" })).toHaveLength(1);
    expect(filterPipelineDeals(deals, { search: "9876543210" })).toHaveLength(1);
    expect(filterPipelineDeals(deals, { search: "cosmo" })).toHaveLength(1);
  });

  it("filters by received date range", () => {
    expect(
      filterPipelineDeals(deals, {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-05",
        dateField: "received",
      }),
    ).toEqual([deals[0]]);
  });

  it("filters by updated date range", () => {
    const dealsWithUpdates = [
      makeDeal({
        id: "d1",
        created_at: "2026-01-01T10:00:00.000Z",
        updated_at: "2026-03-02T10:00:00.000Z",
      }),
      makeDeal({
        id: "d2",
        created_at: "2026-01-01T10:00:00.000Z",
        updated_at: "2026-03-12T10:00:00.000Z",
      }),
    ];

    expect(
      filterPipelineDeals(dealsWithUpdates, {
        dateFrom: "2026-03-01",
        dateTo: "2026-03-05",
        dateField: "updated",
      }),
    ).toEqual([dealsWithUpdates[0]]);
  });

  it("combines search and date filters", () => {
    expect(
      filterPipelineDeals(deals, {
        search: "cosmo",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-05",
      }),
    ).toEqual([]);
  });

  it("detects active filters", () => {
    expect(hasActivePipelineDealFilters({})).toBe(false);
    expect(hasActivePipelineDealFilters({ search: "test" })).toBe(true);
    expect(hasActivePipelineDealFilters({ dateFrom: "2026-03-01" })).toBe(true);
  });
});
