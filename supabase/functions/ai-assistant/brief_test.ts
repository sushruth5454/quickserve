// Deterministic tests for the provider job brief: built from the whole conversation, never the last reply; the
// customer's own words (Hindi/Telugu) retained; no phone/address leakage; ≤ 600 chars.
import { assert, assertEquals, assertMatch, assertNotMatch } from "jsr:@std/assert@1";
import { BRIEF_MAX, buildJobBrief, groundedShare, isConfirmationOrTime, type JobBrief, renderBrief, weakSummary } from "./brief.ts";

const ok = (r: ReturnType<typeof buildJobBrief>): JobBrief => {
  if ("error" in r) throw new Error(`expected a brief, got error: ${r.error}`);
  return r.brief;
};

const acChat = ["My split AC is not cooling since 2 days", "The outdoor unit fan is not spinning. It's a Voltas, about 4 years old", "yes, tomorrow 10am"];
const acCtx = { customerTexts: acChat, lastUserText: "yes, tomorrow 10am", textsComplete: true, hasPhoto: false };

Deno.test("confirmation / time-only replies are recognised in en, hi, te, Hinglish, Tenglish", () => {
  for (const t of ["yes, tomorrow 10am", "ok", "Yes please book it", "tomorrow morning", "6-8 pm works", "haan kal subah 10 baje", "हाँ, कल सुबह 10 बजे", "సరే, రేపు ఉదయం 10 గంటలకు", "avunu repu udayam", "same guy"]) {
    assert(isConfirmationOrTime(t), t);
  }
  for (const t of ["AC not cooling", "मेरे किचन का नल लीक हो रहा है", "స్విచ్ బోర్డ్ నుండి స్పార్క్స్", "fan not working since morning", "tap leaking tomorrow"]) {
    assert(!isConfirmationOrTime(t), t);
  }
});

Deno.test("multi-turn: last message 'yes, tomorrow 10am' can never become the issue or the description", () => {
  // The model echoes the last reply: rejected so it rewrites from the whole conversation.
  for (const bad of ["yes, tomorrow 10am", "Yes tomorrow 10am", "", "ok", "Tomorrow at 10 am"]) {
    const r = buildJobBrief({ issue_summary: bad, customer_reported: "yes" }, acCtx);
    assert("error" in r, `accepted weak issue_summary "${bad}"`);
  }
  assert(weakSummary("yes, tomorrow 10am", "yes, tomorrow 10am"));

  // Good issue, but the report is the confirmation: repaired deterministically from the problem messages.
  const b = ok(buildJobBrief({ issue_summary: "Split AC not cooling; outdoor unit fan not spinning", customer_reported: "yes, tomorrow 10am", details: ["Voltas split AC, ~4 years old", "Not cooling for 2 days", "Tomorrow 10am"], likely_cause: "Outdoor fan motor or capacitor failure", likely_cause_confidence: "medium" }, acCtx));
  assertEquals(b.customer_reported, "My split AC is not cooling since 2 days · The outdoor unit fan is not spinning. It's a Voltas, about 4 years old");
  assertEquals(b.details, ["Voltas split AC, ~4 years old", "Not cooling for 2 days"]); // time preference dropped
  const text = renderBrief(b);
  assertMatch(text, /^Issue: Split AC not cooling; outdoor unit fan not spinning\n/);
  assertMatch(text, /Customer reported: "My split AC is not cooling/);
  assertMatch(text, /AI assessment \(to be confirmed on inspection, medium confidence\): Outdoor fan motor/);
  assertNotMatch(text, /tomorrow|10 ?am/i);
  assert(text.trim() !== "yes, tomorrow 10am");
});

Deno.test("customer's own words: Hindi and Telugu kept with English; ungrounded reports replaced", () => {
  const hi = ok(buildJobBrief(
    { issue_summary: "Kitchen tap leaking", customer_reported: "मेरे किचन का नल लीक हो रहा है", customer_reported_en: "My kitchen tap is leaking", details: ["Kitchen sink tap"] },
    { customerTexts: ["मेरे किचन का नल लीक हो रहा है", "हाँ, कल सुबह"], lastUserText: "हाँ, कल सुबह", textsComplete: true, hasPhoto: false },
  ));
  const hiText = renderBrief(hi);
  assertMatch(hiText, /Customer reported: "मेरे किचन का नल लीक हो रहा है"/);
  assertMatch(hiText, /In English: "My kitchen tap is leaking"/);

  const te = ok(buildJobBrief(
    { issue_summary: "Power cut at home; sparks from switch board", customer_reported: "ఇంట్లో కరెంట్ పోయింది, స్విచ్ బోర్డ్ నుండి స్పార్క్స్ వస్తున్నాయి", customer_reported_en: "Power went off at home; sparks are coming from the switch board" },
    { customerTexts: ["ఇంట్లో కరెంట్ పోయింది, స్విచ్ బోర్డ్ నుండి స్పార్క్స్ వస్తున్నాయి", "సరే"], lastUserText: "సరే", textsComplete: true, hasPhoto: false },
  ));
  assertMatch(renderBrief(te), /స్విచ్ బోర్డ్/);
  assertMatch(renderBrief(te), /In English: "Power went off/);

  // English reports get no duplicate English line.
  assertEquals(ok(buildJobBrief({ issue_summary: "AC not cooling", customer_reported: "My split AC is not cooling", customer_reported_en: "My split AC is not cooling" }, acCtx)).customer_reported_en, null);

  // A "report" the customer never wrote (invented symptoms) is replaced by their real words.
  const invented = ok(buildJobBrief({ issue_summary: "AC gas leak", customer_reported: "Hissing sound and ice on the copper pipe, gas smell" }, acCtx));
  assertMatch(invented.customer_reported, /^My split AC is not cooling/);
  assert(groundedShare("split AC not cooling", acChat) === 1);
});

Deno.test("no phone / address / PIN leakage anywhere in the brief", () => {
  const ctx = {
    customerTexts: ["Geyser not heating, call me on 98480 12345, flat 402 Sai Residency, Benz Circle 520010", "ok 6pm"],
    lastUserText: "ok 6pm",
    textsComplete: true,
    hasPhoto: true,
  };
  const b = ok(buildJobBrief({
    issue_summary: "Geyser not heating (flat 402)",
    customer_reported: "Geyser not heating, call me on 98480 12345, flat 402 Sai Residency, Benz Circle 520010",
    details: ["Flat 402, Sai Residency", "Contact +91 98480 12345", "Bathroom geyser", "Door no. 12-3-45"],
  }, ctx));
  const text = renderBrief(b);
  assertNotMatch(text, /98480|12345|402|520010|12-3-45|Sai Residency/);
  assertEquals(b.details, ["Bathroom geyser", "Customer shared a photo in the QuickServe chat"]);
});

Deno.test("raw voice turn: the model's report is accepted (server cannot see the words yet); empty conversations are refused", () => {
  const voice = ok(buildJobBrief({ issue_summary: "Ceiling fan not working", customer_reported: "పంకా తిరగడం లేదు", customer_reported_en: "The fan is not turning" }, { customerTexts: [], lastUserText: "", textsComplete: false, hasPhoto: false }));
  assertEquals(voice.customer_reported, "పంకా తిరగడం లేదు");
  const r = buildJobBrief({ issue_summary: "Ceiling fan not working", customer_reported: "yes" }, { customerTexts: ["yes", "tomorrow"], lastUserText: "tomorrow", textsComplete: true, hasPhoto: false });
  assert("error" in r);
});

Deno.test("rendered brief stays within 600 chars; AI assessment and extra details are dropped first", () => {
  const long: JobBrief = {
    issue_summary: "Washing machine not draining; error E21 on display",
    customer_reported: "Machine stops mid cycle and water stays inside. ".repeat(5).trim(),
    customer_reported_en: null,
    details: Array.from({ length: 5 }, (_, i) => `Detail ${i + 1}: ${"x".repeat(80)}`),
    likely_cause: "Blocked drain pump filter or failed drain pump",
    likely_cause_confidence: "medium",
  };
  const text = renderBrief(long);
  assert(text.length <= BRIEF_MAX, `${text.length}`);
  assertMatch(text, /^Issue: Washing machine not draining/);
  assertMatch(text, /Customer reported:/);
  assertNotMatch(text, /AI assessment/);
  const short = renderBrief({ ...long, details: ["LG front load, 3 years old"] });
  assertMatch(short, /AI assessment \(to be confirmed on inspection, medium confidence\)/);
  assertMatch(short, /Details:\n- LG front load, 3 years old/);
});
