// End-to-end checks of artifacts 03 and 06 in Chromium.
//   1. deno run --allow-net --allow-read --allow-env tests/local_server.ts
//   2. node tests/pages_e2e.mjs [path/to/original/03.html path/to/original/06.html]
// With the two original pages given, offline behaviour is compared with them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = require("/opt/node22/lib/node_modules/playwright"); }

const BASE = "http://localhost:8787";
const AI = BASE + "/functions/v1/ai";
const P03 = "/artifacts/03_jobs_vs_tasks_decomposer.html";
const P06 = "/artifacts/06_pandemic_policy_room.html";
const [ORIG03, ORIG06] = process.argv.slice(2);

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? "  -> " + detail : ""}`);
  if (!cond) failures++;
};
const control = (patch) => fetch(BASE + "/__control", { method: "POST", body: JSON.stringify(patch) });

// A page with AI_URL set (live) or left empty (offline), or an original file.
async function open(path, { live = false, original = null, code = null, clipboard = true } = {}) {
  const ctx = await browser.newContext({ permissions: clipboard ? ["clipboard-read", "clipboard-write"] : [] });
  const page = await ctx.newPage();
  const external = [];
  page.on("request", (r) => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
  // The blog cannot reach Anthropic directly; neither can these pages here.
  await page.route("https://api.anthropic.com/**", (r) => r.abort());
  await page.route(BASE + path, async (route) => {
    let html = original ? readFileSync(original, "utf8") : await (await fetch(BASE + path + "?offline")).text();
    if (live) html = html.replace('const AI_URL = "";', `const AI_URL = "${AI}";`);
    await route.fulfill({ body: html, contentType: "text/html; charset=utf-8" });
  });
  if (code !== null) await page.addInitScript((c) => localStorage.setItem("aim_class_code", c), code);
  await page.goto(BASE + path);
  if (live) await page.waitForFunction(() => document.getElementById("badge").textContent !== "Offline mode" || window.__statusChecked, null, { timeout: 3000 }).catch(() => {});
  return { page, ctx, external };
}

async function decompose(page, job) {
  await page.fill("#job", job);
  await page.click("#go");
  await page.waitForFunction(() => !document.getElementById("go").disabled && !/Asking Claude/.test(document.getElementById("status").textContent));
  return {
    status: await page.textContent("#status"),
    cards: await page.$$eval(".card .task", (els) => els.map((e) => e.textContent)),
    paste: await page.isVisible("#paste"),
  };
}

async function playGame(page) {
  const out = [];
  for (let q = 0; q < 8; q++) {
    await page.click("#resolveBtn");
    await page.waitForFunction(() => document.getElementById("briefStatus").textContent !== "Reading the quarter…");
    out.push([await page.textContent("#briefStatus"), await page.textContent("#briefBody")]);
    if (q < 7) await page.click("#nextBtn"); else await page.click("#toDebrief");
  }
  await page.waitForFunction(() => document.getElementById("assessBody").textContent !== "Assessing…");
  out.push(["debrief", await page.textContent("#assessBody")]);
  return out;
}

/* ---------------- offline: AI_URL empty ---------------- */
{
  const { page, ctx, external } = await open(P03);
  check("03 offline: badge hidden", !(await page.isVisible("#live")));
  const rad = await decompose(page, "Radiologist");
  check("03 offline: worked example loads", rad.cards.length === 10 && rad.status.startsWith("Couldn't reach Claude live — loaded a worked example"), rad.status);
  const rec = await decompose(page, "Recruiter");
  check("03 offline: custom role offers copy-a-prompt", rec.paste && /copy a prompt for any AI below/.test(rec.status), rec.status);
  await page.click("#promptBtn");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("03 offline: prompt copied to clipboard", clip.includes('Decompose the role of "Recruiter"'));
  await page.fill("#answerBox", "Sure! Here it is:\n```json\n" + JSON.stringify([
    { task: "Source candidates", type: "augment", why: "AI searches", time: 30, value: 20 },
    { task: "Close the offer", type: "human", why: "Trust", time: 70, value: 80 },
  ]) + "\n```");
  await page.click("#useBtn");
  const pasted = await page.$$eval(".card .task", (els) => els.map((e) => e.textContent));
  check("03 offline: pasted answer parsed into cards", pasted.join("|") === "Source candidates|Close the offer", pasted.join("|"));
  await page.click("#go"); await page.waitForFunction(() => !document.getElementById("go").disabled);
  await page.fill("#answerBox", "not json at all");
  await page.click("#useBtn");
  check("03 offline: bad paste explained", /did not read as a JSON array/.test(await page.textContent("#pnote")));
  check("03 offline: no network calls beyond the page", external.length === 0, external.join(", "));
  await ctx.close();

  const blocked = await open(P03, { clipboard: false });
  await decompose(blocked.page, "Recruiter");
  await blocked.page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("blocked")); });
  await blocked.page.click("#promptBtn");
  const sel = await blocked.page.evaluate(() => {
    const b = document.getElementById("promptBox");
    return { visible: b.style.display !== "none", selected: b.selectionEnd - b.selectionStart === b.value.length && b.value.length > 100, focused: document.activeElement === b };
  });
  check("03 offline: clipboard blocked -> prompt shown in a box, selected", sel.visible && sel.selected && sel.focused, JSON.stringify(sel));
  await blocked.ctx.close();

  const g = await open(P06);
  check("06 offline: badge hidden", !(await g.page.isVisible("#live")));
  const game = await playGame(g.page);
  check("06 offline: every briefing is the offline summary", game.slice(0, 8).every(([s]) => s === "(offline summary)"), game.map((x) => x[0]).join(","));
  check("06 offline: debrief falls back", game[8][1].startsWith("You ended 2021 with US unemployment"));
  check("06 offline: no network calls beyond the page", g.external.length === 0, g.external.join(", "));
  await g.ctx.close();

  if (ORIG03 && ORIG06) {
    const o = await open(P06, { original: ORIG06 });
    const orig = await playGame(o.page);
    check("06 offline: same briefings and debrief as the original page", JSON.stringify(orig) === JSON.stringify(game));
    const o3 = await open(P03, { original: ORIG03 });
    const n3 = await open(P03);
    const a = await decompose(o3.page, "Financial controller"), b = await decompose(n3.page, "Financial controller");
    check("03 offline: same worked-example result as the original page", a.status === b.status && a.cards.join() === b.cards.join(), `${a.status} | ${b.status}`);
    const exportOld = await o.page.evaluate(() => JSON.stringify(scoreFromHist(G.hist)));
    const g2 = await open(P06); await playGame(g2.page);
    const exportNew = await g2.page.evaluate(() => JSON.stringify(scoreFromHist(G.hist)));
    check("06 offline: identical score from identical play", exportOld === exportNew, `${exportOld} vs ${exportNew}`);
    for (const x of [o, o3, n3, g2]) await x.ctx.close();
  }
}

/* ---------------- live: AI_URL set, through the local gate ---------------- */
await control({ enabled: true, opens_at: null, closes_at: null, budget_usd: 5, budget_since: new Date().toISOString(), code: "LOCAL1" });
{
  const { page, ctx, external } = await open(P03, { live: true, code: "local1" });
  await page.waitForFunction(() => document.getElementById("badge").textContent === "Live AI on");
  check("03 live: badge on, class-code field shown", await page.isVisible("#classCode"));
  const r = await decompose(page, "Recruiter");
  check("03 live: parsed tasks from the server", r.cards[0] === "Screen CVs at volume" && r.cards.length === 5, r.cards.join("|"));
  check("03 live: only the proxy is called", external.length === 0, external.join(", "));
  for (let i = 0; i < 3; i++) await decompose(page, "Recruiter");
  const limited = await decompose(page, "Radiologist");
  check("03 live: 5th call in 10 min -> rate limit, worked example", limited.status.startsWith("This device has reached its live-AI limit for now — loaded a worked example"), limited.status);
  await ctx.close();
}
{
  const { page, ctx } = await open(P03, { live: true, code: "WRONG9" });
  const r = await decompose(page, "Recruiter");
  check("03 live: wrong code -> one-line reason + copy-a-prompt", r.status.startsWith("That class code was not accepted.") && r.paste, r.status);
  await page.fill("#classCode", "");
  const e = await decompose(page, "Radiologist");
  check("03 live: empty code -> asks for it", e.status.startsWith("Enter the class code from the slide"), e.status);
  await ctx.close();
}
{
  const g = await open(P06, { live: true, code: "LOCAL1" });
  await g.page.waitForFunction(() => document.getElementById("badge").textContent === "Live AI on");
  const game = await playGame(g.page);
  check("06 live: 8 briefings from the server", game.slice(0, 8).every(([s, b]) => s === "AI briefing" && b.startsWith("LIVE BRIEFING")), game[0].join(" / "));
  check("06 live: debrief from the server", game[8][1].startsWith("LIVE DEBRIEF"), game[8][1].slice(0, 60));
  // a second game on the same device: 2 more briefings pass, the debrief allowance is spent
  await g.page.reload(); // same browser, same device id
  await g.page.waitForFunction(() => document.getElementById("badge").textContent === "Live AI on");
  const again = await playGame(g.page);
  check("06 live: 11th briefing in the hour falls back with a reason", again[2][0] === "(offline summary · This device has reached its live-AI limit for now)", again[2][0]);
  check("06 live: second debrief in the hour falls back with a reason", again[8][1].startsWith("(offline assessment · This device has reached its live-AI limit for now)\nYou ended 2021"), again[8][1].slice(0, 90));
  await g.ctx.close();
}
await control({ enabled: false });
{
  const { page, ctx } = await open(P03, { live: true, code: "LOCAL1" });
  await page.waitForTimeout(500);
  check("03 control off: badge 'Offline mode', code field hidden", (await page.textContent("#badge")) === "Offline mode" && !(await page.isVisible("#classCode")));
  const r = await decompose(page, "Financial controller");
  check("03 control off: 'Live AI is off' + worked example", r.status.startsWith("Live AI is off — loaded a worked example"), r.status);
  await ctx.close();
  const g = await open(P06, { live: true, code: "LOCAL1" });
  await g.page.click("#resolveBtn");
  await g.page.waitForFunction(() => document.getElementById("briefStatus").textContent !== "Reading the quarter…");
  check("06 control off: '(offline summary · Live AI is off)'", (await g.page.textContent("#briefStatus")) === "(offline summary · Live AI is off)");
  await g.ctx.close();
}
await control({ enabled: true, closes_at: new Date(Date.now() - 60000).toISOString() });
{
  const { page, ctx } = await open(P03, { live: true, code: "LOCAL1" });
  const r = await decompose(page, "Radiologist");
  check("03 outside window: reason shown", r.status.startsWith("Live AI is outside today’s session window"), r.status);
  await ctx.close();
}
await control({ closes_at: null, budget_usd: 0 });
{
  const { page, ctx } = await open(P03, { live: true, code: "LOCAL1" });
  const r = await decompose(page, "Radiologist");
  check("03 budget spent: reason shown, worked example", r.status.startsWith("Today’s live-AI budget is spent — loaded"), r.status);
  await ctx.close();
}
await control({ budget_usd: 5 });

const usage = await (await fetch(BASE + "/__usage")).json();
const ok = usage.filter((u) => u.status === 200);
check("usage rows record tokens and cost", ok.length > 0 && ok.every((u) => u.input_tokens === 320 && u.output_tokens === 640 && Math.abs(u.cost_usd - 0.00704) < 1e-9));
console.log(`\nusage log: ${usage.length} rows; statuses ${JSON.stringify(usage.reduce((a, u) => ((a[u.status + " " + (u.reason ?? "ok")] = (a[u.status + " " + (u.reason ?? "ok")] || 0) + 1), a), {}))}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall page checks passed");
process.exit(failures ? 1 : 0);
