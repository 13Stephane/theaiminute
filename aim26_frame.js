// ============================================================================
//  AIM 2026 · Málaga · session frame — SINGLE SOURCE (doctrine D2)
//  Both aim26.html and show-aim26.html read vocabulary, question text, and
//  session id from this file. Never hand-mirror these values into pages.
//  Session row: insert into course_sessions (id, phase) values ('aim26', 0)
//  Phases: 0 lobby · 1 cold prior · 2 falsifier · 3 closed
// ============================================================================

var AIM26 = {
  session: "aim26",

  question: "Name the one AI shift your organization (or the firms you study) most needs to get right.",
  place_hint: "Then place it on the two axes below.",
  falsifier_prompt: "Write the condition under which your placement would be wrong.",
  consent: "Responses are published after the session as an anonymized aggregate at this address. First names are never published.",

  // x: 0 = visible, 1 = surprise · y: 0 = tactical, 1 = strategic
  axes: {
    x: { q: "Is the shift…", opts: [
      { v: 0, key: "visible",  label: "Already visible" },
      { v: 1, key: "surprise", label: "Likely to surprise" } ] },
    y: { q: "And does it demand…", opts: [
      { v: 0, key: "tactical",  label: "A tactical adjustment" },
      { v: 1, key: "strategic", label: "Strategic reinvention" } ] }
  },

  // render order: TL, TR, BL, BR — matches slide 5
  quadrants: [
    { x: 0, y: 0, name: "Visible × Tactical",   posture: "Act, build leverage, or hedge" },
    { x: 1, y: 0, name: "Surprise × Tactical",  posture: "Entrain to external pacemakers" },
    { x: 0, y: 1, name: "Visible × Strategic",  posture: "Adjust tempo: accelerate / decelerate" },
    { x: 1, y: 1, name: "Surprise × Strategic", posture: "Narrate, reframe, pivot" }
  ],

  phases: { 0: "lobby", 1: "prior", 2: "falsifier", 3: "closed" }
};
