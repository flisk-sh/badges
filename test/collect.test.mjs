import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { aggregate, githubClient, isOutside, withRetry } from "../src/collect.mjs";

const prs = JSON.parse(readFileSync(new URL("./fixtures/prs.json", import.meta.url), "utf8"));
const settings = { maintainers: ["kburym", "odykyi"], optout: [303] };

test("counts only people outside the team", () => {
  const people = aggregate(prs, settings);
  assert.deepEqual(
    people.map((p) => p.login),
    ["ada-renamed", "grace"],
  );
  assert.equal(isOutside(prs[1], settings), true, "a COLLABORATOR still counts");
});

test("one record per account id, newest login, best rank, sorted merges", () => {
  const [ada, grace] = aggregate(prs, settings);
  assert.equal(ada.id, 101);
  assert.equal(ada.prs, 2);
  assert.equal(ada.issues, 2);
  assert.equal(ada.rank, "rank: 3 kyu");
  assert.equal(ada.first, "2026-01-02T10:00:00Z");
  assert.deepEqual(ada.repos, ["flisk", "gel"]);
  assert.deepEqual(
    ada.merges.map((m) => m.number),
    [2, 1],
  );
  assert.equal(grace.rank, "rank: 1 dan");
});

test("ties sort by the earlier first merge", () => {
  const people = aggregate(prs, { ...settings, optout: [] });
  assert.deepEqual(
    people.map((p) => p.login),
    ["ada-renamed", "grace", "private-person"],
  );
});

test("keeps only the latest merges", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    ...prs[7],
    number: 100 + i,
    mergedAt: `2026-03-0${i + 1}T00:00:00Z`,
  }));
  const [grace] = aggregate(many, settings);
  assert.equal(grace.prs, 8);
  assert.deepEqual(
    grace.merges.map((m) => m.number),
    [107, 106, 105, 104, 103],
  );
});

test("withRetry retries 5xx and 429, not 4xx", async () => {
  const waits = [];
  const sleep = async (ms) => waits.push(ms);
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("bad gateway"), { status: 502 });
    return "ok";
  };
  assert.equal(await withRetry("x", flaky, { sleep }), "ok");
  assert.deepEqual(waits, [5000, 20000]);

  let notFound = 0;
  await assert.rejects(
    withRetry("x", async () => {
      notFound += 1;
      throw Object.assign(new Error("nope"), { status: 404 });
    }, { sleep }),
  );
  assert.equal(notFound, 1);
});

function fakeFetch(routes) {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url, body: init.body && JSON.parse(init.body) });
    const answer = routes(url, init.body && JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => answer };
  };
  return { fetch, seen };
}

test("repos pages through the org and drops forks and archived repos", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}`, fork: i === 0, archived: i === 1 }));
  const page2 = [{ name: "last", fork: false, archived: false }];
  const { fetch, seen } = fakeFetch((url) => (url.endsWith("&page=1") ? page1 : page2));
  const names = await githubClient({ token: "t", fetch }).repos("flisk-sh");
  assert.equal(names.length, 99);
  assert.ok(!names.includes("r0") && !names.includes("r1") && names.includes("last"));
  assert.equal(seen.length, 2);
});

test("mergedPullRequests follows the cursor and stops on a stuck one", async () => {
  const node = (n) => ({ number: n });
  const pages = {
    null: { hasNextPage: true, endCursor: "a", nodes: [node(1)] },
    a: { hasNextPage: false, endCursor: "b", nodes: [node(2)] },
  };
  const { fetch } = fakeFetch((_, body) => {
    const p = pages[body.variables.after];
    return { data: { repository: { pullRequests: { pageInfo: p, nodes: p.nodes } } } };
  });
  const out = await githubClient({ token: "t", fetch }).mergedPullRequests("flisk-sh", "flisk");
  assert.deepEqual(out, [
    { number: 1, repo: "flisk" },
    { number: 2, repo: "flisk" },
  ]);

  const stuck = fakeFetch(() => ({
    data: { repository: { pullRequests: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } } },
  }));
  await assert.rejects(githubClient({ token: "t", fetch: stuck.fetch }).mergedPullRequests("o", "r"), /did not advance/);
});

test("the registry keeps seat numbers but omits Discord ids and revoked logins", async () => {
  const { attachSeats, parseSeats } = await import("../src/collect.mjs");
  const body = `<!-- flisk:founding-registry -->\ntext\n<!-- flisk:founding-data ${JSON.stringify([
    { n: 1, github: "Grace", discord: "773172081096917023", tier: "Veteran" },
    { n: 2, github: "gone", discord: "1", revoked: true },
    { n: 3, github: null },
  ])} -->`;
  const seats = parseSeats(body);
  assert.deepEqual(seats, [{ n: 1, github: "Grace" }, { n: 2 }, { n: 3 }]);
  assert.deepEqual(parseSeats("no registry here"), []);
  const people = attachSeats(aggregate(prs, settings), seats);
  assert.equal(people.find((p) => p.login === "grace").seat, 1, "logins match without case");
  assert.equal(people.find((p) => p.login === "ada-renamed").seat, null);
});

const saved = {
  updated: "2026-01-02 12:00 UTC",
  repos: ["flisk"],
  people: [
    { login: "ada", id: 101, prs: 10, issues: 4, rank: "rank: 1 dan", first: "2025-12-01T00:00:00Z", repos: ["flisk"], merges: [], seat: 1 },
  ],
};
const newPr = (number, mergedAt, repo = "chat") => ({
  ...prs.find((pr) => pr.number === 1),
  number,
  mergedAt,
  repo,
  closingIssuesReferences: { nodes: [{ number: 9, repository: { nameWithOwner: "flisk-sh/chat" } }] },
});
const fakeClient = (extra = {}) => ({
  repos: async () => ["chat", "flisk"],
  mergedPullRequests: async (_, repo) => {
    assert.notEqual(repo, "flisk", "a skipped repo is never read");
    return [newPr(1, "2026-01-02T10:00:00Z"), newPr(2, "2026-01-03T10:00:00Z")];
  },
  ranks: async () => new Map([[9, "rank: 2 kyu"]]),
  ...extra,
});
const run = async (extra, registry = { repo: "flisk-cli", issue: null }) => {
  const { collect } = await import("../src/collect.mjs");
  return collect({ client: fakeClient(extra), org: "flisk-sh", ...settings, registry, record: saved, skipRepos: ["flisk"] });
};

test("newer merges add to the saved record without counting older ones twice", async () => {
  const result = await run();
  const [ada] = result.people;
  assert.equal(ada.prs, 11);
  assert.equal(ada.issues, 5);
  assert.equal(ada.rank, "rank: 1 dan", "a rank never goes down");
  assert.equal(ada.first, "2025-12-01T00:00:00Z");
  assert.deepEqual(ada.repos, ["chat", "flisk"]);
  assert.equal(ada.seat, 1);
  assert.deepEqual(result.repos, ["chat", "flisk"]);
});

test("opting out removes a saved person but keeps their seat number taken", async () => {
  const { addRecord, recordSeats } = await import("../src/collect.mjs");
  assert.deepEqual(addRecord(saved, [], { optout: [101] }), []);
  assert.deepEqual(recordSeats(saved, [101]), [{ n: 1 }]);
});

test("a configured registry that cannot be read, or lost a seat, stops the build", async () => {
  const registry = { repo: "flisk-cli", issue: 7 };
  await assert.rejects(run({ seats: async () => { throw new Error("answered 404"); } }, registry), /404/);
  await assert.rejects(run({ seats: async () => [] }, registry), /incomplete/);
  await assert.rejects(run({ seats: async () => [{ n: 2, github: "x" }] }, registry), /Missing saved seats: 1/);
});

test("another repo failing still stops the build", async () => {
  await assert.rejects(run({ mergedPullRequests: async () => { throw new Error("bad gateway"); } }), /bad gateway/);
});

test("ranks maps each issue to its hardest rank label and skips other labels", async () => {
  const issues = {
    "rank: 6 kyu": [1, 2],
    "rank: 1 dan": [2],
  };
  const { fetch } = fakeFetch((_, body) => {
    if (!body.variables.label) {
      return {
        data: {
          rateLimit: { cost: 1, remaining: 99 },
          repository: { labels: { nodes: [{ name: "rank: 6 kyu" }, { name: "rank: fun" }, { name: "rank: 1 dan" }] } },
        },
      };
    }
    const nodes = issues[body.variables.label].map((number) => ({ number }));
    return {
      data: {
        rateLimit: { cost: 1, remaining: 98 },
        repository: { label: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } },
      },
    };
  });
  const client = githubClient({ token: "t", fetch });
  const ranks = await client.ranks("flisk-sh", "flisk");
  assert.deepEqual([...ranks], [
    [1, "rank: 6 kyu"],
    [2, "rank: 1 dan"],
  ]);
  assert.deepEqual(client.cost(), { points: 3, remaining: 98 });
});

test("withRanks puts labels on closing issues without touching the input", async () => {
  const { withRanks } = await import("../src/collect.mjs");
  const input = [{ number: 1, closingIssuesReferences: { nodes: [{ number: 4, repository: { nameWithOwner: "o/r" } }, { number: 5, repository: { nameWithOwner: "o/r" } }] } }];
  const out = withRanks(input, new Map([["o/r#4", "rank: 5 kyu"]]));
  assert.deepEqual(out[0].closingIssuesReferences.nodes.map((i) => i.labels.nodes), [[{ name: "rank: 5 kyu" }], []]);
  assert.equal(input[0].closingIssuesReferences.nodes[0].labels, undefined);
});
