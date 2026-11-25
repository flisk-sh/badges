import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { aggregate } from "../src/collect.mjs";
import { attachSeats, parseSeats } from "../src/collect.mjs";
import { cardSvg, esc, inkOn, lockedBadgeUrl, medalSvg, plateSvg, renderSite, seatName, slug } from "../src/render.mjs";

const prs = JSON.parse(readFileSync(new URL("./fixtures/prs.json", import.meta.url), "utf8"));
const seats = [{ n: 3, github: "GRACE" }];
const people = attachSeats(aggregate(prs, { maintainers: ["odykyi"], optout: [303] }), seats);
const site = renderSite({ people, repos: ["flisk", "gel"], seats, updated: "2026-11-22 10:00 UTC" });

test("one folder per person, named login-id", () => {
  assert.equal(slug(people[0]), "ada-renamed-101");
  for (const file of ["index.html", "card.svg", "plate.svg", "medal.svg"]) {
    assert.ok(site[`ada-renamed-101/${file}`], file);
    assert.ok(site[`grace-202/${file}`], file);
  }
  assert.equal(site.CNAME, "badges.flisk.si\n");
  assert.ok(!Object.keys(site).some((path) => path.startsWith("private-person")));
});

test("escapes titles from GitHub", () => {
  assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  const page = site["ada-renamed-101/index.html"];
  assert.ok(page.includes("fix: &lt;script&gt; in title"));
  assert.ok(!page.includes("<script> in title"));
});

test("SVGs are self-contained and labelled", () => {
  for (const make of [cardSvg, plateSvg, medalSvg]) {
    const svg = make(people[0]);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title>ada-renamed/);
    assert.ok(!svg.includes("@import") && !svg.includes("<link") && !svg.includes("href="), "no external loads");
  }
});

test("plate width grows with the text", () => {
  const width = (svg) => Number(/width="(\d+)"/.exec(svg)[1]);
  const core = plateSvg({ ...people[0], prs: 15 });
  const legend = plateSvg({ ...people[0], prs: 120 });
  // "flisk" is 5 glyphs, "Core · 15 PRs" 13 and "Legend · 120 PRs" 16, each 6.6 px plus 16 px padding.
  assert.equal(width(core), Math.ceil(5 * 6.6) + 16 + Math.ceil(13 * 6.6) + 16);
  assert.ok(width(legend) > width(core));
  assert.match(legend, /Legend · 120 PRs/);
  assert.match(plateSvg({ ...people[0], prs: 1 }), /Contributor · 1 PR</);
});

test("page shows tier, belt, embeds and the opt-out note", () => {
  const page = site["grace-202/index.html"];
  assert.match(page, /Contributor<\/span>/);
  assert.match(page, /Black belt/);
  assert.match(page, /https:\/\/badges.flisk.si\/grace-202\/card.svg/);
  assert.match(page, /optout.json/);
  assert.match(page, /<link rel="canonical" href="https:\/\/badges.flisk.si\/grace-202\/">/);
});

test("leaderboard and data.json list everyone, most PRs first", () => {
  const index = site["index.html"];
  assert.ok(index.indexOf("ada-renamed") < index.indexOf("grace"));
  const data = JSON.parse(site["data.json"]);
  assert.equal(data.people.length, 2);
  assert.equal(data.people[0].tier, "Contributor");
  assert.equal(data.people[1].belt, "Black");
  assert.equal(data.people[0].page, "https://badges.flisk.si/ada-renamed-101/");
});

test("ink is dark on light fills and white on dark ones", () => {
  assert.equal(inkOn("e5e7eb"), "#04120a");
  assert.equal(inkOn("18181b"), "#ffffff");
});

test("a claimed seat shows on the page, card, medal and leaderboard", () => {
  assert.match(site["grace-202/index.html"], /Founding Contributor #3/);
  assert.match(cardSvg(people[1]), /FOUNDING CONTRIBUTOR #3/);
  assert.match(medalSvg(people[1]), /FLISK #3/);
  assert.match(site["index.html"], /#3<\/span>/);
  assert.match(site["index.html"], /1<span[^>]*> \/ 100/);
  assert.ok(!site["grace-202/index.html"].includes("Claim your numbered"));
  assert.equal(JSON.parse(site["data.json"]).people[1].seat, 3);
  assert.equal(seatName(101), "Flisk Contributor #101");
});

test("without a seat the page shows the bot's locked badge and the claim steps", () => {
  const page = site["ada-renamed-101/index.html"];
  assert.match(page, /Claim your numbered Founding Contributor badge/);
  assert.match(page, /99 left/);
  assert.match(page, /discord.gg\/qMu5Xn8Kaq/);
  assert.ok(page.includes(esc(lockedBadgeUrl(99))));
  assert.match(lockedBadgeUrl(99), /label=%F0%9F%94%92%20FOUNDING%20CONTRIBUTOR&message=99%20of%20100%20left&color=06b6d4&labelColor=07080f/);
  assert.match(lockedBadgeUrl(0), /FLISK%20CONTRIBUTOR&message=claim%20yours/);
});

test("regular contributor seats never increase the founding seat total", () => {
  const full = Array.from({ length: 101 }, (_, i) => ({ n: i + 1, github: `user-${i + 1}` }));
  const pages = renderSite({ people, repos: [], seats: full });
  assert.match(pages["index.html"], /Founding seats<\/div><div class="num">100<span[^>]*> \/ 100/);
  assert.match(pages["ada-renamed-101/index.html"], /Claim your numbered Flisk Contributor badge/);
});

test("revoked numbers stay taken without displaying a badge for the former holder", () => {
  const entries = [{ n: 1, github: "grace" }, { n: 2, github: "ada-renamed", revoked: true }];
  const registrySeats = parseSeats(`<!-- flisk:founding-data ${JSON.stringify(entries)} -->`);
  const contributors = attachSeats(aggregate(prs, { maintainers: ["odykyi"], optout: [303] }), registrySeats);
  const pages = renderSite({ people: contributors, repos: [], seats: registrySeats, totalSeats: 2 });
  assert.match(pages["index.html"], /Founding seats<\/div><div class="num">2<span[^>]*> \/ 2/);
  assert.match(pages["ada-renamed-101/index.html"], /Claim your numbered Flisk Contributor badge/);
  assert.equal(contributors.find((p) => p.login === "ada-renamed").seat, null);
});
