/* A nova curva · a rehearsal room, through the real API
 *
 * Six tables and thirty phones. Each table's relator records its sort after
 * the reveal (one card set aside as sem acordo by two tables); five of the
 * six write their walls with arrows (Mesa 6 never does); Mesa 2 enters
 * today's line; twenty-eight curves arrive that obey the rules, two left as
 * drafts. Deterministic: the same room every time.
 *
 * Every write goes through the endpoints a phone uses, so a rehearsal
 * exercises the Worker's rules rather than bypassing them. It OPENS the
 * session it fills, since phones only write to the open one.
 *
 *   NCREHEARSAL.run({ call, sessionId, log, stopAfter, tables, people })
 *   tables, people: six and thirty unless told; three tables are sixteen, eight are forty
 *   call(path, { method, body, key: true }) -> parsed JSON, throws with .status
 *   stopAfter: "sort" | "wall" | "all"
 */
(function (root) {
"use strict";

/* Each table's sort after the reveal, in table order 1 to 6:
   S submerso · L linha d'água · P pôlder · R rocha firme · X sem acordo.
   Machine can is S or P. Shaped so every band appears: the admin cards
   settle, the chairside ones resist, the two calls stay in the pôlder, and
   the consent card is set aside by two tables. */
const SORT = {
  T01: "SSSSSS", T02: "SSSSLS", T03: "SLLSSL", T04: "SSLSLX", T05: "LLSLLL", T06: "SSSLSS",
  T07: "LSLLXL", T08: "SSSSLL", T09: "LLPRLX", T10: "RRRLRR", T11: "PRPRXX", T12: "RRRRRL",
  T13: "SSSSSL", T14: "SSLSSS", T15: "PPPLPR", T16: "PPPPRP",
};
const CODE = { S: "submerso", L: "linha", P: "polder", R: "rocha", X: "sem_acordo" };

/* Each table's wall: its answer on the six given cards (slide 52), in the
   order owners, record, reciprocity, one body, brand, vendor, the arrow on
   every card it calls ours (E mais escasso · T estável · A mais abundante),
   then up to three of its own. The owners and the record come out ours and
   scarcer, one body ours but steady, reciprocity ours but more abundant, the
   brand generic on a tie; "dados de desfecho", in three wordings, joins. */
const L = "ligado", G = "generico", X = "fora", E = "escasso", T = "estavel", A = "abundante";
const WALLS = [
  { given: [L, L, L, L, L, G], arrows: [E, E, A, T, T, null], cards: [["Dados de desfecho", true, E]] },
  { given: [L, L, X, L, G, G], arrows: [E, E, null, T, null, null], cards: [["Os dados de desfecho clínico", true, E], ["Contratos com empregadores", true, T]] },
  { given: [L, G, L, L, G, X], arrows: [T, null, A, E, null, null], cards: [["Relação de confiança com o paciente", true, E]] },
  { given: [L, L, L, X, L, G], arrows: [E, E, T, null, T, null], cards: [["Dados de desfecho ligados à decisão", false, null], ["Reciprocidade nacional", true, A]] },
  { given: [G, L, G, L, X, G], arrows: [null, E, null, T, null, null], cards: [["Capacidade da rede em cada cidade", false, null]] },
  null,   /* Mesa 6 never writes a wall */
];

/* The morning line, as a rehearsal room would place it by show of hands:
   against Odontoprev, cheaper it is not, the network and the dentist it
   beats, the app and the employer report it trails. */
const PLACEMENT = {
  price: "below", network: "above", complaints: "level", employer_reporting: "below",
  continuity: "above", ortho_specialist: "below", digital: "below",
};
/* Change request 4: the axes each table creates, [name, the wall card it rests
   on, the pôlder card it promotes]. The three wordings of an employer outcome
   report merge into one axis across Mesas 1, 2 and 5; the call after bad news
   across Mesas 1 and 3; Mesa 4's rests on one body, ours but steady, so amber.
   Mesa 6 creates nothing. */
const CREATES = {
  1: [["Relatório de desfecho clínico para o RH", /pront/i, null], ["Uma pessoa liga depois da notícia difícil", /don/i, "T16"]],
  2: [["Relatório de desfecho para o RH", /desfecho/i, null]],
  3: [["Ligação antes da extração, no contrato", /don/i, "T15"], ["Uma pessoa liga após a notícia difícil", /don/i, "T16"]],
  4: [["Segunda opinião garantida em 48 horas", /operadora/i, null]],
  5: [["Desfecho clínico reportado ao RH", /pront/i, null]],
  /* only in a room of eight */
  7: [["Relatório trimestral de desfecho para o RH", /pront/i, null]],
  8: [["Dentista de referência nomeado no contrato", /don/i, null]],
};
/* Change request 6: the morning room, OCESP and SESCOOP/SP. Twelve cards, seven
   branch-neutral axes, wall cards A to L in the seed's order, and each table
   placing itself against its own rival. Three tables play the first three
   walls and lines; the columns follow COLS like the afternoon's. */
const L_ = "ligado", G_ = "generico", X_ = "fora", E_ = "escasso", T_ = "estavel", A_ = "abundante";
const OCESP = {
  SORT: { T01: "SSSLSS", T02: "SSSSSS", T03: "SLSLLS", T04: "SSLSLX", T05: "LLSLLL", T06: "SSSLSS",
          T07: "SSLSSL", T08: "LSLLXL", T09: "PLPRLX", T10: "RRRLRR", T11: "PPPRPP", T12: "RRRRRL" },
  WALLS: [
    { given: [L_, L_, L_, L_, L_, L_, G_, L_, G_, X_, G_, L_], arrows: [E_, E_, T_, E_, T_, E_, null, T_, null, null, null, A_], cards: [["Confiança local do cooperado", true, E_]] },
    { given: [L_, L_, L_, G_, L_, L_, L_, L_, G_, G_, X_, L_], arrows: [E_, T_, E_, null, T_, E_, T_, E_, null, null, null, A_], cards: [] },
    { given: [L_, L_, L_, L_, G_, G_, G_, L_, L_, X_, G_, G_], arrows: [T_, E_, E_, E_, null, null, null, T_, A_, null, null, null], cards: [["Assembleia que decide", true, E_]] },
    { given: [L_, G_, L_, L_, L_, L_, G_, X_, L_, G_, G_, L_], arrows: [E_, null, T_, E_, T_, E_, null, null, T_, null, null, T_], cards: [] },
    { given: [L_, L_, X_, L_, L_, L_, G_, L_, G_, G_, G_, L_], arrows: [E_, E_, null, T_, T_, E_, null, E_, null, null, null, A_], cards: [] },
    null,
  ],
  LINES: [
    { preco: "below", alcance: "above", qualidade: "level", amplitude: "above", digital: "below", relacao: "above", retorno: "above" },
    { preco: "level", alcance: "above", qualidade: "above", amplitude: "level", digital: "below", relacao: "above", retorno: "level" },
    { preco: "below", alcance: "level", qualidade: "above", amplitude: "below", digital: "level", relacao: "above", retorno: "above" },
  ],
  RIVALS: ["um banco digital", "uma trading multinacional", "uma plataforma por aplicativo"],
  CREATES: {
    1: [["Um responsável nomeado para cada cooperado", /v.nculo/i, "T11"]],
    2: [["Resultado por cooperado, no extrato", /resultado|hist/i, null]],
    3: [["Um responsável nomeado para o cooperado", /v.nculo/i, null], ["Assembleia que decide, com ata aberta", /base/i, null]],
  },
  WALL_FOR: { relacao: /v.nculo|base/i, qualidade: /hist|resultado/i, retorno: /v.nculo|dono/i, alcance: /capilar/i },
  LOWERS: ["preco", "amplitude", "alcance"], RAISES: ["relacao", "qualidade", "retorno"],
  OFFER: "digital", OFFER_WHY: "o cooperado não paga por isso",
  SEES: { relacao: "um responsável que o cooperado conhece pelo nome", qualidade: "o resultado de cada decisão, no extrato",
          retorno: "a sobra devolvida, visível no extrato", alcance: "atendimento em cada município", preco: "mais barato que o rival",
          amplitude: "mais linhas no mesmo balcão", digital: "tudo no aplicativo" },
};
const WALL_FOR = {
  continuity: /don|cooper|dentist|confian/i,
  employer_reporting: /pront|desfecho|hist/i,
  complaints: /operadora|prestador/i,
};

/* Deterministic device ids: the same room every run, and never a real phone's. */
function pidFor(sid, i) {
  let h = 2166136261 >>> 0; const s = sid + ":" + i;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  return ("ensaio_" + i + "_" + h.toString(36) + "xxxxxxxxxxxxxxxx").slice(0, 28);
}
const STAGES = ["sort", "wall", "all"];
/* Rooms of other sizes (16 people at 3 tables in the morning, 40 at 8 in the
   afternoon): which of the six sort patterns and walls each table plays.
   Six tables play themselves. Chosen so every band appears, the two calls
   stay in the pôlder, and every axis the room lowers still has a flood. */
const COLS = { 3: [0, 1, 4], 8: [0, 1, 2, 3, 4, 5, 0, 3] };
const WALLMAP = { 3: [0, 1, 2], 8: [0, 1, 2, 3, 4, 5, 0, 2] };
const PEOPLE = { 3: 16, 8: 40 };

async function run(opt) {
  const R = root.NCRULES, VMAX = R.LIMITS.VALUE_MAX;
  const call = opt.call, sid = opt.sessionId, log = opt.log || (() => {});
  const stopAfter = STAGES.includes(opt.stopAfter) ? opt.stopAfter : "all";
  const carryOn = s => STAGES.indexOf(stopAfter) > STAGES.indexOf(s);
  const F = (path, body, method) => call(path, { method: method || (body ? "POST" : "GET"), body, key: true });
  const P = (path, body) => call(path, { method: "PUT", body });
  const TABLES = Math.max(2, Math.min(12, Number(opt.tables) || 6));
  const N = Math.max(TABLES, Number(opt.people) || PEOPLE[TABLES] || TABLES * 5);
  const colOf = t => COLS[TABLES] && COLS[TABLES][t] != null ? COLS[TABLES][t] : t % 6;
  const wallOf = t => { const k = WALLMAP[TABLES] ? WALLMAP[TABLES][t] : t; return k == null || k >= K.WALLS.length ? null : K.WALLS[k]; };

  let room = await F(`/f/room?session_id=${encodeURIComponent(sid)}`);
  if (room.sorts.length || room.wall.length || room.curves.length)
    throw new Error("this session already has answers: wipe it or create a new one first");
  await F("/f/active", { session_id: sid });
  const pids = Array.from({ length: N }, (_, i) => pidFor(sid, i));
  /* the content follows the seed: the morning's twelve cards, or the afternoon's sixteen */
  const K = room.axes.some(a => a.code === "preco") ? OCESP
    : { SORT, WALLS, PLACEMENT, CREATES, WALL_FOR, LOWERS: ["price", "employer_reporting", "digital", "network"],
        RAISES: ["continuity", "employer_reporting", "complaints"], OFFER: "ortho_specialist", OFFER_WHY: "o empregador não paga por isso", SEES: null };
  const byTable = (room.session.config || {}).placement_scope === "table";

  /* ---- six tables' sorts, each by its relator after the reveal */
  for (let t = 0; t < TABLES; t++) {
    const choices = {};
    room.tasks.forEach(k => { const row = K.SORT[k.code] || "LLLLLL"; choices[k.id] = CODE[row[colOf(t)]]; });
    await P("/sort", { pid: pids[t], session_id: sid, mesa: t + 1, choices, submit: true });
  }
  log(`${TABLES} tables' sorts in`);
  if (!carryOn("sort")) return { pids };

  /* ---- five walls, in order, so the stewards are Mesa 1 to 5; the room's wall merges itself */
  const givenIds = (room.session.config.generic || []).map(g => g.id);
  for (let t = 0; t < TABLES; t++) {
    const w = wallOf(t); if (!w) continue;
    await P("/wall", { pid: pids[t], session_id: sid, mesa: t + 1,
      given: Object.fromEntries(givenIds.map((id, k) => [id, w.given[k]])),
      arrows: Object.fromEntries(givenIds.map((id, k) => [id, w.arrows[k]]).filter(([, a]) => a)),
      cards: w.cards.map(([name, ligado, arrow]) => ({ name, ligado, arrow })) });
  }
  log(`${Array.from({ length: TABLES }, (_, t) => wallOf(t)).filter(Boolean).length} walls in; the wall merged itself`);
  if (!carryOn("wall")) return { pids };

  /* ---- the morning line, entered by Mesa 2's steward */
  if (byTable)   /* change request 6: each table against its own rival */
    for (let t = 1; t <= TABLES; t++)
      await P("/placement", { pid: pids[t - 1], session_id: sid, mesa: t, choices: K.LINES[(t - 1) % K.LINES.length], rival_name: K.RIVALS[(t - 1) % K.RIVALS.length] });
  else await P("/placement", { pid: pids[1], session_id: sid, mesa: 2, choices: K.PLACEMENT });

  /* ---- thirty curves, each obeying the rules */
  const st = await call("/state", { method: "GET" });
  const ctx = R.citeContext({ tasks: st.tasks, sort: st.cite, groups: st.cite.wall, generic: st.generic });
  const axis = R.index(st.axes, "code");
  const base = c => axis[c] ? axis[c].as_is_you : null;
  /* a raise rests on a card that is ours and scarcer; the amber ones on ours but steady */
  const cards = (code, bound) => ctx.wall.filter(c => bound ? c.ligado && c.arrow === "escasso" && (K.WALL_FOR[code] || /./).test(c.name) : c.ligado && c.arrow === "estavel");
  let submitted = 0;
  for (let i = 0; i < N; i++) {
    /* the participant sits at Mesa (i mod tables) + 1, and in a room of rivals moves from that table's line */
    const AX = byTable ? R.index(R.axesAtTable(st.axes, K.LINES[(i % TABLES) % K.LINES.length]), "code") : axis;
    const base = c => AX[c] ? AX[c].as_is_you : null;
    const moves = [], used = new Set();
    const add = m => {
      const a = AX[m.code]; if (!a || used.has(a.code)) return false;
      const mv = { axis_id: a.id, direction: m.direction, to_value: m.to_value,
                   cites_task_ids: m.tasks || [], cites_wall_ids: m.walls || [],
                   offer_only: !!m.offer_only, offer_reason: m.offer_reason || null, note: m.note || null };
      if (!R.validateMove(mv, ctx, a).ok) return false;
      moves.push(mv); used.add(a.code); return true;
    };
    /* one lower move, citing the room's flood */
    const lowers = K.LOWERS;
    for (let s = 0; s < lowers.length; s++) {
      const c = lowers[(i + s) % lowers.length];
      const b = base(c); if (b == null || b < 1) continue;
      const cand = R.lowerCandidates(ctx, c);
      if (!cand.length) continue;
      if (add({ code: c, direction: "reduce", to_value: Math.max(0, Math.ceil(b) - 1),
                tasks: cand.slice(0, 1 + (i % 2)).map(t => t.id),
                note: i % 6 === 0 ? "a revisão manual vira exceção" : null })) break;
    }
    if (i % 7 === 3 && base(K.OFFER) != null && base(K.OFFER) >= 1)
      add({ code: K.OFFER, direction: "reduce", to_value: Math.max(0, Math.ceil(base(K.OFFER)) - 1),
            offer_only: true, offer_reason: K.OFFER_WHY });
    /* one or two raises on the wall; every fifth leans on something generic */
    const raises = K.RAISES;
    const nRaise = i % 3 === 0 ? 2 : 1;
    for (let s = 0, done = 0; s < raises.length && done < nRaise; s++) {
      const c = raises[(i + s) % raises.length], b = base(c);
      if (b == null || b >= VMAX) continue;
      const pick = i % 5 === 2 && done === 0 ? cards(c, false) : cards(c, true);
      if (!pick.length) continue;
      const both = c === "complaints" && i % 4 === 1 && ctx.tasks.find(t => t.code === "T03");
      if (add({ code: c, direction: "raise", to_value: Math.min(VMAX, Math.floor(b) + 1 + (i % 2)),
                walls: [pick[0].id], tasks: both ? [both.id] : [],
                note: both ? "autorização no mesmo dia: operadora e prestador são um só" : null })) done++;
    }
    const submit = !(i === Math.round(N * 17 / 30) || i === Math.round(N * 28 / 30));
    try { await P("/curve", { pid: pids[i], session_id: sid, mesa: (i % TABLES) + 1, moves, submit }); if (submit) submitted++; }
    catch (e) { log(`device ${i}: ${e.message}`); }
  }
  log(`${submitted} curves submitted`);

  /* ---- change request 4: new axes, two per table at most, and the rest of
     the table backs them. Participant i sits at Mesa (i mod 6) + 1. */
  let made = 0;
  for (const t of Object.keys(K.CREATES).map(Number).filter(t => t <= TABLES)) {
    const ids = [];
    for (let k = 0; k < K.CREATES[t].length; k++) {
      const [name, re, polder] = K.CREATES[t][k];
      const w = ctx.wall.find(c => c.ligado && re.test(c.name));
      const p = polder ? ctx.tasks.find(x => x.code === polder) : null;
      const who = (t - 1) + TABLES * k;
      if (!w || who >= N) continue;
      try { const d = await P("/created", { pid: pids[who], session_id: sid, mesa: t, name, wall_id: w.id, polder_id: p ? p.id : null }); ids.push(d.id); made++; }
      catch (e) { log(`Mesa ${t}: ${e.message}`); }
    }
    if (!ids.length) continue;
    for (const [off, k] of [[TABLES * 2, 0], [TABLES * 3, 0], [TABLES * 4, ids.length - 1]])
      if ((t - 1) + off < N) await P("/created/back", { pid: pids[(t - 1) + off], session_id: sid, mesa: t, id: ids[k], back: true });
  }
  log(`${made} new axes created`);

  /* ---- change request 5: each relator enters the table's commitment, one
     fork per table: every third table funds a pôlder, the rest a raise they
     fund and guard, from the pre-fills the phone would offer. */
  const SEES = { continuity: "o mesmo dentista, garantido por escrito no contrato", employer_reporting: "um relatório trimestral de desfecho clínico para o RH",
                 complaints: "autorização no mesmo dia, sem ida e volta", network: "um dentista a menos de quinze minutos", price: "o preço de hoje",
                 digital: "tudo no aplicativo", ortho_specialist: "especialista na primeira consulta" };
  const OWNERS = ["Direção comercial", "Direção de rede", "Relacionamento com o cliente", "Direção clínica", "Direção de operações", "Direção financeira", "Relacionamento com empresas", "Qualidade"];
  let committed = 0;
  for (let t = 1; t <= TABLES; t++) {
    try {
      const d = await P("/commit", { pid: pids[t - 1], session_id: sid, mesa: t, claim: true });
      const tc = d.context, option = t % 3 === 0 ? "polder" : "raise", pf = R.commitPrefill(option, tc);
      const mine = z => ctx.tasks.filter(x => tc.sort && tc.sort[x.id] === z);
      const c = { option, owner: OWNERS[(t - 1) % OWNERS.length], review: R.reviewDefault() };
      if (option === "raise") {
        const axisId = pf.raise ? pf.raise.axis_id : (axis[K.RAISES[0]] || st.axes[0]).id;
        const code = st.axes.find(a => a.id === axisId).code;
        const scarce = ctx.wall.find(w => w.ligado && w.arrow === "escasso");
        c.raise = { axis_id: axisId, sees: (K.SEES || SEES)[code] || "o comprador repara" };
        const other = tc.reduces.find(r => r.axis_id !== axisId);   /* never paid by lowering the axis that goes up */
        c.bill = other ? { kind: "reduce", id: other.axis_id } : mine("submerso")[0] ? { kind: "card", id: mine("submerso")[0].id } : null;
        c.guard = pf.guard && ctx.wallIndex[pf.guard] && ctx.wallIndex[pf.guard].ligado ? pf.guard : (scarce ? scarce.id : null);
        c.price = "deixar de rever à mão cada guia";
      } else {
        const kept = mine("polder");
        c.polder = pf.polder || (kept[0] ? { kind: "card", id: kept[0].id } : null);
        c.bill = mine("submerso")[0] ? { kind: "card", id: mine("submerso")[0].id } : { kind: "text", text: "orçamento de relacionamento de 2027" };
        c.know = "cada ligação feita em 48 horas, contada todo mês";
      }
      const v = R.validateCommit(c, ctx, tc);
      if (!v.ok) { log(`Mesa ${t}: ${R.msgPt(v.errors[0])}`); continue; }
      await P("/commit", { pid: pids[t - 1], session_id: sid, mesa: t, commit: c });
      committed++;
    } catch (e) { log(`Mesa ${t}: ${e.message}`); }
  }
  log(`${committed} commitments in`);
  await F("/f/state", { session_id: sid, patch: { view: "moves" } });
  return { pids };
}

root.NCREHEARSAL = { run, SORT, WALLS, PLACEMENT, CREATES, OCESP, COLS, WALLMAP, PEOPLE, STAGES, pidFor };
})(typeof globalThis !== "undefined" ? globalThis : this);
