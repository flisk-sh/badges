import assert from "node:assert/strict";
import { test } from "node:test";
import { BELTS, beltFor, nextTier, rankName, rankValue, STARTER, TIERS, tierFor } from "../src/levels.mjs";

test("tiers start at 5, 15, 30, 50 and 100 merged PRs", () => {
  assert.equal(tierFor(1), STARTER);
  assert.equal(tierFor(4).name, "Contributor");
  assert.equal(tierFor(5).name, "Regular");
  assert.equal(tierFor(29).name, "Core");
  assert.equal(tierFor(100).name, "Legend");
  assert.equal(tierFor(400).name, "Legend");
  assert.equal(nextTier(4).name, "Regular");
  assert.equal(nextTier(15).name, "Veteran");
  assert.equal(nextTier(100), null);
});

test("dan ranks above every kyu, and 1 kyu above 8 kyu", () => {
  assert.ok(rankValue("rank: 1 dan") > rankValue("rank: 1 kyu"));
  assert.ok(rankValue("rank: 1 kyu") > rankValue("rank: 8 kyu"));
  assert.equal(rankValue("bug"), -1);
  assert.equal(rankName("rank: 3 kyu"), "3 kyu");
  assert.equal(rankName("bug"), null);
});

test("belts follow the kyu bands", () => {
  assert.equal(beltFor("rank: 8 kyu").name, "White");
  assert.equal(beltFor("rank: 7 kyu").name, "White");
  assert.equal(beltFor("rank: 6 kyu").name, "Green");
  assert.equal(beltFor("rank: 5 kyu").name, "Green");
  assert.equal(beltFor("rank: 4 kyu").name, "Brown");
  assert.equal(beltFor("rank: 1 kyu").name, "Brown");
  assert.equal(beltFor("rank: 2 dan").name, "Black");
  assert.equal(beltFor(""), null);
});

// The Discord roles in flisk-sh/flisk-cli come from the same numbers. If they change there,
// this fails, so the badge and the Discord role never disagree. Skipped when offline.
test("tiers and belts match flisk-sh/flisk-cli", async (t) => {
  const url = "https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/scripts/discord-contributor-levels.mjs";
  let source;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return t.skip(`${url} answered ${res.status}`);
    source = await res.text();
  } catch (error) {
    return t.skip(`offline: ${error.message}`);
  }
  const pick = (re) => [...source.matchAll(re)].map((m) => m.slice(1).join("|"));
  const tiers = pick(/\{ name: "(\w+)", role: "Flisk \w+", at: (\d+), color: "(\w+)" \}/g);
  const belts = pick(/\{ name: "(\w+)", role: "\w+ Belt", ranks: "([^"]+)", color: "(\w+)" \}/g);
  assert.deepEqual(tiers, TIERS.map((x) => `${x.name}|${x.at}|${x.color}`));
  assert.deepEqual(belts, BELTS.map((x) => `${x.name}|${x.ranks}|${x.color}`));
});
