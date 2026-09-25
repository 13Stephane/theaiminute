/* live-room · the parts of a room instrument that are not about the room
 *
 * Extracted from A nova curva after Barcelona, 15 September 2026, where three
 * of the four mechanisms below were written twice and the fourth was written
 * during the session. Nothing here knows about curves, tables or cards: it is
 * the mechanical residue of running an instrument that forty people fill in at
 * once, on their own phones, while a facilitator stands in front of them.
 *
 * Each export encodes one lesson that otherwise has to be re-remembered:
 *
 *   missing()    a refusal that does not name its cause reads as a broken app
 *   autosend()   an unsent draft is lost data; there is no submit button
 *   present()    show what the room did, not what the configuration planned
 *   partial()    a fixture sized from the live config, never from a literal
 *   dayCode()    a read-only code for a screen that cannot hold the key
 *
 * Loaded the same way as a rules file: a classic script on the page, a
 * side-effect import in the Worker and in tests. It attaches itself to
 * globalThis.LIVEROOM and touches nothing else.
 */
(function (root) {
"use strict";

const arr = x => Array.isArray(x) ? x : [];

/* ---------------------------------------------------------------- debounce */

/* One timer per key, so a handler that fires on every keystroke sends once.
   Keys are the caller's: "wall", "curve", "sortauto". */
const TIMERS = Object.create(null);
function cancelDebounce(key) {
  clearTimeout(TIMERS[key]);
  delete TIMERS[key];
}
function debounce(key, ms, fn) {
  cancelDebounce(key);
  TIMERS[key] = setTimeout(() => { delete TIMERS[key]; fn(); }, ms);
  return () => cancelDebounce(key);
}
const pendingDebounce = key => TIMERS[key] != null;

/* ----------------------------------------------------------------- missing */

/* What still stops this from going, in the room's own words.
 *
 * One call drives both halves of the same truth: `ok` disables the button,
 * `line` says why it is disabled. An instrument that refuses without naming
 * what is missing is indistinguishable from one that is broken, and the person
 * holding the phone has no way to tell the difference.
 *
 * Each check is { ok, say }: the thing is fine when `ok` is truthy, and `say`
 * names it when it is not. Order the checks the way the screen is ordered, so
 * the first thing named is the first thing the eye finds.
 */
function missing(checks, o) {
  o = o || {};
  const names = arr(checks)
    .filter(c => c && !c.ok)
    .map(c => String(c.say == null ? "" : c.say).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    ok: names.length === 0,
    missing: names,
    line: names.length
      ? (o.prefix || "") + names.join(o.join || " · ") + (o.end == null ? "." : o.end)
      : "",
  };
}

/* ---------------------------------------------------------------- autosend */

/* Sends itself once it is complete, and again after every change.
 *
 * A draft the participant believes is in, and the instrument holds as unsent,
 * is the same as lost data: the projector shows nothing and the room concludes
 * the app is broken. Removing the button removes the failure.
 *
 * Wiring: call changed() from wherever state is saved. The sender runs when
 * the entry is valid, never twice for the same payload, and never on top of
 * itself. A failed send leaves the payload unsent, so the next change retries.
 *
 *   o.ready()     is this entry complete and valid (the same rules the server enforces)
 *   o.payload()   what would be sent, right now
 *   o.send(p)     the actual call; may throw or reject
 *   o.signature   payload to string; defaults to JSON
 *   o.wait        quiet period in ms before sending, default 1200
 *   o.onSent(p)   after a send the server accepted
 *   o.onError(e)  after a send that failed; the payload stays unsent
 */
function autosend(o) {
  o = o || {};
  const key = o.key || "autosend";
  const wait = o.wait == null ? 1200 : o.wait;
  const sign = o.signature || (p => JSON.stringify(p));
  let sentSig = null, inflight = false;

  async function attempt() {
    if (inflight) return false;
    if (typeof o.ready === "function" && !o.ready()) return false;
    const payload = typeof o.payload === "function" ? o.payload() : null;
    const sig = sign(payload);
    /* nothing new to say */
    if (sig === sentSig) return false;
    inflight = true;
    try {
      await o.send(payload);
      sentSig = sig;
      if (o.onSent) o.onSent(payload);
      return true;
    } catch (e) {
      /* it stays unsent on purpose: the next change tries again */
      if (o.onError) o.onError(e);
      return false;
    } finally {
      inflight = false;
    }
  }

  return {
    /* call after every edit; quiet for `wait`, then sends if it is ready */
    changed() { debounce(key, wait, attempt); },
    /* send now, without waiting out the quiet period */
    flush() { cancelDebounce(key); return attempt(); },
    /* the server already holds this one (a poll said so, or another device sent it) */
    markSent(payload) { sentSig = sign(payload); },
    /* a new session, a new participant: forget what was sent */
    reset() { sentSig = null; },
    get pending() { return pendingDebounce(key) || inflight; },
    get sentSignature() { return sentSig; },
  };
}

/* ----------------------------------------------------------------- present */

/* What the room actually entered, and what it left alone.
 *
 * Sixteen cards were printed and twelve were sorted. An untouched item is not
 * a zero and not a low score: it is absent, and a display that reads it as a
 * value invents a finding nobody made. Split the two, show the first, and say
 * the second out loud rather than dropping it quietly.
 *
 *   o.seen(item)  did the room touch this one; default: truthy item
 *   o.name(item)  how to name an absent one; default: String(item)
 */
function present(items, o) {
  o = o || {};
  const seen = typeof o.seen === "function" ? o.seen : (x => !!x);
  const name = typeof o.name === "function" ? o.name : (x => String(x));
  const shown = [], absent = [];
  for (const it of arr(items)) (seen(it) ? shown : absent).push(it);
  return { shown, absent, names: absent.map(name), complete: absent.length === 0 };
}

/* ----------------------------------------------------------------- partial */

/* An incomplete entry, sized from the configuration in front of you.
 *
 * A rehearsal that takes "the first fifteen" is a partial entry in a room of
 * sixteen cards and a complete one in a room of twelve, where it stops testing
 * what it claims to test and starts overwriting real answers. Ask for what you
 * mean: all but one. Throws rather than returning something complete.
 */
function partial(list, leaveOut) {
  const xs = arr(list), k = leaveOut == null ? 1 : leaveOut;
  if (!(k >= 1)) throw new Error("partial: leaveOut must be at least 1");
  if (xs.length <= k) throw new Error(`partial: ${xs.length} items cannot leave out ${k}`);
  return xs.slice(0, xs.length - k);
}

/* ----------------------------------------------------------------- dayCode */

/* A short code for a screen that cannot hold the key.
 *
 * The projector is a room computer the facilitator does not own and will not
 * type a secret into. This derives a code from the key and the date: it opens
 * whatever reads you scope it to, it lapses at midnight UTC, and it can be
 * read aloud. No letters that look like other letters.
 *
 * It is four characters. Treat it as a door code, never as a password: gate
 * reads with it, never writes, and never anything a room should not see.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const today = () => new Date().toISOString().slice(0, 10);

async function dayCode(o) {
  o = o || {};
  if (!o.secret) throw new Error("dayCode: no secret");
  const alphabet = o.alphabet || CODE_ALPHABET;
  const length = o.length || 4;
  const bytes = new TextEncoder().encode(`${o.secret}:${o.purpose || "code"}:${o.day || today()}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h.slice(0, length), b => alphabet[b % alphabet.length]).join("");
}

/* Length-independent compare, so a wrong code never leaks its length by timing. */
function sameSecret(a, b) {
  const x = String(a == null ? "" : a), y = String(b == null ? "" : b);
  if (!x || !y) return false;
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    diff |= x.charCodeAt(i % x.length) ^ y.charCodeAt(i % y.length);
  return diff === 0 && x.length === y.length;
}

/* Typed on a phone, read off a projector: case and spaces do not count. */
async function codeOk(o) {
  o = o || {};
  const length = o.length || 4;
  const got = String(o.got == null ? "" : o.got).replace(/\s+/g, "").toUpperCase();
  if (got.length !== length || !o.secret) return false;
  return sameSecret(got, await dayCode(o));
}

root.LIVEROOM = {
  debounce, cancelDebounce, pendingDebounce,
  missing,
  autosend,
  present,
  partial,
  CODE_ALPHABET, dayCode, codeOk, sameSecret,
};
})(typeof globalThis !== "undefined" ? globalThis : this);
