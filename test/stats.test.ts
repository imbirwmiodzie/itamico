import assert from "node:assert/strict";
import { test } from "node:test";
import { streak } from "../src/stats.js";

test("streak counts consecutive days ending today or yesterday", () => {
  assert.equal(streak(["2026-10-04", "2026-10-03", "2026-10-02", "2026-09-30"], "2026-10-04"), 3);
  assert.equal(streak(["2026-10-03", "2026-10-02"], "2026-10-04"), 2, "today not practised yet keeps the streak");
  assert.equal(streak(["2026-10-02"], "2026-10-04"), 0);
  assert.equal(streak([], "2026-10-04"), 0);
  assert.equal(streak(["2026-03-01", "2026-02-28"], "2026-03-01"), 2, "month boundary");
});
