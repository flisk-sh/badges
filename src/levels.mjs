// Tiers and belts, kept in step with flisk-sh/flisk-cli scripts/discord-contributor-levels.mjs,
// so a badge here and a Discord role there always agree. test/levels.test.mjs checks the copy.

// Lowest first. A tier comes from merged PRs.
export const TIERS = [
  { name: "Regular", at: 5, color: "38bdf8" },
  { name: "Core", at: 15, color: "06b6d4" },
  { name: "Veteran", at: 30, color: "8b5cf6" },
  { name: "Elite", at: 50, color: "f59e0b" },
  { name: "Legend", at: 100, color: "ef4444" },
];

// Below the first tier everyone is a contributor, in Flisk green.
export const STARTER = { name: "Contributor", at: 1, color: "22c55e" };

// A belt comes from the hardest `rank:` label on an issue a person's PR fixed.
export const BELTS = [
  { name: "White", ranks: "8-7 kyu", color: "e5e7eb" },
  { name: "Green", ranks: "6-5 kyu", color: "22c55e" },
  { name: "Brown", ranks: "4-1 kyu", color: "a16207" },
  { name: "Black", ranks: "dan", color: "18181b" },
];

export function tierFor(prs) {
  return TIERS.findLast((tier) => prs >= tier.at) ?? STARTER;
}

export function nextTier(prs) {
  return TIERS.find((tier) => prs < tier.at) ?? null;
}

// 8 kyu is the easiest rank and 1 dan the hardest, so dan sorts above every kyu.
export function rankValue(label) {
  const match = /^rank: (\d+) (kyu|dan)$/.exec(label);
  if (!match) return -1;
  return match[2] === "dan" ? 100 + Number(match[1]) : 100 - Number(match[1]);
}

export function rankName(label) {
  return rankValue(label) < 0 ? null : label.slice("rank: ".length);
}

export function beltFor(label) {
  const value = rankValue(label);
  if (value < 0) return null;
  if (value > 100) return BELTS[3];
  const kyu = 100 - value;
  if (kyu <= 4) return BELTS[2];
  return kyu <= 6 ? BELTS[1] : BELTS[0];
}
