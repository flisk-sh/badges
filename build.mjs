#!/usr/bin/env node
// Builds the badge site into a folder.
//   node build.mjs                       live data from GitHub (GITHUB_TOKEN or GH_TOKEN)
//   node build.mjs --fixture prs.json [--seats seats.json]   saved data, no network
//   node build.mjs --out _site --org flisk-sh

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { aggregate, attachSeats, collect, githubClient } from "./src/collect.mjs";
import { renderSite } from "./src/render.mjs";

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unknown argument ${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    out[key.slice(2)] = value;
    i++;
  }
  return out;
}

const readJson = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));

const opts = args(process.argv.slice(2));
const config = await readJson("./config.json");
const optout = await readJson("./optout.json");
const org = opts.org ?? config.org;
const outDir = opts.out ?? "_site";
const settings = { maintainers: config.maintainers, optout: optout.map((entry) => entry.id) };

let result;
if (opts.fixture) {
  const prs = JSON.parse(await readFile(opts.fixture, "utf8"));
  const seats = opts.seats ? JSON.parse(await readFile(opts.seats, "utf8")) : [];
  result = {
    repos: [...new Set(prs.map((pr) => pr.repo))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    seats,
    people: attachSeats(aggregate(prs, settings), seats),
  };
} else {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) throw new Error("Set GITHUB_TOKEN (GraphQL needs a token, even for public data).");
  result = await collect({
    client: githubClient({ token }),
    org,
    ...settings,
    registry: config.registry,
    record: await readJson(config.record),
    skipRepos: config.skipRepos,
    log: (line) => console.log(line),
  });
}

const updated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const files = renderSite({ ...result, updated, totalSeats: config.registry.seats });
await rm(outDir, { recursive: true, force: true });
for (const [path, contents] of Object.entries(files)) {
  const target = join(outDir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}
console.log(`${result.people.length} people, ${Object.keys(files).length} files in ${outDir}`);
