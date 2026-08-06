import assert from "node:assert/strict";
import test from "node:test";

import { ALL_CAMPAIGN_MISSIONS } from "../src/data.js";
import { getVisibleCampaignNames } from "../src/validation.js";

test("campaign visibility without Ouroboros is limited to C1-C3 missions 1-8", () => {
  const expected = [1, 2, 3].flatMap(campaign =>
    Array.from({ length: 8 }, (_, index) => `C${campaign}-${index + 1}`)
  );

  assert.deepEqual(getVisibleCampaignNames(false), expected);
});

test("campaign visibility with Ouroboros includes every campaign", () => {
  assert.deepEqual(getVisibleCampaignNames(true), ALL_CAMPAIGN_MISSIONS);
});
