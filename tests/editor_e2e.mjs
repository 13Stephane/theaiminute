// editor.html in Chromium, served at its real address with Supabase stubbed:
// sign-in by email link, editor-only access, and no key but the anon key.
//   npm install --no-save playwright && npx playwright install chromium
//   node tests/editor_e2e.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch {
  const { execSync } = require("node:child_process");
  playwright = require(execSync("npm root -g").toString().trim() + "/playwright");
}

const SITE = "https://www.theaiminute.blog";
const SB = "https://kcobpakjfluuyfzswtoq.supabase.co";
const html = readFileSync(new URL("../editor.html", import.meta.url), "utf8");
let failures = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? "  -> " + detail : ""}`);
  if (!cond) failures++;
};
const role = (jwt) => { try { return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url")).role; } catch { return null; } };

// The page source itself.
const jwts = html.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || [];
check("page holds no service-role key", jwts.every((j) => role(j) === "anon") && jwts.length === 1, jwts.map(role).join(","));
check("page holds no Mistral key or passwords", !/api\.mistral\.ai|eyQwREk|changeme-|PASSWORDS/.test(html));

const STUB = `window.supabase={createClient:()=>({auth:{
  getSession:async()=>({data:{session:window.__session||null}}),
  onAuthStateChange:(f)=>{setTimeout(()=>f('INITIAL_SESSION',window.__session||null),0);return{data:{subscription:{unsubscribe(){}}}};},
  signOut:async()=>{window.__signedOut=(window.__signedOut||0)+1;window.__session=null;return{error:null};},
  signInWithOtp:async(a)=>{window.__otp=a;return{error:null};}}})};`;

const browser = await playwright.chromium.launch();
async function open(session) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const seen = [];
  await page.route(SITE + "/editor", (r) => r.fulfill({ body: html, contentType: "text/html; charset=utf-8" }));
  await page.route(SITE + "/*.{png,jpeg,jpg}", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/**", (r) => r.fulfill({ body: STUB, contentType: "text/javascript" }));
  // The rich-text editor is not under test; a stand-in keeps the check offline.
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/quill/**", (r) => r.fulfill({ contentType: "text/javascript",
    body: "window.Quill=class{constructor(sel){this.root=document.querySelector(sel);this.root.contentEditable='true';this.root.innerHTML='<p><br></p>';}};" }));
  await page.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**", (r) => r.fulfill({ body: "", contentType: "text/javascript" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://api.mistral.ai/**", (r) => { seen.push({ url: r.request().url(), headers: r.request().headers() }); r.abort(); });
  await page.route(SB + "/**", async (r) => {
    const req = r.request(), url = req.url(), token = (req.headers().authorization || "").replace("Bearer ", "");
    seen.push({ url, method: req.method(), headers: req.headers(), body: req.postData() });
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const cors = { "access-control-allow-origin": "*" };
    if (url.includes("/rest/v1/editors")) return r.fulfill({ json: token === "tok-hanne" ? [{ author: "hanne" }] : [], headers: cors });
    if (url.includes("/rest/v1/posts") && req.method() === "GET") return r.fulfill({ json: [{ id: 7, title: "A draft", status: "draft", author: "hanne", created_at: new Date().toISOString(), hashtags: [] }], headers: cors });
    if (url.includes("/rest/v1/posts")) return r.fulfill({ status: 201, json: [{ id: 8 }], headers: cors });
    if (url.includes("/functions/v1/compose")) return r.fulfill({ json: { text: '{"title":"Boards ask the wrong question","body":"Hook.\\n\\nInsight.","hashtags":["#AI","#Boards"]}' }, headers: cors });
    if (url.includes("/storage/v1/object/")) return r.fulfill({ json: { Key: "media/x" }, headers: cors });
    return r.fulfill({ status: 404, body: "" });
  });
  if (session) await page.addInitScript((s) => { window.__session = s; }, session);
  await page.goto(SITE + "/editor");
  return { page, ctx, seen };
}

{ // signed out
  const { page, ctx, seen } = await open(null);
  await page.waitForTimeout(300);
  check("signed out: sign-in screen, no app", await page.isVisible("#email-input") && !(await page.isVisible("#app")));
  await page.fill("#email-input", "hanne@example.com");
  await page.click("#signin-btn");
  await page.waitForFunction(() => window.__otp);
  const otp = await page.evaluate(() => window.__otp);
  check("sends an email link back to /editor, creates no users",
    otp.email === "hanne@example.com" && otp.options.emailRedirectTo === SITE + "/editor" && otp.options.shouldCreateUser === false, JSON.stringify(otp));
  check("message tells them to check their inbox", /Check your inbox/.test(await page.textContent("#lock-error")));
  check("signed out: nothing sent to the database", seen.length === 0, seen.map((s) => s.url).join(", "));
  await ctx.close();
}
{ // signed in, but not an editor
  const { page, ctx } = await open({ access_token: "tok-stranger", user: { email: "someone@example.com" } });
  await page.waitForFunction(() => /not an editor/.test(document.getElementById("lock-error").textContent));
  check("a non-editor is told so and signed out", (await page.evaluate(() => window.__signedOut)) >= 1 && !(await page.isVisible("#app")));
  await ctx.close();
}
{ // an editor
  const { page, ctx, seen } = await open({ access_token: "tok-hanne", user: { email: "hanne@example.com" } });
  await page.waitForFunction(() => document.getElementById("app").style.display === "block");
  check("an editor lands in the app as their author", (await page.textContent("#author-indicator-name")) === "Hanne");
  await page.waitForFunction(() => document.body.innerText.includes("A draft"));
  check("drafts load for the editor", true);

  await page.fill("#idea-input", "Boards optimise for cost when the value sits elsewhere");
  await page.click("#compose-btn");
  await page.waitForFunction(() => /Boards ask the wrong question/.test(document.getElementById("composer-result").textContent));
  const comp = seen.find((s) => s.url.endsWith("/functions/v1/compose") && s.method === "POST");
  const cbody = JSON.parse(comp.body);
  check("the Composer goes through the compose function", !!comp && /Hanne Breddam/.test(cbody.system) && /Idea: Boards optimise/.test(cbody.user));

  await page.fill("#f-title", "Boards ask the wrong question");
  await page.evaluate(() => { qSingle.root.innerHTML = "<p>Body</p>"; });
  await page.click("text=Save Post");
  await page.waitForFunction(() => document.getElementById("toast").textContent.includes("Saved"), null, { timeout: 5000 }).catch(() => {});
  const save = seen.find((s) => s.url.endsWith("/rest/v1/posts") && s.method === "POST");
  check("saving a post writes as the editor", !!save && JSON.parse(save.body).author === "hanne", save && save.body.slice(0, 80));

  const sent = seen.filter((s) => s.method !== "OPTIONS");
  check("every request carries the anon key and the editor's own token",
    sent.length >= 4 && sent.every((s) => role(s.headers.apikey) === "anon" && s.headers.authorization === "Bearer tok-hanne"),
    sent.map((s) => `${s.method} ${s.url.replace(SB, "")} ${role(s.headers.apikey)} ${s.headers.authorization}`).join(" | "));
  check("nothing goes to Mistral from the browser", !seen.some((s) => s.url.includes("mistral")));

  await page.click("text=Log out");
  await page.waitForTimeout(200);
  check("log out signs out of Supabase", (await page.evaluate(() => window.__signedOut)) >= 1 && await page.isVisible("#email-input"));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall editor checks passed");
process.exit(failures ? 1 : 0);
