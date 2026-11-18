import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  estimateTokenCostMicrosUsd,
  parseProductSearchFilters,
  ProductSearchInputError,
  reserveCostMicrosUsd,
  sanitizeProductSearchQuery,
} from "./product_search.ts";

Deno.test("product search removes contact and recognizable address details before prompting Gemini", () => {
  const query = sanitizeProductSearchQuery(
    "Need LED bulbs, flat 402 Sai Residency, Benz Circle 520010, call +91 98765 43210",
  );
  assertEquals(query, "Need LED bulbs");
  assertEquals(sanitizeProductSearchQuery("12 Main Street, Vijayawada 520010"), "");
});

Deno.test("standalone locality phrases fail closed before Gemini", () => {
  assertEquals(sanitizeProductSearchQuery("Benz Circle, Vijayawada"), "");
  assertEquals(sanitizeProductSearchQuery("Need waterproof tiles in Gandhi Nagar for a bathroom"), "Need waterproof tiles");
  assertEquals(sanitizeProductSearchQuery("12-3 MG Road, Vijayawada"), "");
  assertEquals(sanitizeProductSearchQuery("Vijayawada 520010"), "");
});

Deno.test("product search keeps product specifications that resemble short numbers", () => {
  assertEquals(sanitizeProductSearchQuery("12 inch LED tube, warm white"), "12 inch LED tube, warm white");
});

Deno.test("unknown category becomes null and output filters remain typed", () => {
  assertEquals(
    parseProductSearchFilters(
      { category_slug: "not-in-catalogue", query: "floor tiles", brand: "Acme", max_price_paise: 250000, in_stock_only: true },
      ["tiles", "electrical"],
    ),
    { category_slug: null, query: "floor tiles", brand: "Acme", max_price_paise: 250000, in_stock_only: true },
  );
});

Deno.test("malformed numeric or boolean filters are rejected", () => {
  assertThrows(
    () => parseProductSearchFilters({ category_slug: null, query: null, brand: null, max_price_paise: 2.5, in_stock_only: false }, []),
    ProductSearchInputError,
  );
  assertThrows(
    () => parseProductSearchFilters({ category_slug: null, query: null, brand: null, max_price_paise: null, in_stock_only: "yes" }, []),
    ProductSearchInputError,
  );
});

Deno.test("known Gemini models are costed in micros and unknown models fail closed", () => {
  assertEquals(estimateTokenCostMicrosUsd("gemini-3.8-flash", 100, 10, new Date("2026-11-17T00:00:00Z")), 113);
  assertEquals(estimateTokenCostMicrosUsd("gemini-3.8-flash", 100, 10, new Date("2027-01-01T00:00:00Z")), 225);
  assertEquals(estimateTokenCostMicrosUsd("unknown-model", 100, 10, new Date()), null);
  assertEquals(reserveCostMicrosUsd(["gemini-3.8-flash", "gemini-3.5-flash-lite"], 4096, 256, new Date("2026-11-17T00:00:00Z")) !== null, true);
});
