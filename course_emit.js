/* ============================================================================
   course_emit.js — the Log emitter for Course capture surfaces
   Source this AFTER config.js on any capture page:
     <script src="config.js"></script>
     <script src="course_emit.js"></script>

   C3 "one object, two sinks": the page's PRIMARY write to the live session
   tables (course_priors / course_teams) is unchanged and stays authoritative
   for the room. This emitter is the SECOND sink — it builds a C1 contract
   object from the SAME values the primary write used and appends it to the Log
   (course_captures). It NEVER blocks the caller and it fails LOUD with a reason
   (D1), never silently. `sourceRef` is the shared key back to the primary row,
   so the two sinks are provably the same object.

   Reads SUPABASE_URL / SUPABASE_ANON from the page (set by config.js), the same
   globals every other page uses.
   ============================================================================ */
(function(){
  var CONTRACT_VERSION = "1.1";
  function nowISO(){ return new Date().toISOString(); }

  // Build a C1 elicitation object carrying ONE assessment (a Soundings prior).
  // o: { sessionId, boardExternalId?, sessionStartedAt?, questionText, person,
  //      x, y, moat, rationale?, placedBy?, reason?, sourceRef? }
  function buildElicitation(o){
    if(!o || !o.sessionId) throw new Error("sessionId required");
    if(!o.questionText)    throw new Error("questionText required");
    if(!o.person)          throw new Error("person (display_name) required");

    // contract placed_by enum is self|ai|facilitator|null. The page emits
    // 'ai' or 'fallback'; fold 'fallback' -> 'ai' WITH a loud reason (D1), so a
    // fallback placement is a recorded failure, surfaced, never disguised.
    var placedBy = o.placedBy, reason = o.reason || null;
    if(placedBy === "fallback"){
      placedBy = "ai";
      reason = reason || "placement service unavailable — anchor/centre fallback";
    }
    if(placedBy !== "self" && placedBy !== "ai" && placedBy !== "facilitator") placedBy = null;

    return {
      contract_version: CONTRACT_VERSION,
      payload_type: "elicitation",
      capture_surface: "soundings",
      emitted_at: nowISO(),
      session: {
        external_id: o.sessionId,
        board_external_id: o.boardExternalId || ("board:" + o.sessionId),
        started_at: o.sessionStartedAt || nowISO()
      },
      elicitation: {
        question_text: o.questionText,
        assessments: [{
          person_ref: { display_name: o.person },
          // NULLs pass through as NULL — a gap renders as a gap, never coerced (D3).
          placement: {
            x: (o.x == null ? null : o.x),
            y: (o.y == null ? null : o.y),
            lane: (o.moat || null)
          },
          rationale: o.rationale || null,
          placed_by: placedBy,
          reason: reason,
          created_at: nowISO()
        }]
      }
    };
  }

  // Append the object to the Log. Best-effort: returns {ok, reason}; the caller
  // uses the result to surface a loud non-blocking notice, never to abort.
  async function elicitation(o){
    var url  = (typeof SUPABASE_URL  !== "undefined") ? SUPABASE_URL  : (window.SUPABASE_URL  || null);
    var anon = (typeof SUPABASE_ANON !== "undefined") ? SUPABASE_ANON : (window.SUPABASE_ANON || null);

    var obj;
    try { obj = buildElicitation(o); }
    catch(e){ console.error("[course_emit] build failed:", e && e.message); return { ok:false, reason:"build " + (e && e.message) }; }

    if(!url || !anon){
      console.error("[course_emit] Log emission SKIPPED — no backend config");
      return { ok:false, reason:"no backend config" };
    }
    try {
      var res = await fetch(url + "/rest/v1/course_captures", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "apikey":anon,
                  "Authorization":"Bearer " + anon, "Prefer":"return=minimal" },
        body: JSON.stringify({
          session_id: o.sessionId,
          capture_surface: "soundings",
          payload_type: "elicitation",
          schema_version: CONTRACT_VERSION,
          contract: obj,
          source_ref: o.sourceRef || null
        })
      });
      if(!res.ok){
        var t = await res.text();
        console.error("[course_emit] Log emission FAILED", res.status, t);
        return { ok:false, reason:"log http " + res.status };
      }
      console.log("[course_emit] Log capture written for", o.person, "(source " + (o.sourceRef||"—") + ")");
      return { ok:true, reason:null };
    } catch(e){
      console.error("[course_emit] Log emission FAILED (network):", e && e.message);
      return { ok:false, reason:"network " + (e && e.message) };
    }
  }

  window.CourseEmit = { CONTRACT_VERSION:CONTRACT_VERSION, buildElicitation:buildElicitation, elicitation:elicitation };
})();
