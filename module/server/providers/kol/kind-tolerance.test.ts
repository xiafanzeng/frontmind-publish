import { describe, expect, it } from "vitest";
import { normalizeKolMediaKind, normalizeResource } from "./normalize.js";
import { kolResourcePageSchema } from "./schemas.js";

describe("KOL third media category (is_zimeiti=3) tolerance", () => {
  it("parses a catalog page that contains an is_zimeiti=3 row", () => {
    const body = {
      success: true,
      status: 200,
      pagination: {
        current_page: 511,
        last_page: 1857,
        per_page: 50,
        total: 92850,
      },
      data: [
        {
          id: 120944,
          name: "品牌测评官",
          platform: "其他门户",
          price: 17.5,
          is_zimeiti: 3,
        },
        { id: 120945, name: "普通新闻媒体", price: "100", is_zimeiti: 2 },
      ],
    };
    const parsed = kolResourcePageSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("maps category 3 to the non-sellable unknown kind", () => {
    expect(normalizeKolMediaKind(3)).toBe("unknown");
    expect(normalizeKolMediaKind("3")).toBe("unknown");
    expect(() => normalizeKolMediaKind(4)).toThrow(TypeError);
  });

  it("normalizes a category-3 resource without throwing", () => {
    const resource = normalizeResource({
      id: 120944,
      name: "品牌测评官",
      is_zimeiti: 3,
      price: 17.5,
    });
    expect(resource.kind).toBe("unknown");
    expect(resource.isSelfMedia).toBe(false);
  });
});
