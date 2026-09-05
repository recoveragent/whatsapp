import { describe, expect, it } from "vitest";
import {
  resolveDealCardLabel,
  resolveDealCardSubtitle,
  resolveDealInsertTitle,
  suggestDealTitle,
  titleMatchesStageName,
} from "./display";

describe("deals/display", () => {
  it("prefers contact name on pipeline cards", () => {
    expect(
      resolveDealCardLabel({
        title: "New Lead",
        contact: { name: "Shobhit Kumar", phone: "+911234" } as never,
      }),
    ).toBe("Shobhit Kumar");
  });

  it("hides redundant subtitles", () => {
    const deal = {
      title: "New Lead",
      contact: { name: "Shobhit Kumar", phone: "+911234" } as never,
    };
    const label = resolveDealCardLabel(deal);
    expect(
      resolveDealCardSubtitle(deal, { name: "New Lead" }, label),
    ).toBeNull();
  });

  it("keeps meaningful subtitles", () => {
    const deal = {
      title: "Demo booked",
      contact: { name: "Imtiaz khan", phone: "+911234" } as never,
    };
    const label = resolveDealCardLabel(deal);
    expect(
      resolveDealCardSubtitle(deal, { name: "Junk" }, label),
    ).toBe("Demo booked");
  });

  it("suggests contact title when current title matches a stage", () => {
    expect(
      suggestDealTitle(
        { name: "cosmo", phone: "+911234" },
        "New Lead",
        [{ name: "New Lead" }],
      ),
    ).toBe("cosmo");
  });

  it("detects stage-name titles", () => {
    expect(titleMatchesStageName(" demo booked ", [{ name: "Demo booked" }])).toBe(
      true,
    );
  });

  it("falls back to contact name when inserting deals", () => {
    expect(
      resolveDealInsertTitle({
        configuredTitle: "New Lead",
        contact: { name: "Anuj Yadav", phone: "+911234" },
        stageName: "New Lead",
      }),
    ).toBe("Anuj Yadav");
  });
});
