/* A nova curva · the rules engine
 *
 * One file, loaded three ways: by index.html as a classic script, by the Worker
 * through a side-effect import, and by the tests. It attaches itself to
 * globalThis.NCRULES and touches nothing else. One copy on purpose: the phone
 * uses it to explain, the Worker uses it to refuse.
 *
 * The room, as of change request 3 (13 September):
 *   today's line  placed by show of hands against Odontoprev, entered once
 *   the sort      argued at each table on paper; after the reveal its relator
 *                 records where the table left each of the sixteen cards, or
 *                 sem acordo. One entry per table, never per person.
 *   the wall      six given cards and up to three new ones per table; bound or
 *                 generic, and for a bound card whether it is getting scarcer
 *   the curve     each person's own, every move citing what the room decided
 *
 * The four places are categories. This file counts them, finds the most common
 * one, and counts how many tables put a card where the machine can do it; it
 * never averages them.
 *
 * No AI anywhere. What the report says about the room is derived here, by
 * rules the facilitator can read, from the room's own sort, wall and moves.
 */
(function (root) {
"use strict";

const ZONES = ["submerso", "linha", "polder", "rocha"];
/* a card the table could not agree on goes to the board: recorded, never a place */
const SORT_STATES = ZONES.concat(["sem_acordo"]);
const ZONE_PT = { submerso: "submerso", linha: "linha d'água", polder: "pôlder", rocha: "rocha firme", sem_acordo: "sem acordo" };
const ZONE_EN = { submerso: "under water", linha: "at the line", polder: "polder", rocha: "bedrock", sem_acordo: "no agreement" };
/* slide 22, in the room's words */
const ZONE_DO_PT = { submerso: "automatizar", linha: "aumentar", polder: "manter humano, por escolha", rocha: "nenhuma máquina consegue", sem_acordo: "vai para o quadro" };
const ZONE_DO_EN = { submerso: "automate it", linha: "augment it", polder: "hold it, by choice", rocha: "no machine can", sem_acordo: "goes to the board" };
const ZONE_WHY_PT = {
  submerso: "A máquina faz tão bem como nós. O custo cai para o preço do cálculo, para todos os rivais ao mesmo tempo.",
  linha: "A máquina rascunha, lê ou encaminha. Um dentista autoriza.",
  polder: "Uma máquina conseguiria, e escolhemos manter humano. Custa, e alguém tem de pagar.",
  rocha: "O corpo, a lei: presença, consentimento, a assinatura responsável.",
  sem_acordo: "A mesa não chegou a acordo. O cartão vai para o quadro e não conta para nenhum lado.",
};
/* the bands, by how many tables put a card where the machine can do it */
const BAND_PT = { settled: "assente", contested: "em disputa", held: "resiste" };
const BAND_EN = { settled: "settled", contested: "contested", held: "held" };

/* Change request 4: on the seven axes, two moves only, reduzir and elevar.
   Criar is not a move on an existing axis: an axis you never had is not at
   zero, it does not exist. A created axis arrives on its own, with a name and
   a wall card (validateCreate). Eliminate went on 13 September. A phone still
   sending either is refused as an unknown direction. */
const LOWER = ["reduce"];
const UPPER = ["raise"];
const DIRECTIONS = LOWER.concat(UPPER);
const DIR_PT = { reduce: "reduzir", raise: "elevar", create: "criar" };
const DIR_EN = { reduce: "reduce", raise: "raise", create: "create" };

const BUYERS = ["employer", "beneficiary"];
const BUYER_PT = { employer: "o empregador", beneficiary: "o beneficiário" };
const BUYER_EN = { employer: "the employer", beneficiary: "the beneficiary" };

/* Today's line. At 0:16 the room places itself on every axis, blind, by show
   of hands: above Odontoprev, level, or below. Five positions, the rival at
   the middle; today's line sits one step either side, or on it. */
const PLACEMENT = ["above", "level", "below"];
const PLACEMENT_VALUE = { above: 3, level: 2, below: 1 };
const PLACEMENT_PT = { above: "acima", level: "igual", below: "abaixo" };
const RIVAL_VALUE = 2;
const SCALE_PT = ["muito abaixo", "abaixo", "igual", "acima", "muito acima"];
const SCALE_EN = ["far below", "below", "level", "above", "far above"];

/* The wall: how a table answers each given card, and for a bound card its arrow. */
const WALL_STATES = ["ligado", "generico", "fora"];
const WALL_STATE_PT = { ligado: "ligado a nós", generico: "genérico", fora: "fora" };
const WALL_ARROWS = ["escasso", "estavel", "abundante"];
const WALL_ARROW_PT = { escasso: "mais escasso", estavel: "estável", abundante: "mais abundante" };

/* Change request 5: the table's commitment is one choice between two. */
const COMMIT_OPTIONS = ["polder", "raise"];
const COMMIT_PT = { polder: "um pôlder que vocês financiam", raise: "uma elevação que vocês financiam e guardam" };
const COMMIT_TAG = { polder: "pôlder", raise: "elevação" };

const LIMITS = {
  MIN_LOWER: 1, NOTE_MAX: 140, REASON_MAX: 140,
  WALL_NAME_MAX: 60, TABLES: 6,
  AXIS_NAME_MAX: 60,        /* a created axis: what the buyer would see on a proposal */
  CREATED_PER_TABLE: 2,     /* one is too tight, three is a wish list */
  COMMIT_TEXT_MAX: 140, REVIEW_DAYS: 90,
  WALL_ROWS: 3,             /* new cards a table may add, beyond the six given */
  MIN_SORT: 1,              /* one table's sort is already a decision */
  VALUE_MIN: 0, VALUE_MAX: 4,   /* five positions against the rival: 0 far below, 2 level, 4 far above */
};

/* Every message the room can see, Portuguese first. */
const MSG = {
  direction:        ["Escolha a direção do movimento.", "Pick the direction of the move."],
  value:            ["A posição vai de muito abaixo a muito acima.", "The position runs from far below to far above."],
  lower_not_below:  ["Uma baixa tem de ficar abaixo da curva de hoje.", "A lower move has to sit below today's line."],
  upper_not_above:  ["Uma elevação tem de ficar acima da curva de hoje.", "A raise has to sit above today's line."],
  lower_needs_flood:["Baixar exige citar um cartão que as mesas puseram debaixo de água ou na linha d'água. Ou marque «só oferta» e diga porquê.",
                     "A lower move must cite a card the tables put under water or at the line. Or mark it offer-only and say why."],
  lower_untagged_axis:["Nenhum cartão da triagem produz este eixo, por isso a automação não o pode baixar. Se o baixar, é uma decisão de oferta: marque «só oferta» e diga porquê.",
                     "No card in the sort produces this axis, so automation cannot lower it. Lowering it is an offer decision: mark it offer-only and say why."],
  offer_reason:     ["«Só oferta» precisa de uma linha a dizer porquê, até 140 caracteres.", "Offer-only needs one line saying why, 140 characters at most."],
  upper_needs_wall: ["Elevar exige citar um cartão do muro da sala.", "A raise must cite a card from the room's wall."],
  upper_needs_scarce:["Elevar ou criar exige um cartão do muro que seja nosso e esteja ficando mais escasso. Um cartão genérico, ou nosso mas mais abundante, não sustenta o preço.",
                     "A raise or create needs a wall card that is ours and getting scarcer. A generic card, or ours but more abundant, does not hold the price."],
  axis_name:        ["Dê um nome ao eixo, até 60 caracteres: o que o comprador veria numa proposta.", "Name the axis, 60 characters at most: what the buyer would see on a proposal."],
  axis_needs_wall:  ["Um eixo novo precisa de um cartão do muro que seja nosso e esteja ficando mais escasso. Um eixo que não se entrega a partir de algo nosso é um slogan.",
                     "A new axis needs a wall card that is ours and getting scarcer. An axis you cannot deliver from something you own is a slogan."],
  polder_not_kept:  ["O cartão de pôlder tem de ser um que as mesas guardaram no pôlder.", "The polder card must be one the tables kept in the polder."],
  axis_cap:         ["A mesa já criou dois eixos. Apoie um deles.", "The table has already created two axes. Back one of them."],
  axis_exists:      ["A mesa já tem este eixo. Apoie-o.", "The table already has this axis. Back it."],
  /* change request 5: the three sentences first */
  commit_raise_bill: ["Elevação sem conta é ambição. Digam com que se paga: um cartão que a mesa pôs debaixo de água ou uma baixa que a mesa fez.",
                      "A raise without a bill is an ambition. Say what pays for it: a card the table put under water, or a reduction the table made."],
  commit_raise_guard:["Sem guarda, dura até a próxima concorrência. O guarda é um cartão do muro nosso e mais escasso.",
                      "Without a guard, it lasts until the next tender. The guard is a wall card that is ours and getting scarcer."],
  commit_polder_bill:["Pôlder sem conta é desejo. Digam com que se paga: um cartão debaixo de água, uma baixa, ou uma linha de orçamento.",
                      "A polder without a bill is a wish. Say what pays for it: a card under water, a reduction, or a budget line."],
  commit_same_axis: ["Um eixo não se paga baixando o próprio eixo. A conta tem de vir de outro sítio.", "An axis is not paid for by lowering the same axis. The bill has to come from somewhere else."],
  commit_option:    ["Escolham primeiro: A, um pôlder que vocês financiam, ou B, uma elevação que vocês financiam e guardam.", "Choose first: A, a polder you fund, or B, a raise you fund and guard."],
  commit_polder:    ["Digam qual é o pôlder: um eixo criado pela mesa, ou um cartão que a mesa guardou no pôlder.", "Say which polder: an axis the table created, or a card the table kept in the polder."],
  commit_raise:     ["Digam que eixo sobe e o que o comprador veria.", "Say which axis goes up and what the buyer would see."],
  commit_know:      ["Como saberemos? Uma linha.", "How will we know? One line."],
  commit_price:     ["O preço disso: o que deixam de fazer para o pagar.", "What it costs: what you stop doing to pay for it."],
  commit_owner:     ["Quem é o responsável?", "Who owns it?"],
  commit_date:      ["Uma data de revisão.", "A review date."],
  commit_text:      ["Cada campo tem no máximo 140 caracteres.", "Each field is 140 characters at most."],
  unknown_citation: ["Uma das citações já não existe no muro ou na triagem da sala.", "One of the citations is no longer on the room's wall or sort."],
  note_long:        ["A nota tem no máximo 140 caracteres.", "The note is 140 characters at most."],
  needs_lower:      ["Uma curva elevada em todo lado é uma estrutura de custos, não uma estratégia. Pelo menos uma baixa.",
                     "A curve raised everywhere is a cost structure, not a strategy. At least one lower move."],
  needs_buyer:      ["Escolha o comprador: o empregador ou o beneficiário. Um, não os dois.", "Choose the buyer: the employer or the beneficiary. One, not both."],
  amber:            ["Um ativo que é nosso mas não está ficando escasso não sustenta o preço por três anos.",
                     "An asset that is ours but not getting scarcer will not hold the price for three years."],
};
const msgPt = code => (MSG[code] || [code])[0];
const msgEn = code => (MSG[code] || [code, code])[1];

/* ------------------------------------------------------------------ helpers */

const arr = x => Array.isArray(x) ? x : [];
function index(list, key) {
  const k = key || "id", out = {};
  for (const x of arr(list)) if (x && x[k] != null) out[x[k]] = x;
  return out;
}
const uniq = xs => Array.from(new Set(xs));
const isNum = v => typeof v === "number" && isFinite(v);

/* The most common item and how often, ties broken alphabetically so the
   projector never flickers between two equal answers on a re-poll. */
function modal(items) {
  const c = {};
  for (const x of items) if (x != null && x !== "") c[x] = (c[x] || 0) + 1;
  const keys = Object.keys(c);
  if (!keys.length) return null;
  keys.sort((a, b) => (c[b] - c[a]) || a.localeCompare(b));
  return { name: keys[0], count: c[keys[0]] };
}

function quantile(xs, q) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/* ---------------------------------------------------------------- the sort */

/* Each table's entry is {taskId: place | "sem_acordo"}. Per card: how many
   tables put it in each place, and how many could not agree. `n` on a card is
   the tables that placed it; the room's `n` is the tables that submitted. */
function sortCounts(tasks, responses) {
  const blank = () => ({ submerso: 0, linha: 0, polder: 0, rocha: 0, sem_acordo: 0, n: 0 });
  const counts = {};
  for (const t of arr(tasks)) counts[t.id] = blank();
  let n = 0;
  for (const r of arr(responses)) {
    let any = false;
    for (const id of Object.keys(r || {})) {
      const c = counts[id], z = r[id];
      if (!c) continue;
      if (z === "sem_acordo") { c.sem_acordo++; any = true; continue; }
      if (ZONES.indexOf(z) < 0) continue;
      c[z]++; c.n++; any = true;
    }
    if (any) n++;
  }
  return { counts, n };
}

/* Where most tables put a card, among those that placed it. A tie between
   under water and the line is still a flood (the machine at least drafts it);
   any other tie is a split, and a split carries nothing. Sem acordo is not a
   place and never counts here. */
function placeOf(c) {
  if (!c || !c.n) return { place: null, modes: [], top: 0 };
  const top = Math.max.apply(null, ZONES.map(z => c[z] || 0));
  const modes = ZONES.filter(z => (c[z] || 0) === top);
  let place = modes.length === 1 ? modes[0] : "tie";
  if (place === "tie" && modes.every(z => z === "submerso" || z === "linha")) place = "linha";
  return { place, modes, top };
}

/* Change request 3. Out of the tables that submitted:
     the machine can  tables placing the card under water or in the pôlder
     keep human       tables placing it in the pôlder
   Sem acordo is in neither numerator. The band, by the machine-can count:
   settled at 5 or 6 of 6, contested at 3 or 4, held at 2 or fewer, written as
   shares so a table that never submits does not break it. */
const machineOf = c => (c ? (c.submerso || 0) + (c.polder || 0) : 0);
const keepOf = c => (c ? (c.polder || 0) : 0);
function bandOf(c, N) {
  if (!N) return null;
  const m = machineOf(c);
  return m * 6 >= 5 * N ? "settled" : m * 2 >= N ? "contested" : "held";
}

/* Per card, for the console and the report: counts, the place and its share,
   the machine-can and keep-human counts, and the band. Most contested first. */
function tallySort(tasks, responses) {
  const sc = sortCounts(tasks, responses);
  const rows = arr(tasks).map((t, i) => {
    const c = sc.counts[t.id] || { submerso: 0, linha: 0, polder: 0, rocha: 0, sem_acordo: 0, n: 0 };
    const p = placeOf(c);
    const distinct = ZONES.filter(z => c[z] > 0).length;
    return { task: t, ord: t.ord != null ? t.ord : i, counts: c, n: c.n, place: p.place, modes: p.modes,
             modeCount: p.top, distinct, unanimous: c.n > 0 && distinct === 1 && !c.sem_acordo, offMode: c.n - p.top,
             machine: machineOf(c), keep: keepOf(c), band: bandOf(c, sc.n) };
  });
  rows.sort((a, b) => (b.offMode / Math.max(1, b.n) - a.offMode / Math.max(1, a.n)) || (b.distinct - a.distinct) || (a.ord - b.ord));
  return { rows, unanimous: rows.filter(r => r.unanimous).length, total: rows.length, n: sc.n };
}

/* ---------------------------------------------------------------- the wall */

const STOP = new Set(("o a os as de do da dos das e em no na nos nas um uma uns umas ao aos " +
                      "nosso nossa nossos nossas que com por para the of and our a an").split(" "));
const COMBINING = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
function nameTokens(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(COMBINING, "")
    .replace(/(\d)[.\s](\d{3})/g, "$1$2").replace(/\bmil\b/g, "000")
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter(w => w && !STOP.has(w)).map(w => w.slice(0, 5));
}
const tableOf = c => c.table_no != null ? c.table_no : c.table_group_id;

/* The same card, by its words: two key words in common, or every key word of
   the shorter name inside the longer. Accents, articles and plural endings
   are ignored. */
function sameCard(a, b) {
  const A = new Set(nameTokens(a)), B = new Set(nameTokens(b));
  if (!A.size || !B.size) return false;
  let inter = 0; A.forEach(w => { if (B.has(w)) inter++; });
  return inter >= 2 || inter === Math.min(A.size, B.size);
}

/* The room's wall, merged by itself: nobody arbitrates. Every table answers
   the six given cards (on its wall and bound, on its wall but generic, or
   left off), gives each bound card an arrow, and may add up to three of its
   own. A new card that names a given card counts as that card; new cards from
   different tables that name the same thing count as one.
     ON THE WALL  more than half the tables that entered a wall put it there
     BOUND        more of those tables said bound than generic; a tie is generic
     ARROW        the arrow most of the bound tables gave it; a tie goes to the
                  less scarce, so a raise never rests on a coin toss
   `s` is how many tables called it ours and scarcer. */
function wallGroups(entries, given) {
  const rows = arr(entries).filter(e => e && (e.given_id || String(e.name || "").trim())).slice()
    .sort((a, b) => (tableOf(a) - tableOf(b)) || ((a.ord || 0) - (b.ord || 0)) || String(a.id).localeCompare(String(b.id)));
  const N = new Set(rows.map(tableOf)).size;
  const clusters = arr(given).map(g => ({ id: g.id, name: g.name_pt || g.name, kind: "given", rows: [], names: [] }));
  const byGiven = index(clusters);
  const fresh = [];
  for (const e of rows) {
    if (e.given_id) { if (byGiven[e.given_id]) byGiven[e.given_id].rows.push(e); continue; }
    const g = clusters.find(c => sameCard(e.name, c.name));
    if (g) { g.rows.push(e); g.names.push(e.name); continue; }
    fresh.push(e);
  }
  const parent = fresh.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < fresh.length; i++) for (let j = i + 1; j < fresh.length; j++)
    if (sameCard(fresh[i].name, fresh[j].name)) parent[find(j)] = find(i);
  const sets = {};
  fresh.forEach((e, i) => { const r = find(i); (sets[r] = sets[r] || []).push(e); });
  for (const k of Object.keys(sets)) {
    const rs = sets[k];
    clusters.push({ id: rs.map(r => String(r.id)).sort()[0], name: modal(rs.map(r => r.name)).name, kind: "new", rows: rs, names: rs.map(r => r.name) });
  }
  const out = clusters.map(c => {
    const on = new Set(), bound = {};
    for (const r of c.rows) {
      if (r.fora === true || r.fora === 1) continue;
      const t = tableOf(r);
      on.add(t);
      if (r.ligado === true || r.ligado === 1) bound[t] = bound[t] || (WALL_ARROWS.indexOf(r.arrow) >= 0 ? r.arrow : null);
    }
    const bt = Object.keys(bound), n = on.size, m = bt.length;
    const tally = { escasso: 0, estavel: 0, abundante: 0 };
    bt.forEach(t => { if (bound[t]) tally[bound[t]]++; });
    const top = Math.max(tally.escasso, tally.estavel, tally.abundante);
    const arrow = !top ? null : ["abundante", "estavel", "escasso"].find(a => tally[a] === top);
    return { id: c.id, name: c.name, kind: c.kind, names: uniq([c.name].concat(c.names)), n, m, N,
             onWall: N > 0 && n * 2 > N, ligado: n > 0 && m * 2 > n, arrow, s: tally.escasso, arrows: tally,
             cards: c.rows, members: c.rows.map(r => r.id).concat(c.kind === "given" ? [c.id] : []) };
  });
  out.sort((a, b) => (b.onWall - a.onWall) || (b.n - a.n) || (b.m - a.m) || a.name.localeCompare(b.name));
  const onWall = out.filter(g => g.onWall);
  return { groups: out, onWall, ligadoCount: onWall.filter(g => g.ligado).length,
           scarceCount: onWall.filter(g => g.ligado && g.arrow === "escasso").length, nTables: N };
}

/* ---------------------------------------------------------------- the tide */

/* Unimed's figure, carried over. A card's reach is the share of the tables
   that put it where the machine can do it (under water or in the pôlder); its
   column stands at one minus that. The waterline is the median reach. No
   weighting of places: the same count as the bands. */
function reachOf(c, N) { return N ? machineOf(c) / N : null; }
function tide(tasks, sort) {
  const counts = (sort && sort.counts) || {}, N = (sort && sort.n) || 0;
  const rows = arr(tasks).map((t, i) => {
    const c = counts[t.id] || { submerso: 0, linha: 0, polder: 0, rocha: 0, sem_acordo: 0, n: 0 };
    const reach = reachOf(c, N), p = placeOf(c);
    return { task: t, ord: t.ord != null ? t.ord : i, counts: c, n: c.n, reach, height: reach == null ? null : 1 - reach,
             place: p.place, modes: p.modes, machine: machineOf(c), keep: keepOf(c), band: bandOf(c, N) };
  });
  rows.sort((a, b) => ((a.reach == null) - (b.reach == null)) || ((a.height || 0) - (b.height || 0)) || (a.ord - b.ord));
  const known = rows.filter(r => r.reach != null).map(r => r.reach);
  return { rows, waterline: known.length ? quantile(known, 0.5) : null, n: N };
}

/* -------------------------------------------------------------- the redraw */

/* What a participant may cite: the room's sort (each card's place, where most
   tables put it), the room's wall (its canonical cards), and the generic wall
   when the room has none. Degradation is not optional: no sort and every card
   is open, no wall and the generic list stands in, no pôlder and a create
   promotes from every card. Each time the move is tagged uncited, never blocked. */
function citeContext(o) {
  o = o || {};
  const sort = o.sort || { counts: {}, n: 0 };
  const minSort = o.minSort != null ? o.minSort : LIMITS.MIN_SORT;
  const taskMode = (sort.n || 0) >= minSort ? "room" : "fallback";
  const tasks = arr(o.tasks).map(t => {
    const c = (sort.counts || {})[t.id] || { submerso: 0, linha: 0, polder: 0, rocha: 0, sem_acordo: 0, n: 0 };
    const p = placeOf(c);
    return { id: t.id, code: t.code, label_pt: t.label_pt, label_en: t.label_en, short_pt: t.short_pt || t.label_pt,
             axis_tags: arr(t.axis_tags), counts: c, place: taskMode === "room" ? p.place : null, modes: p.modes,
             band: taskMode === "room" ? bandOf(c, sort.n) : null };
  });
  const polderMode = taskMode === "room" && tasks.some(t => t.place === "polder") ? "room" : "fallback";
  const named = arr(o.groups).filter(g => g && String(g.name || "").trim());
  const wallMode = named.length ? "room" : "fallback";
  const wall = wallMode === "room"
    ? named.map(g => ({ id: g.id, name: g.name, ligado: !!g.ligado, arrow: g.arrow || null, s: g.s || 0, n: g.n || 0,
                        members: arr(g.members).length ? arr(g.members) : [g.id], generic: false }))
    : arr(o.generic).map(g => ({ id: g.id, name: g.name_pt || g.name, name_en: g.name_en || "",
                                 ligado: !!(g.ligado != null ? g.ligado : g.solid), arrow: null, s: 0, n: 0, members: [g.id], generic: true }));
  const wallIndex = {};
  for (const g of wall) { wallIndex[g.id] = g; for (const m of g.members) wallIndex[m] = g; }
  return { taskMode, wallMode, polderMode, tasks, wall, wallIndex, nSort: sort.n || 0 };
}

/* Why one card can, or cannot, carry a lower move on one axis. */
function taskStanding(ctx, axisCode, t) {
  if (ctx.taskMode === "fallback") return "fallback";
  if (arr(t.axis_tags).indexOf(axisCode) < 0) return "untagged";
  return t.place || "none";
}
const carriesLower = s => s === "submerso" || s === "linha" || s === "fallback";
const lowerCandidates = (ctx, axisCode) => ctx.tasks.filter(t => carriesLower(taskStanding(ctx, axisCode, t)));
/* What a CREATE may promote: what the tables kept dry in the pôlder. */
const polderCandidates = ctx => ctx.polderMode === "room" ? ctx.tasks.filter(t => t.place === "polder") : ctx.tasks;
const axisUntagged = (tasks, axisCode) => !arr(tasks).some(t => arr(t.axis_tags).indexOf(axisCode) >= 0);

/* Pace: how fast an axis moves without anyone choosing to move it. The share
   of the cards that produce it which the tables settled as the machine's (5
   or 6 of 6): fast at two thirds or more, slow below. An axis no card
   produces is held, always; with no sort yet the others carry no word. A
   word, never a number, and never a weight on a move. */
const PACE_FAST = 2 / 3;
const PACE_PT = { fast: "rápido", slow: "lento", held: "parado" };
const PACE_EN = { fast: "fast", slow: "slow", held: "held" };
function pace(ctx, axisCode) {
  const tagged = ctx.tasks.filter(t => arr(t.axis_tags).indexOf(axisCode) >= 0);
  if (!tagged.length) return "held";
  if (ctx.taskMode !== "room") return null;
  const settled = tagged.filter(t => t.band === "settled").length;
  return settled / tagged.length >= PACE_FAST - 1e-9 ? "fast" : "slow";
}

function validateMove(m, ctx, axis) {
  m = m || {}; axis = axis || {};
  const errors = [];
  const dir = m.direction;
  const lower = LOWER.indexOf(dir) >= 0, upper = UPPER.indexOf(dir) >= 0;
  if (!lower && !upper) errors.push("direction");

  const v = m.to_value;
  const okValue = Number.isInteger(v) && v >= LIMITS.VALUE_MIN && v <= LIMITS.VALUE_MAX;
  if (!okValue) errors.push("value");
  const base = isNum(axis.as_is_you) ? axis.as_is_you : null;
  if (okValue) {
    if (base !== null && lower && !(v < base)) errors.push("lower_not_below");
    if (base !== null && upper && !(v > base)) errors.push("upper_not_above");
  }
  if (m.note && String(m.note).length > LIMITS.NOTE_MAX) errors.push("note_long");

  const taskIds = arr(m.cites_task_ids), wallIds = arr(m.cites_wall_ids);
  const taskById = index(ctx.tasks), wallIndex = ctx.wallIndex || index(ctx.wall);
  if (taskIds.some(id => !taskById[id]) || wallIds.some(id => !wallIndex[id])) errors.push("unknown_citation");

  let amber = false, uncited = false, offerOnly = false;
  if (lower) {
    offerOnly = !!m.offer_only;
    if (offerOnly) {
      const r = String(m.offer_reason || "").trim();
      if (!r || r.length > LIMITS.REASON_MAX) errors.push("offer_reason");
    } else {
      const carrying = taskIds.filter(id => taskById[id] && carriesLower(taskStanding(ctx, axis.code, taskById[id])));
      if (!carrying.length)
        errors.push(axisUntagged(ctx.tasks, axis.code) ? "lower_untagged_axis" : "lower_needs_flood");
      uncited = ctx.taskMode === "fallback";
    }
  }
  if (upper) {
    const cited = uniq(wallIds.map(id => wallIndex[id]).filter(Boolean));
    if (!cited.length) errors.push("upper_needs_wall");
    else if (ctx.wallMode === "room") {
      /* change request 3: ours AND getting scarcer backs a raise; ours and
         steady is allowed and amber; generic, or ours but more abundant, is
         refused. A bound card with no arrow yet counts as steady. */
      const strong = cited.some(c => c.ligado && c.arrow === "escasso");
      const steady = cited.some(c => c.ligado && (c.arrow === "estavel" || c.arrow == null));
      if (strong) amber = false;
      else if (steady) amber = true;
      else errors.push("upper_needs_scarce");
    }
    uncited = ctx.wallMode === "fallback";
  }
  return { ok: errors.length === 0, errors, amber, uncited, offerOnly };
}

/* Change request 4: a created axis. Not a slider position, since an axis you
   never had is not at zero; it has no position and no pace. It arrives with
     a name        what the buyer would see on a proposal, 60 characters
     a wall card   required, and held to the raise's rule: ours and getting
                   scarcer passes, ours but steady is amber, the rest refused
     a pôlder card optional: a kept human moment promoted to a promise, and
                   then one the tables did keep in the pôlder
   With no room wall the generic list stands in, uncited, as for a raise. */
function validateCreate(c, ctx) {
  c = c || {};
  const errors = [];
  const name = String(c.name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > LIMITS.AXIS_NAME_MAX) errors.push("axis_name");
  const wallIndex = ctx.wallIndex || index(ctx.wall), taskById = index(ctx.tasks);
  let amber = false;
  const w = c.wall_id ? wallIndex[c.wall_id] : null;
  if (!c.wall_id) errors.push("axis_needs_wall");
  else if (!w) errors.push("unknown_citation");
  else if (ctx.wallMode === "room") {
    if (w.ligado && w.arrow === "escasso") amber = false;
    else if (w.ligado && (w.arrow === "estavel" || w.arrow == null)) amber = true;
    else errors.push("upper_needs_scarce");
  }
  if (c.polder_id) {
    const t = taskById[c.polder_id];
    if (!t) errors.push("unknown_citation");
    else if (ctx.polderMode === "room" && t.place !== "polder") errors.push("polder_not_kept");
  }
  const uncited = ctx.wallMode === "fallback" || (!!c.polder_id && ctx.polderMode === "fallback");
  return { ok: !errors.length, errors, amber, uncited, name };
}

/* The room's created axes, for the projector and the report: names that say
   the same thing merge across tables, by the wall's own rule (sameCard). Per
   group: how many tables created it, how many people back it, and the wall
   card most often cited. */
function createdGroups(created, backers, nameWall) {
  const rows = arr(created).slice().sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  const back = {};
  for (const b of arr(backers)) (back[b.created_id] = back[b.created_id] || new Set()).add(b.pid);
  const groups = [];
  for (const c of rows) {
    const g = groups.find(x => x.names.some(n => sameCard(n, c.name)));
    if (g) { g.rows.push(c); g.names.push(c.name); } else groups.push({ rows: [c], names: [c.name] });
  }
  const nameW = nameWall || (x => x);
  return groups.map(g => {
    const pids = new Set();
    g.rows.forEach(c => (back[c.id] || new Set()).forEach(p => pids.add(p)));
    return { name: g.rows[0].name, names: uniq(g.names),
             tables: uniq(g.rows.map(c => c.table_no == null ? "p:" + c.pid : c.table_no)).length,
             backers: pids.size, topWall: modal(g.rows.map(c => c.wall_id ? nameW(c.wall_id) : null)),
             amber: g.rows.filter(c => c.amber).length, uncited: g.rows.filter(c => c.uncited).length,
             polder_ids: uniq(g.rows.map(c => c.polder_id).filter(Boolean)), members: g.rows.map(c => c.id) };
  }).sort((a, b) => (b.tables - a.tables) || (b.backers - a.backers) || a.name.localeCompare(b.name));
}

/* Change request 5: the table's commitment. Not three rows but one fork.
     A  a pôlder the table funds: the pôlder (an axis the table created, or a
        card it kept in the pôlder), the bill (a card it put under water, a
        reduction its people made, or a budget line), and how they will know.
        No guard: a pôlder is not a position, it is a cost carried on purpose.
     B  a raise the table funds and guards: the axis and what the buyer would
        see, the bill (a card under water or a reduction, never just words),
        the guard (a wall card held to the raise's rule), and the price.
   Both: an owner and a review date. `tc` is the table: its own sort, its
   created axes, the axes, and what its people reduced and raised. With no
   sort from the table, every card is open and the commitment is uncited. */
function validateCommit(c, ctx, tc) {
  c = c || {}; tc = tc || {};
  const errors = [], txt = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const noSort = !tc.sort, taskById = index(ctx.tasks);
  const inSort = (id, z) => !!taskById[id] && (noSort || tc.sort[id] === z);
  const reduced = id => arr(tc.reduces).some(r => r.axis_id === id);
  const billOk = allowText => {
    const b = c.bill || {};
    if (b.kind === "card") return inSort(b.id, "submerso");
    if (b.kind === "reduce") return reduced(b.id);
    return b.kind === "text" && allowText && !!txt(b.text);
  };
  const long = [c.know, c.price, c.owner, c.raise && c.raise.sees, c.bill && c.bill.text].some(v => txt(v).length > LIMITS.COMMIT_TEXT_MAX);
  let amber = false, uncited = noSort;
  if (COMMIT_OPTIONS.indexOf(c.option) < 0) errors.push("commit_option");
  else if (c.option === "polder") {
    const p = c.polder || {};
    const ok = p.kind === "created" ? arr(tc.created).some(x => x.id === p.id) : p.kind === "card" ? inSort(p.id, "polder") : false;
    if (!ok) errors.push("commit_polder");
    if (!billOk(true)) errors.push("commit_polder_bill");
    if (!txt(c.know)) errors.push("commit_know");
  } else {
    const r = c.raise || {};
    if (arr(tc.axes).indexOf(r.axis_id) < 0 || !txt(r.sees)) errors.push("commit_raise");
    if (!billOk(false)) errors.push("commit_raise_bill");
    else if (c.bill.kind === "reduce" && c.bill.id === r.axis_id) errors.push("commit_same_axis");
    const w = c.guard ? (ctx.wallIndex || index(ctx.wall))[c.guard] : null;
    if (!w) errors.push("commit_raise_guard");
    else if (ctx.wallMode === "room") {
      if (w.ligado && w.arrow === "escasso") amber = false;
      else if (w.ligado && (w.arrow === "estavel" || w.arrow == null)) amber = true;
      else errors.push("commit_raise_guard");
    } else uncited = true;
    if (!txt(c.price)) errors.push("commit_price");
  }
  if (!txt(c.owner)) errors.push("commit_owner");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.review || "")) || isNaN(Date.parse(c.review))) errors.push("commit_date");
  if (long) errors.push("commit_text");
  /* the sentence that applies comes first */
  const first = ["commit_option", "commit_raise_bill", "commit_raise_guard", "commit_polder_bill"];
  errors.sort((a, b) => ((first.indexOf(a) + 1 || 99) - (first.indexOf(b) + 1 || 99)));
  return { ok: !errors.length, errors, amber, uncited };
}
function reviewDefault(from) {
  const d = new Date(from || Date.now());
  d.setUTCDate(d.getUTCDate() + LIMITS.REVIEW_DAYS);
  return d.toISOString().slice(0, 10);
}
/* What the app fills in when the table picks an option, from its own moves.
   A: a created axis (one that promotes a pôlder card first). B: the raise
   with the largest amplitude at the table, and that move's wall citation. */
function commitPrefill(option, tc) {
  tc = tc || {};
  const out = {};
  if (option === "polder") {
    const c = arr(tc.created).find(x => x.polder_id) || arr(tc.created)[0];
    if (c) out.polder = { kind: "created", id: c.id };
  } else if (option === "raise") {
    const top = arr(tc.raises).slice().sort((a, b) => (b.amp - a.amp) || (b.n - a.n))[0];
    if (top) { out.raise = { axis_id: top.axis_id, sees: "" }; if (top.wall_id) out.guard = top.wall_id; }
  }
  return out;
}
/* The commitment in one sentence, for the projector and the report. */
function commitSentence(c, n) {
  c = c || {}; n = n || {};
  const f = (fn, id) => (fn ? fn(id) : id) || "?";
  const bill = b => !b ? "?" : b.kind === "card" ? f(n.task, b.id) : b.kind === "reduce" ? "a baixa em " + f(n.axis, b.id) : b.text;
  if (c.option === "polder") {
    const p = c.polder || {};
    return `Mantemos humano: ${p.kind === "created" ? f(n.created, p.id) : f(n.task, p.id)}. Paga-se com ${bill(c.bill)}. Saberemos por: ${c.know || "?"}.`;
  }
  const r = c.raise || {};
  return `${f(n.axis, r.axis_id)} sobe: ${r.sees || "?"}. Paga-se com ${bill(c.bill)}, guardado por ${f(n.wall, c.guard)}. Preço disso: ${c.price || "?"}.`;
}

/* Change request 6: today's line may be each table's own, against its own
   rival (the morning), rather than the room's (the afternoon). The axes as a
   participant at that table moves from them: its line as the as-is, its
   rival at the middle. No line, no as-is: the sliders start mid-scale. */
function axesAtTable(axes, choices) {
  return arr(axes).map(a => {
    const v = choices && choices[a.code] ? PLACEMENT_VALUE[choices[a.code]] : null;
    return { ...a, as_is_you: v == null ? null : v, as_is_rival: v == null ? null : RIVAL_VALUE };
  });
}

/* A curve must give something up. How many raises it carries is the
   participant's to argue, not the instrument's to cap. */
function validateCurve(moves) {
  const ms = arr(moves);
  const raises = ms.filter(m => m && m.direction === "raise").length;
  const lowers = ms.filter(m => m && LOWER.indexOf(m.direction) >= 0).length;
  const errors = [];
  if (lowers < LIMITS.MIN_LOWER) errors.push("needs_lower");
  return { ok: !errors.length, errors, raises, lowers };
}

/* A participant's to-be curve: their move where they made one, today's line
   where they did not. Null where neither exists. */
function toBe(moves, axes) {
  const byAxis = index(moves, "axis_id");
  return arr(axes).map(a => byAxis[a.id] ? byAxis[a.id].to_value : (isNum(a.as_is_you) ? a.as_is_you : null));
}

/* Per axis, across curves: the median and the quartiles of to_value. The
   spread is the finding; nothing draws the middle line without the band. */
function spread(curves, axes) {
  return arr(axes).map((a, i) => {
    const xs = arr(curves).map(c => c[i]).filter(isNum);
    return { n: xs.length, med: quantile(xs, 0.5), p25: quantile(xs, 0.25), p75: quantile(xs, 0.75) };
  });
}

/* ------------------------------------------------------------ the move map */

function moveMap(moves, axes, name, nRespondents) {
  const nameTask = (name && name.task) || (x => x);
  const nameWall = (name && name.wall) || (x => x);
  return arr(axes).map(a => {
    const ms = arr(moves).filter(m => m.axis_id === a.id);
    const up = ms.filter(m => UPPER.indexOf(m.direction) >= 0);
    const dn = ms.filter(m => LOWER.indexOf(m.direction) >= 0);
    const topWall = modal([].concat.apply([], up.map(m => uniq(arr(m.cites_wall_ids).map(nameWall)))));
    const topTask = modal([].concat.apply([], dn.filter(m => !m.offer_only)
                            .map(m => uniq(arr(m.cites_task_ids).map(nameTask)))));
    /* change request 4: no count here includes a create; created axes are their own list */
    return {
      axis: a, raised: up.length,
      lowered: dn.length,
      offerOnly: dn.filter(m => m.offer_only).length,
      amber: up.filter(m => m.amber).length, uncited: ms.filter(m => m.uncited).length,
      topWall, topTask,
      notes: ms.filter(m => m.note).map(m => ({ direction: m.direction, note: m.note })),
      unchosen: dn.length === 0 && up.length > 0 && up.length * 2 >= (nRespondents || 0),
    };
  });
}

/* -------------------------------- what the sort and the wall led us to expect */

function expectedShifts(ctx, axes, map, created) {
  const byAxis = {};
  for (const r of arr(map)) byAxis[r.axis.id] = r;
  const pl = (n, one, many) => n === 1 ? one : many;
  const list = xs => xs.length <= 3 ? xs.map(t => t.short_pt).join(", ")
    : xs.slice(0, 3).map(t => t.short_pt).join(", ") + ` e mais ${xs.length - 3}`;
  const EXPECT = {
    offer:    ["só por decisão de oferta", "an offer decision only"],
    unknown:  ["a triagem ainda não decidiu", "the sort has not decided yet"],
    converge: ["a água cobre: converge com o rival", "flooded: converges with the rival"],
    create:   ["pôlder: um momento a promover num eixo novo", "polder: a moment to promote to a new axis"],
    bedrock:  ["rocha firme: não inunda, não diferencia", "bedrock: neither floods nor differentiates"],
    split:    ["as mesas dividiram-se", "the tables split"],
  };
  return arr(axes).map(a => {
    const tagged = ctx.tasks.filter(t => arr(t.axis_tags).indexOf(a.code) >= 0);
    const room = ctx.taskMode === "room";
    const flooded = room ? tagged.filter(t => t.place === "submerso" || t.place === "linha") : [];
    const kept = room ? tagged.filter(t => t.place === "polder") : [];
    const rock = room ? tagged.filter(t => t.place === "rocha") : [];
    const r = byAxis[a.id] || { raised: 0, lowered: 0, amber: 0, offerOnly: 0, topWall: null, topTask: null, unchosen: false };
    let expect;
    if (!tagged.length) expect = "offer";
    else if (!room) expect = "unknown";
    else if (flooded.length) expect = "converge";
    else if (kept.length) expect = "create";
    else if (rock.length) expect = "bedrock";
    else expect = "split";
    const f = [];
    const say = (kind, pt, en) => f.push({ kind, pt, en });
    const wallName = r.topWall ? r.topWall.name : null;
    if (expect === "offer") {
      say("info", `Nenhum cartão produz ${a.label_pt}: só se move por decisão de oferta.`, "No card produces this axis: it moves only by an offer decision.");
      if (r.lowered) say("info", `${r.lowered} ${pl(r.lowered, "baixou-o", "baixaram-no")}, ${r.offerOnly} como só oferta.`, `${r.lowered} lowered it, ${r.offerOnly} as offer-only.`);
    }
    if (expect === "converge") {
      if (r.lowered) say("coherent", `Coerente: as mesas puseram ${list(flooded)} debaixo de água ou na linha, e ${r.lowered} ${pl(r.lowered, "baixou", "baixaram")} ${a.label_pt}${r.topTask ? `, a maioria citando ${r.topTask.name}` : ""}.`,
                         `Coherent: the tables flooded ${list(flooded)}, and ${r.lowered} lowered this axis.`);
      else say("tension", `As mesas puseram ${list(flooded)} debaixo de água ou na linha, e ninguém baixou ${a.label_pt}. A poupança chega ao comprador no próximo concurso, a todos os operadores ao mesmo tempo.`,
               `The tables flooded ${list(flooded)}, and nobody lowered this axis. The saving reaches the buyer at the next tender, for every operator at once.`);
      if (r.raised && r.amber) say("tension", `${r.amber} de ${r.raised} ${pl(r.raised, "elevação", "elevações")} num eixo que a água cobre ${pl(r.amber, "assenta", "assentam")} num ativo nosso mas estável, que não sustenta o preço por três anos.`,
                                   `${r.amber} of ${r.raised} raises on a flooded axis rest on an asset that is ours but steady, which will not hold the price.`);
      else if (r.raised) say("check", `${r.raised} ${pl(r.raised, "elevou", "elevaram")} um eixo que a água cobre${wallName ? `, sobre ${wallName}` : ""}. Só aguenta enquanto esse cartão for nosso e ficar mais escasso.`,
                             `${r.raised} raised a flooded axis${wallName ? ", on " + wallName : ""}. It holds only while that card is ours and getting scarcer.`);
    }
    /* change request 4: a kept moment is promoted by a created axis that cites it */
    if (kept.length) {
      const keptIds = kept.map(t => t.id);
      const born = arr(created).filter(c => c.polder_id && keptIds.indexOf(c.polder_id) >= 0);
      const nT = uniq(born.map(c => c.table_no == null ? "p:" + c.id : c.table_no)).length;
      const names = uniq(born.map(c => c.name)).slice(0, 2).map(n => `«${n}»`).join(", ");
      if (born.length) say("coherent", `As mesas guardaram ${list(kept)} no pôlder, e ${nT} ${pl(nT, "mesa criou", "mesas criaram")} um eixo novo a partir dele: ${names}.`,
                           `The tables kept ${list(kept)} in the polder, and ${nT} created a new axis from it: ${names}.`);
      else say("tension", `As mesas guardaram ${list(kept)} no pôlder, e nenhuma mesa o promoveu a eixo novo: um custo mantido sem um valor que o comprador veja.`,
               `The tables kept ${list(kept)} in the polder, and no table promoted it to a new axis: a kept cost the buyer never sees.`);
    }
    if (expect === "bedrock" && r.lowered > r.offerOnly)
      say("tension", `Baixar ${a.label_pt} sem linha de água: os cartões que o produzem ficaram na rocha firme.`, "Lowering this axis without a flood line: its cards sit on bedrock.");
    if (expect === "bedrock" && r.raised)
      say("check", `${r.raised} ${pl(r.raised, "elevou", "elevaram")} ${a.label_pt}${wallName ? ` sobre ${wallName}` : ""}. A rocha firme não diferencia: todos os rivais licenciados estão lá. O que diferencia é o cartão.`,
          `${r.raised} raised this axis. Bedrock does not differentiate; the card does.`);
    if (r.unchosen) say("check", "Todos os que o moveram elevaram-no, e ninguém baixou: a sala ainda não escolheu.", "Everyone who moved it raised it and nobody lowered it: the room has not chosen yet.");
    if (!r.raised && !r.lowered && expect !== "offer") say("info", `Ninguém mexeu em ${a.label_pt}.`, "Nobody moved this axis.");
    return { axis: a, expect, expectPt: EXPECT[expect][0], expectEn: EXPECT[expect][1], flooded, kept, rock, moves: r, findings: f };
  });
}

root.NCRULES = {
  ZONES, SORT_STATES, ZONE_PT, ZONE_EN, ZONE_DO_PT, ZONE_DO_EN, ZONE_WHY_PT, BAND_PT, BAND_EN,
  LOWER, UPPER, DIRECTIONS, DIR_PT, DIR_EN, BUYERS, BUYER_PT, BUYER_EN,
  PLACEMENT, PLACEMENT_VALUE, PLACEMENT_PT, RIVAL_VALUE, SCALE_PT, SCALE_EN,
  WALL_STATES, WALL_STATE_PT, WALL_ARROWS, WALL_ARROW_PT,
  LIMITS, MSG, msgPt, msgEn,
  index, modal, quantile, uniq,
  sortCounts, placeOf, machineOf, keepOf, bandOf, tallySort, reachOf, tide,
  nameTokens, sameCard, wallGroups,
  citeContext, taskStanding, carriesLower, lowerCandidates, polderCandidates, axisUntagged,
  pace, PACE_PT, PACE_EN,
  validateMove, validateCreate, createdGroups, validateCurve, toBe, spread, moveMap, expectedShifts,
  COMMIT_OPTIONS, COMMIT_PT, COMMIT_TAG, validateCommit, reviewDefault, commitPrefill, commitSentence,
  axesAtTable,
};
})(typeof globalThis !== "undefined" ? globalThis : this);
