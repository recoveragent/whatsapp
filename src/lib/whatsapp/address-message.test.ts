import { describe, expect, it } from "vitest";
import {
  addressReplyToFlowVar,
  formatAddressValues,
  parseAddressNfmReply,
} from "./address-message";

describe("parseAddressNfmReply", () => {
  it("parses a Cloud API nfm_reply with string response_json", () => {
    const parsed = parseAddressNfmReply({
      type: "nfm_reply",
      nfm_reply: {
        name: "address_message",
        body: "Devi Salim\n+913850881995\nMumbai",
        response_json: JSON.stringify({
          saved_address_id: "address1",
          values: {
            name: "Devi Salim",
            city: "Mumbai",
            in_pin_code: "400064",
          },
        }),
      },
    });
    expect(parsed).toEqual({
      formatted: "Devi Salim\n+913850881995\nMumbai",
      values: {
        name: "Devi Salim",
        city: "Mumbai",
        in_pin_code: "400064",
      },
      saved_address_id: "address1",
    });
  });

  it("parses object response_json and formats when body is missing", () => {
    const parsed = parseAddressNfmReply({
      type: "nfm_reply",
      nfm_reply: {
        name: "address_message",
        response_json: {
          values: {
            name: "Alex",
            city: "Singapore",
            sg_post_code: "018937",
          },
        },
      },
    });
    expect(parsed?.values.city).toBe("Singapore");
    expect(parsed?.formatted).toContain("Alex");
    expect(parsed?.formatted).toContain("Singapore");
  });

  it("returns null for non-address nfm replies", () => {
    expect(
      parseAddressNfmReply({
        type: "nfm_reply",
        nfm_reply: {
          name: "flow",
          response_json: "{}",
        },
      }),
    ).toBeNull();
  });
});

describe("formatAddressValues", () => {
  it("joins known fields into a readable block", () => {
    expect(
      formatAddressValues({
        name: "Sam",
        phone_number: "+6599999999",
        address: "Marina One",
        city: "Singapore",
      }),
    ).toBe("Sam\n+6599999999\nMarina One, Singapore");
  });
});

describe("addressReplyToFlowVar", () => {
  it("flattens formatted + values for flow_runs.vars", () => {
    expect(
      addressReplyToFlowVar({
        formatted: "line",
        values: { city: "Delhi" },
        saved_address_id: "a1",
      }),
    ).toEqual({
      formatted: "line",
      city: "Delhi",
      saved_address_id: "a1",
    });
  });
});
