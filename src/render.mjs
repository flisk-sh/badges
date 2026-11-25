// Turns the per-person records from collect.mjs into static files: one page and three
// embeddable SVGs per person, plus a leaderboard. No client-side script, no web fonts in SVGs.

import { beltFor, nextTier, rankName, tierFor, TIERS } from "./levels.mjs";

export const SITE = "https://badges.flisk.si";
export const DISCORD = "https://discord.gg/qMu5Xn8Kaq";
// The same colours as the shields badges the merged-PR bot posts: cyan on near-black.
const SEAT_COLOR = "06b6d4";
const LABEL_BG = "#07080f";

export function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slug(person) {
  return `${person.login.toLowerCase()}-${person.id}`;
}

export function day(iso) {
  return iso ? iso.slice(0, 10) : "";
}

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";
// Monospace glyphs are 0.6em wide in every font of the stack above, so widths can be computed.
const charWidth = (size) => size * 0.6;
const textWidth = (text, size) => Math.ceil(String(text).length * charWidth(size));

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// Readable text on a coloured fill: dark ink on light fills, white on dark ones.
export function inkOn(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#04120a" : "#ffffff";
}

export function describe(person) {
  const tier = tierFor(person.prs);
  const belt = beltFor(person.rank ?? "");
  const next = nextTier(person.prs);
  return { tier, belt, next, rank: rankName(person.rank ?? ""), seat: seatName(person.seat) };
}

// Seats 1-100 are Founding Contributor badges, later ones numbered Flisk Contributor badges.
export function seatName(n, total = 100) {
  if (!n) return null;
  return n <= total ? `Founding Contributor #${n}` : `Flisk Contributor #${n}`;
}

// The locked badge from the bot's thank-you comment, so the page and the comment match.
export function lockedBadgeUrl(seatsLeft, total = 100) {
  const founding = seatsLeft !== 0;
  const params = new URLSearchParams({
    label: `\u{1F512} ${founding ? "FOUNDING CONTRIBUTOR" : "FLISK CONTRIBUTOR"}`,
    message: founding && seatsLeft !== null ? `${seatsLeft} of ${total} left` : "claim yours",
    color: SEAT_COLOR,
    labelColor: LABEL_BG.slice(1),
    style: "for-the-badge",
  });
  return `https://img.shields.io/static/v1?${params.toString().replaceAll("+", "%20")}`;
}

function svg(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${body}</svg>\n`;
}

// Shields-style plate: a black "flisk" segment and a tier-coloured segment.
export function plateSvg(person) {
  const { tier } = describe(person);
  const left = "flisk";
  const right = `${tier.name} · ${plural(person.prs, "PR")}`;
  const size = 11;
  const lw = textWidth(left, size) + 16;
  const rw = textWidth(right, size) + 16;
  const title = `${person.login}: ${right} merged in flisk-sh`;
  return svg(
    lw + rw,
    20,
    title,
    `<rect width="${lw}" height="20" fill="${LABEL_BG}"/>` +
      `<rect x="${lw}" width="${rw}" height="20" fill="#${tier.color}"/>` +
      `<g font-family="${MONO}" font-size="${size}" font-weight="700">` +
      `<text x="8" y="14" fill="#22c55e">${left}</text>` +
      `<text x="${lw + 8}" y="14" fill="${inkOn(tier.color)}">${esc(right)}</text></g>`,
  );
}

// Round medal: tier colour ring, the PR count in the middle.
export function medalSvg(person) {
  const { tier, belt } = describe(person);
  const ring = `#${tier.color}`;
  const top = person.seat ? `FLISK #${person.seat}` : "FLISK";
  const title = `${person.login}: ${tier.name}, ${plural(person.prs, "merged PR")}${belt ? `, ${belt.name} belt` : ""}`;
  const count = String(person.prs);
  const big = count.length > 2 ? 30 : 38;
  return svg(
    120,
    120,
    title,
    `<circle cx="60" cy="60" r="56" fill="${ring}"/>` +
      `<circle cx="60" cy="60" r="46" fill="#08080c"/>` +
      (belt ? `<rect x="22" y="84" width="76" height="6" fill="#${belt.color}" stroke="#71717a" stroke-width="0.5"/>` : "") +
      `<g font-family="${MONO}" text-anchor="middle" font-weight="700">` +
      `<text x="60" y="38" font-size="9" fill="#${person.seat ? SEAT_COLOR : "22c55e"}" letter-spacing="1">${top}</text>` +
      `<text x="60" y="${big === 38 ? 73 : 70}" font-size="${big}" fill="#eeece5">${count}</text>` +
      `<text x="60" y="${belt ? 102 : 92}" font-size="8" fill="${ring}" letter-spacing="1">${esc(tier.name.toUpperCase())}</text></g>`,
  );
}

// Wide card for a README: name, tier, belt, counts and progress to the next tier.
export function cardSvg(person) {
  const { tier, belt, next, rank } = describe(person);
  const W = 460;
  const H = 132;
  const title = `${person.login} on Flisk: ${tier.name}, ${plural(person.prs, "merged PR")}`;
  const from = TIERS.includes(tier) ? tier.at : 0;
  const progress = next ? Math.max(0, Math.min(1, (person.prs - from) / (next.at - from))) : 1;
  const barW = W - 40;
  const stats = [
    ["PRS", person.prs],
    ["ISSUES", person.issues],
    ["REPOS", person.repos.length],
    ["SINCE", day(person.first).slice(0, 7)],
  ];
  const col = barW / stats.length;
  const login = person.login.length > 24 ? `${person.login.slice(0, 23)}…` : person.login;
  return svg(
    W,
    H,
    title,
    `<rect width="${W}" height="${H}" fill="#08080c"/>` +
      `<rect width="6" height="${H}" fill="#${tier.color}"/>` +
      `<g font-family="${MONO}">` +
      `<text x="20" y="26" font-size="10" fill="#${person.seat ? SEAT_COLOR : "22c55e"}" font-weight="700" letter-spacing="1">${esc((seatName(person.seat) ?? "Flisk contributor").toUpperCase())}</text>` +
      `<text x="${W - 20}" y="26" font-size="10" fill="#${tier.color}" font-weight="700" text-anchor="end" letter-spacing="1">${esc(tier.name.toUpperCase())}${belt ? ` · ${esc(belt.name.toUpperCase())} BELT` : ""}</text>` +
      `<text x="20" y="52" font-size="18" fill="#eeece5" font-weight="700">${esc(login)}</text>` +
      `<line x1="20" y1="64" x2="${W - 20}" y2="64" stroke="#2a2a30"/>` +
      stats
        .map(
          ([label, value], i) =>
            `<text x="${20 + i * col}" y="82" font-size="8" fill="#71717a" letter-spacing="1">${label}</text>` +
            `<text x="${20 + i * col}" y="98" font-size="13" fill="#eeece5" font-weight="700">${esc(value)}</text>`,
        )
        .join("") +
      `<rect x="20" y="110" width="${barW}" height="4" fill="#2a2a30"/>` +
      `<rect x="20" y="110" width="${Math.round(barW * progress)}" height="4" fill="#${tier.color}"/>` +
      `<text x="20" y="126" font-size="8" fill="#71717a" letter-spacing="1">${
        next ? `${next.at - person.prs} MORE TO ${esc(next.name.toUpperCase())}` : "TOP TIER"
      }${rank ? ` · BEST ISSUE ${esc(rank.toUpperCase())}` : ""}</text></g>`,
  );
}

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">';

const CSS = `
:root{--seat:#0e7490;--paper:#eeece5;--bg2:#e5e2d9;--ink:#04120a;--faint:#71717a;--rule:#04120a;--hair:#cfcabd;--accent:#22c55e;--acc-text:#137a3a}
@media (prefers-color-scheme:dark){:root{--seat:#22d3ee;--paper:#08080c;--bg2:#111116;--ink:#eeece5;--faint:#a1a1aa;--rule:#eeece5;--hair:#2a2a30;--acc-text:#6ee7a0}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "JetBrains Mono",ui-monospace,monospace}
a{color:var(--acc-text)}
main{max-width:880px;margin:0 auto;padding:48px 16px 64px}
.label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
h1,.num{font-family:Fraunces,Georgia,serif;font-weight:800;letter-spacing:-.02em;margin:0}
h1{font-size:clamp(36px,8vw,64px);line-height:1;word-break:break-word}
h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px;font-weight:700}
section{border-top:2px solid var(--rule);padding:20px 0 28px}
.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;flex-wrap:wrap;margin:12px 0 28px}
.chip{display:inline-block;padding:4px 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.stats{display:grid;grid-template-columns:repeat(4,1fr);border-left:1px solid var(--hair)}
.stats>div{border-right:1px solid var(--hair);padding:4px 14px}
.num{font-size:clamp(28px,6vw,44px);line-height:1.1}
.bar{height:8px;background:var(--bg2);margin:10px 0 6px}
.bar i{display:block;height:100%}
table{width:100%;border-collapse:collapse}
td a{overflow-wrap:anywhere}
.scroll{overflow-x:auto}
td,th{text-align:left;padding:8px 8px 8px 0;border-bottom:1px solid var(--hair);vertical-align:top}
td+td,th+th{padding-left:14px}
th{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:400}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.embeds{display:grid;gap:18px}
.embed{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.embed img{max-width:100%;height:auto}
ol{padding-left:20px;margin:8px 0}li{margin:4px 0}code{background:var(--bg2);padding:1px 4px}
pre{margin:0;padding:10px 12px;background:var(--bg2);overflow-x:auto;font-size:12px;white-space:pre}
footer{border-top:1px solid var(--hair);padding-top:16px;font-size:12px;color:var(--faint)}
@media (max-width:560px){td+td,th+th{padding-left:8px}.stats{grid-template-columns:repeat(2,1fr)}.stats>div{border-bottom:1px solid var(--hair)}.hide-sm{display:none}}
`;

function page({ title, description, path, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" href="https://flisk.si/favicon.ico">
${FONTS}
<style>${CSS}</style>
</head>
<body>
<script src="https://flisk.si/assets/bar.js" defer></script>
<main>
${body}
</main>
</body>
</html>
`;
}

const FOOTER = (updated) =>
  `<footer>Built from GitHub's public merge record of <a href="https://github.com/flisk-sh">flisk-sh</a>, every 30 minutes. Last built ${esc(updated)}. ` +
  `Counts merged pull requests by people outside the Flisk team, across the org's public repos. ` +
  `To hide your page, open a PR adding your GitHub user id to <a href="https://github.com/flisk-sh/badges/blob/main/optout.json">optout.json</a>. ` +
  `<a href="https://github.com/flisk-sh/badges">Source</a>.</footer>`;

function seatSection(person, { seatsLeft, totalSeats }) {
  if (person.seat) return "";
  const locked = lockedBadgeUrl(seatsLeft, totalSeats);
  const name = seatsLeft === 0 ? "Flisk Contributor" : "Founding Contributor";
  return `
<section>
  <h2>Claim your numbered ${name} badge</h2>
  <p><a href="${DISCORD}"><img src="${esc(locked)}" alt="${name} badge, locked" height="28"></a></p>
  <ol>
    <li>Join <a href="${DISCORD}">the Flisk Discord</a>.</li>
    <li>Post the link of one of your merged PRs in <code>#start-here</code>.</li>
    <li>The bot gives you your number, your level roles and the private <code>#contributors</code> channel. This page shows the number within 30 minutes.</li>
  </ol>
  ${seatsLeft ? `<p class="label">First ${totalSeats} only. ${seatsLeft} left.</p>` : ""}
</section>`;
}

export function personPage(person, { updated, seatsLeft = null, totalSeats = 100 }) {
  const { tier, belt, next, rank, seat } = describe(person);
  const base = `${SITE}/${slug(person)}`;
  const from = TIERS.includes(tier) ? tier.at : 0;
  const progress = next ? Math.max(0, Math.min(1, (person.prs - from) / (next.at - from))) : 1;
  const embeds = [
    ["Card", "card.svg", 460],
    ["Plate", "plate.svg", null],
    ["Medal", "medal.svg", 120],
  ];
  const body = `
<div class="label">Flisk contributor · <a href="${SITE}/">all contributors</a></div>
<div class="top">
  <h1><a href="https://github.com/${esc(person.login)}" style="color:inherit;text-decoration:none">${esc(person.login)}</a></h1>
  <div>
    ${seat ? `<span class="chip" style="background:#${SEAT_COLOR};color:${inkOn(SEAT_COLOR)}">&#9889; ${esc(seat)}</span>` : ""}
    <span class="chip" style="background:#${tier.color};color:${inkOn(tier.color)}">${esc(tier.name)}</span>
    ${belt ? `<span class="chip" style="background:#${belt.color};color:${inkOn(belt.color)}">${esc(belt.name)} belt</span>` : ""}
  </div>
</div>
<section>
  <div class="stats">
    <div><div class="label">Merged PRs</div><div class="num">${person.prs}</div></div>
    <div><div class="label">Issues fixed</div><div class="num">${person.issues}</div></div>
    <div><div class="label">Repos</div><div class="num">${person.repos.length}</div></div>
    <div><div class="label">First merge</div><div class="num" style="font-size:clamp(18px,3.2vw,24px);white-space:nowrap">${esc(day(person.first))}</div></div>
  </div>
</section>
<section>
  <h2>${next ? `Next: ${esc(next.name)} at ${next.at}` : "Top tier reached"}</h2>
  <div class="bar"><i style="width:${Math.round(progress * 100)}%;background:#${tier.color}"></i></div>
  <div class="label">${next ? `${plural(next.at - person.prs, "more merged PR")} to go` : "the top tier"}${rank ? ` · hardest issue fixed: ${esc(rank)}` : ""}</div>
</section>
<section>
  <h2>Latest merges</h2>
  <table>
    <tr><th>Pull request</th><th class="hide-sm">Repo</th><th class="n">Merged</th></tr>
    ${person.merges
      .map(
        (m) =>
          `<tr><td><a href="${esc(m.url)}">${esc(m.title)}</a></td><td class="hide-sm">${esc(m.repo)}</td><td class="n">${esc(day(m.mergedAt))}</td></tr>`,
      )
      .join("\n    ")}
  </table>
  <p class="label">Repos: ${person.repos.map(esc).join(", ")}</p>
</section>
${seatSection(person, { seatsLeft, totalSeats })}
<section>
  <h2>Put it in your README</h2>
  <div class="embeds">
  ${embeds
    .map(
      ([name, file, width]) => `<div class="embed">
    <div class="label">${name}</div>
    <img src="${file}" alt="${esc(person.login)} Flisk ${name.toLowerCase()}"${width ? ` width="${width}"` : ""}>
    <pre>[![${esc(person.login)} on Flisk](${base}/${file})](${base}/)</pre>
  </div>`,
    )
    .join("\n  ")}
  </div>
</section>
${FOOTER(updated)}`;
  return page({
    title: `${person.login} · Flisk badges`,
    description: `${person.login} is a ${tier.name} Flisk contributor${seat ? ` (${seat})` : ""} with ${plural(person.prs, "merged pull request")}.`,
    path: `/${slug(person)}/`,
    body,
  });
}

export function indexPage(people, { updated, repos, claimed = 0, totalSeats = 100 }) {
  const total = people.reduce((sum, p) => sum + p.prs, 0);
  const touched = new Set(people.flatMap((p) => p.repos)).size;
  const rows = people
    .map((p, i) => {
      const { tier, belt } = describe(p);
      const seat = p.seat ? `<span style="color:var(--seat)">#${p.seat}</span>` : "";
      return `<tr><td class="n">${i + 1}</td><td><a href="${slug(p)}/">${esc(p.login)}</a></td><td class="n hide-sm">${seat}</td><td><span class="chip" style="background:#${tier.color};color:${inkOn(tier.color)};padding:1px 6px;font-size:10px">${esc(tier.name)}</span></td><td class="hide-sm">${belt ? esc(belt.name) : ""}</td><td class="n">${p.prs}</td><td class="n hide-sm">${esc(day(p.first))}</td></tr>`;
    })
    .join("\n");
  const body = `
<div class="label">Flisk · badges</div>
<div class="top"><h1>Contributors</h1></div>
<section>
  <div class="stats">
    <div><div class="label">People</div><div class="num">${people.length}</div></div>
    <div><div class="label">Merged PRs</div><div class="num">${total}</div></div>
    <div><div class="label">Repos of ${repos.length}</div><div class="num">${touched}</div></div>
    <div><div class="label">Founding seats</div><div class="num">${claimed}<span style="font-size:.45em;color:var(--faint)"> / ${totalSeats}</span></div></div>
  </div>
</section>
<section>
  <h2>How levels work</h2>
  <p>Tiers come from merged PRs: ${TIERS.map((t) => `${esc(t.name)} ${t.at}`).join(", ")}. Belts come from the hardest <code>rank:</code> label on an issue your PR fixed: White 8-7 kyu, Green 6-5 kyu, Brown 4-1 kyu, Black dan. The first ${totalSeats} people to claim one on <a href="${DISCORD}">Discord</a> get a numbered Founding Contributor badge. The same levels are your roles on the Flisk Discord.</p>
</section>
<section>
  <h2>Everyone with a merged PR, most first</h2>
  <div class="scroll"><table>
    <tr><th class="n">#</th><th>GitHub</th><th class="n hide-sm">Seat</th><th>Tier</th><th class="hide-sm">Belt</th><th class="n">PRs</th><th class="n hide-sm">First merge</th></tr>
${rows}
  </table></div>
</section>
${FOOTER(updated)}`;
  return page({
    title: "Flisk badges",
    description: `${people.length} people outside the Flisk team have merged ${total} pull requests. Each has a page and README badges.`,
    path: "/",
    body,
  });
}

export function notFoundPage() {
  return page({
    title: "Not found · Flisk badges",
    description: "No badge page here.",
    path: "/404.html",
    body: `<div class="label">Flisk · badges</div><div class="top"><h1>No page here</h1></div><section><p>A page appears within 30 minutes of a first merged pull request in <a href="https://github.com/flisk-sh">flisk-sh</a>. See <a href="${SITE}/">all contributors</a>.</p></section>`,
  });
}

// Every file the site needs, as { path: contents }. build.mjs writes them to disk.
export function renderSite({ people, repos, updated, seats = [], totalSeats = 100 }) {
  const claimed = seats.filter(({ n }) => n > 0 && n <= totalSeats).length;
  const seatsLeft = seats.length ? Math.max(totalSeats - claimed, 0) : null;
  const files = {
    "index.html": indexPage(people, { updated, repos, claimed, totalSeats }),
    "404.html": notFoundPage(),
    "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.txt\n`,
    "sitemap.txt": [`${SITE}/`, ...people.map((p) => `${SITE}/${slug(p)}/`)].join("\n") + "\n",
    CNAME: "badges.flisk.si\n",
    ".nojekyll": "",
    "data.json": `${JSON.stringify(
      {
        updated,
        repos,
        people: people.map((p) => ({ ...p, ...summary(p), page: `${SITE}/${slug(p)}/` })),
      },
      null,
      2,
    )}\n`,
  };
  for (const person of people) {
    const dir = slug(person);
    files[`${dir}/index.html`] = personPage(person, { updated, seatsLeft, totalSeats });
    files[`${dir}/card.svg`] = cardSvg(person);
    files[`${dir}/plate.svg`] = plateSvg(person);
    files[`${dir}/medal.svg`] = medalSvg(person);
  }
  return files;
}

function summary(person) {
  const { tier, belt } = describe(person);
  return { tier: tier.name, belt: belt?.name ?? null, seat: person.seat ?? null };
}
