// Reads GitHub's public merge record for every public repo of an organisation and turns it
// into one record per outside contributor. Only the GitHub API is used, never a model.

import { rankValue } from "./levels.mjs";

const API = "https://api.github.com";

// Closing issues are fetched as numbers only. Asking for their labels here would cost about
// 11 rate-limit points a page instead of 1, and the Actions token gets 1,000 points an hour.
const PRS = `query($owner:String!,$repo:String!,$after:String){rateLimit{cost remaining}repository(owner:$owner,name:$repo){
  pullRequests(states:MERGED,first:100,after:$after){
    pageInfo{hasNextPage endCursor}
    nodes{number title url mergedAt authorAssociation
      author{__typename login ... on User{databaseId}}
      closingIssuesReferences(first:10){nodes{number repository{nameWithOwner}}}}}}}`;

// The rank labels of a repo, then the issues under each one.
const RANK_LABELS = `query($owner:String!,$repo:String!){rateLimit{cost remaining}repository(owner:$owner,name:$repo){
  labels(query:"rank:",first:50){nodes{name}}}}`;
const LABEL_ISSUES = `query($owner:String!,$repo:String!,$label:String!,$after:String){rateLimit{cost remaining}repository(owner:$owner,name:$repo){
  label(name:$label){issues(first:100,after:$after){pageInfo{hasNextPage endCursor}nodes{number}}}}}`;

// GitHub answers heavy queries with a 502 or a 429 now and then. That is transient.
export async function withRetry(what, fn, { tries = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.status ?? 0;
      if (!(status === 429 || status >= 500) || attempt >= tries) throw error;
      await sleep(attempt * attempt * 5000);
    }
  }
}

export function githubClient({ token, fetch = globalThis.fetch }) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "flisk-badges",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const call = async (url, init = {}) => {
    const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) {
      const error = new Error(`${init.method ?? "GET"} ${url} answered ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  };
  const spent = { points: 0, remaining: null };
  const graphql = async (what, query, variables) => {
    const body = await withRetry(what, () =>
      call(`${API}/graphql`, { method: "POST", body: JSON.stringify({ query, variables }) }),
    );
    if (body.errors?.length) throw new Error(`GraphQL for ${what}: ${body.errors[0].message}`);
    if (body.data.rateLimit) {
      spent.points += body.data.rateLimit.cost;
      spent.remaining = body.data.rateLimit.remaining;
    }
    return body.data;
  };
  const paginate = async (what, query, variables, pick) => {
    const out = [];
    let after = null;
    for (;;) {
      const page = pick(await graphql(what, query, { ...variables, after }));
      out.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) return out;
      // A cursor that does not move would fetch the same page until the job times out.
      if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) {
        throw new Error(`Pagination cursor did not advance for ${what}.`);
      }
      after = page.pageInfo.endCursor;
    }
  };
  return {
    async repos(org) {
      const all = [];
      for (let page = 1; ; page++) {
        const batch = await withRetry("list repos", () =>
          call(`${API}/orgs/${org}/repos?type=public&per_page=100&page=${page}`),
        );
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all.filter((r) => !r.fork && !r.archived && !r.private).map((r) => r.name);
    },
    // The numbered-seat registry the Discord bot keeps in an issue body.
    async seats(owner, repo, issue) {
      const body = await withRetry("seat registry", () => call(`${API}/repos/${owner}/${repo}/issues/${issue}`));
      return parseSeats(body.body ?? "");
    },
    async mergedPullRequests(owner, repo) {
      const nodes = await paginate(`merged PRs of ${repo}`, PRS, { owner, repo }, (data) => data.repository.pullRequests);
      return nodes.map((pr) => ({ ...pr, repo }));
    },
    // issue number -> the hardest rank label on it, for one repo.
    async ranks(owner, repo) {
      const data = await graphql(`rank labels of ${repo}`, RANK_LABELS, { owner, repo });
      const ranks = new Map();
      for (const { name } of data.repository.labels.nodes) {
        if (rankValue(name) < 0) continue;
        const issues = await paginate(`${name} issues of ${repo}`, LABEL_ISSUES, { owner, repo, label: name }, (d) => d.repository.label.issues);
        for (const { number } of issues) {
          if (rankValue(name) > rankValue(ranks.get(number) ?? "")) ranks.set(number, name);
        }
      }
      return ranks;
    },
    cost: () => ({ ...spent }),
  };
}

// Counts PRs from outside the team: people, not bots, and not owners, members or the
// maintainers named in config. An outside contributor later given write access
// (COLLABORATOR) still counts, the same rule as Flisk's hall of fame.
export function isOutside(pr, { maintainers }) {
  const author = pr.author;
  if (!author || author.__typename !== "User" || !author.databaseId) return false;
  if (maintainers.some((m) => m.toLowerCase() === author.login.toLowerCase())) return false;
  return !["OWNER", "MEMBER"].includes(pr.authorAssociation);
}

export function aggregate(prs, { maintainers = [], optout = [], latest = 5 } = {}) {
  const people = new Map();
  const hidden = new Set(optout.map(Number));
  for (const pr of prs) {
    if (!isOutside(pr, { maintainers })) continue;
    const { login, databaseId: id } = pr.author;
    if (hidden.has(id)) continue;
    const p = people.get(id) ?? { login, id, prs: 0, issues: 0, rank: null, first: null, repos: new Set(), merges: [] };
    p.login = login; // a renamed account keeps its id, so the newest name wins
    p.prs += 1;
    p.repos.add(pr.repo);
    if (!p.first || pr.mergedAt < p.first) p.first = pr.mergedAt;
    p.merges.push({ repo: pr.repo, number: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt });
    for (const issue of pr.closingIssuesReferences?.nodes ?? []) {
      p.issues += 1;
      for (const { name } of issue.labels?.nodes ?? []) {
        if (rankValue(name) > rankValue(p.rank ?? "")) p.rank = name;
      }
    }
    people.set(id, p);
  }
  return [...people.values()]
    .map((p) => ({
      ...p,
      repos: [...p.repos].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      merges: p.merges.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).slice(0, latest),
    }))
    .sort((a, b) => b.prs - a.prs || a.first.localeCompare(b.first) || a.login.localeCompare(b.login));
}

// Keep revoked numbers for the founding seat count, but only keep active logins.
// The Discord ids in the registry stay out of the site.
export function parseSeats(body) {
  const match = /<!-- flisk:founding-data (.*?) -->/s.exec(body);
  if (!match) return [];
  return JSON.parse(match[1])
    .filter((seat) => Number.isInteger(seat.n))
    .map((seat) => seat.github && !seat.revoked ? { n: seat.n, github: seat.github } : { n: seat.n });
}

export function attachSeats(people, seats) {
  const byLogin = new Map(seats.filter((seat) => seat.github).map((seat) => [seat.github.toLowerCase(), seat.n]));
  return people.map((p) => ({ ...p, seat: byLogin.get(p.login.toLowerCase()) ?? null }));
}

// Puts each closing issue's rank label back on it, in the shape aggregate() reads.
export function withRanks(prs, ranks) {
  return prs.map((pr) => ({
    ...pr,
    closingIssuesReferences: {
      nodes: (pr.closingIssuesReferences?.nodes ?? []).map((issue) => {
        const label = ranks.get(`${issue.repository?.nameWithOwner}#${issue.number}`);
        return { ...issue, labels: { nodes: label ? [{ name: label }] : [] } };
      }),
    },
  }));
}

export async function collect({ client, org, maintainers, optout, registry, log = () => {} }) {
  let seats = [];
  if (registry) {
    // The seats are a nicety: without them every page still builds, just without numbers.
    try {
      seats = await client.seats(org, registry.repo, registry.issue);
    } catch (error) {
      log(`Could not read the seat registry: ${String(error.message).replace(/[\r\n]+/g, " ")}`);
    }
  }
  const repos = await client.repos(org);
  const prs = [];
  const ranks = new Map();
  for (const repo of repos) {
    const merged = await client.mergedPullRequests(org, repo);
    const repoRanks = await client.ranks(org, repo);
    for (const [number, label] of repoRanks) ranks.set(`${org}/${repo}#${number}`, label);
    log(`${repo}: ${merged.length} merged PRs, ${repoRanks.size} ranked issues`);
    prs.push(...merged);
  }
  const ranked = withRanks(prs, ranks);
  if (client.cost) log(`GraphQL cost ${client.cost().points} points, ${client.cost().remaining} left this hour`);
  return { repos, seats, people: attachSeats(aggregate(ranked, { maintainers, optout }), seats) };
}
