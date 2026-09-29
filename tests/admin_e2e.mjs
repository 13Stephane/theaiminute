// Control-room checks in Chromium against tests/local_server.ts.
// supabase-js is replaced by a stub whose session carries a test token.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Playwright from the repo (npm install --no-save playwright) or from a global install.
let playwright;
try { playwright = require("playwright"); } catch {
  const { execSync } = require("node:child_process");
  playwright = require(execSync("npm root -g").toString().trim() + "/playwright");
}

const BASE = "http://localhost:8787";
try { await fetch(BASE + "/__usage"); } catch {
  console.error("The local server is not running. In another terminal, from the repository folder, run:\n" +
    "  deno run --allow-net --allow-read --allow-env tests/local_server.ts");
  process.exit(1);
}
const shot = process.argv[2];
let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? "  -> " + detail : ""}`);
  if (!cond) failures++;
};
const stub = (token, email) => `window.supabase={createClient:()=>({auth:{
  getSession:async()=>({data:{session:${token ? `{access_token:"${token}",user:{email:"${email}"}}` : "null"}}}),
  onAuthStateChange:()=>{},signOut:async()=>{},signInWithOtp:async(a)=>{window.__otp=a;return{error:null};}}})};`;

async function open(browser, token, email) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ body: stub(token, email), contentType: "text/javascript" }));
  await page.route(BASE + "/config.js", (r) => r.fulfill({ body: `var SUPABASE_URL="${BASE}";var SUPABASE_ANON="anon";`, contentType: "text/javascript" }));
  await page.goto(BASE + "/admin/");
  return { page, ctx };
}

await fetch(BASE + "/__control", { method: "POST", body: JSON.stringify({ enabled: false, opens_at: null, closes_at: null, budget_usd: 5 }) });
const browser = await playwright.chromium.launch();

{ // signed out
  const { page, ctx } = await open(browser, null);
  check("signed out: sign-in form shown, room hidden", await page.isVisible("#email") && !(await page.isVisible("#toggle")));
  await page.fill("#email", "admin@local.test");
  await page.click("#sendLink");
  const otp = await page.evaluate(() => window.__otp);
  check("magic link requested, redirect to /admin/, no new users", otp.options.emailRedirectTo === BASE + "/admin/" && otp.options.shouldCreateUser === false, JSON.stringify(otp));
  await ctx.close();
}
{ // a signed-in stranger
  const { page, ctx } = await open(browser, "local-other", "other@local.test");
  await page.waitForFunction(() => document.getElementById("msg").textContent.length > 0);
  check("other address: refused, nothing shown", /not the control-room admin/.test(await page.textContent("#msg")));
  await page.click("#toggle");
  await page.waitForTimeout(300);
  const c = await (await fetch(BASE + "/__control", { method: "POST", body: "{}" })).json();
  check("other address: switch press changed nothing", c.enabled === false);
  await ctx.close();
}
{ // the admin
  const { page, ctx } = await open(browser, "local-admin", "admin@local.test");
  await page.waitForFunction(() => document.getElementById("state").textContent !== "…");
  check("admin: room shown, switch off", (await page.textContent("#state")) === "Live AI off" && (await page.textContent("#reason")).startsWith("Switched off"));
  await page.click("#toggle");
  await page.waitForFunction(() => document.getElementById("state").textContent === "Live AI on");
  check("admin: big switch turns live AI on", true);

  // window presets are Copenhagen time even though this browser is in New York
  await page.click("#today");
  const today = await page.inputValue("#opens");
  await page.click("#saveWindow");
  await page.waitForFunction(() => /Window saved/.test(document.getElementById("msg").textContent));
  let c = await (await fetch(BASE + "/__control", { method: "POST", body: "{}" })).json();
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(c.opens_at));
  check("window: 'today 08:30' saved as 08:30 Copenhagen", today.endsWith("T08:30") && p === "08:30", `${today} -> ${c.opens_at} (${p} CPH)`);
  const pc = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(c.closes_at));
  check("window: closes 16:30 Copenhagen", pc === "16:30", c.closes_at);
  await page.click("#tomorrow");
  await page.click("#saveWindow");
  await page.waitForFunction(() => /outside the session window/.test(document.getElementById("reason").textContent));
  check("window tomorrow: live AI is off now, reason given", (await page.textContent("#state")) === "Live AI off");
  await page.click("#clearWindow");
  await page.waitForFunction(() => document.getElementById("state").textContent === "Live AI on");

  // class code
  await page.click("#rotate");
  await page.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.getElementById("code").textContent));
  const code = await page.textContent("#code");
  await page.click("#copyCode");
  check("class code: rotated to six characters and copied", (await page.evaluate(() => navigator.clipboard.readText())) === code, code);
  const ok = await fetch(BASE + "/functions/v1/ai", {
    method: "POST",
    headers: { origin: "http://localhost:8787", "x-class-code": code, "x-device-id": "admin-e2e-device", "content-type": "application/json" },
    body: JSON.stringify({ kind: "03.decompose", inputs: { job: "Marketing manager" } }),
  });
  check("class code: the new code opens the gate", ok.status === 200, String(ok.status));

  // budget and log
  await page.fill("#budget", "7.5");
  await page.click("#saveBudget");
  await page.waitForFunction(() => /Budget saved/.test(document.getElementById("msg").textContent));
  await page.waitForFunction(() => document.querySelectorAll("#log tr td.s200").length > 0, null, { timeout: 12000 });
  check("budget saved and spend shown by artifact", /of \$7\.50/.test(await page.textContent("#spent")) && /Artifact 03: \$0\.\d{3} · \d+ calls/.test(await page.textContent("#split")), await page.textContent("#split"));
  const row = await page.$eval("#log tr", (tr) => tr.innerText);
  check("live log shows the call with tokens and cost", /03\t03\.decompose\tadmin-e2\t200\t320\t640\t\$0\.0070/.test(row), row);
  await page.click("#resetBudget");
  await page.waitForFunction(() => /Spend reset/.test(document.getElementById("msg").textContent));
  check("reset: spend back to zero", (await page.textContent("#spent")).startsWith("$0.000"));
  if (shot) {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.click("#today");
    await page.screenshot({ path: shot, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall control-room checks passed");
process.exit(failures ? 1 : 0);
