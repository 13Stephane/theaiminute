/* ============================================================================
   course_axis.js — shared axis brain for all Course display pages
   Source this on: show-cloud, show-map, show-paths, 3-path.
   It provides ONE identical control set and one mode decision, so the pages
   cannot drift or disagree.

   WHY A MODULE: "Auto" scores the room (moat entropy vs settledness spread).
   Room pages (cloud/map/paths) have a population to score. 3-path has two
   points, so it must INHERIT the room's mode — via course_sessions.axis_mode.

   USAGE (per page):
     <script src="course_axis.js"></script>
     // 1. mount the toggles into a container element:
     CourseAxis.mountControls(el, { allowAuto:true, onChange: rerender });
     // 2. at render time, get the resolved mode + draw:
     var coords = CourseAxis.makeCoords(pad, span);          // page's grid mapping
     var mode   = CourseAxis.chooseMode(points);             // honors toggle + hysteresis
     CourseAxis.renderAnchors(grid, mode, coords);           // faint reference anchors
     // ...page draws its own dots/paths using CourseAxis.colour() + coords...

   SESSION LOCK (optional, makes all pages agree):
     await CourseAxis.readSessionMode(URL, ANON, SID);   // room pages + 3-path read it
     await CourseAxis.writeSessionMode(URL, SVC, SID, m);// facilitator lock (control.html)
   ============================================================================ */
(function(){
  // ── taxonomy (8 classifier keys -> 7 display lanes) ──────────────────────
  var KEY2LANE = {
    scale:"scale", data:"data",
    workflow_embed:"workflow_sor", sor:"workflow_sor",
    switching:"switching", distribution:"distribution",
    reg:"reg", reputation:"reputation"
  };
  var LANE_ORDER = ["reputation","reg","distribution","switching","workflow_sor","data","scale"]; // top->bottom
  var LANE_META = {
    reputation:   { label:"Reputational capital",        colour:"rgb(130,200,195)" },
    reg:          { label:"Regulatory entrenchment",     colour:"rgb(190,135,205)" },
    distribution: { label:"Distribution leverage",       colour:"rgb(224,128,128)" },
    switching:    { label:"Switching costs",             colour:"rgb(206,150,110)" },
    workflow_sor: { label:"Workflow & system-of-record", colour:"rgb(224,168,96)"  },
    data:         { label:"Data network effects",        colour:"rgb(111,168,220)" },
    scale:        { label:"Infrastructure / scale",      colour:"rgb(127,191,127)" }
  };
  var ENUM_K = 7;
  var LENS_ANCHORS = {
    hyperscaler:{x:-0.62,y:-0.50,m:"distribution"}, chipmaker:{x:-0.52,y:-0.42,m:"scale"}, llm:{x:0.10,y:0.50,m:"scale"},
    saas:{x:-0.40,y:0.42,m:"workflow_embed"}, orchestrator:{x:0.62,y:0.48,m:"sor"}, inhouse:{x:-0.10,y:-0.30,m:"switching"}
  };
  var ANCHOR_LABEL = { hyperscaler:"Hyperscaler", chipmaker:"Chip", llm:"LLM", saas:"Vertical SaaS", orchestrator:"Orchestrator", inhouse:"In-house" };

  function laneOf(m){ return KEY2LANE[m] || null; }
  function colour(m){ var l=laneOf(m); return (l && LANE_META[l].colour) || "rgba(198,165,83,0.75)"; }

  // grid coordinate mapping; pad/span are percent (default 5%..95% like show-cloud)
  function makeCoords(pad, span){
    pad = (pad==null?5:pad); span = (span==null?90:span);
    return {
      toLeft:function(x){ return ((x+1)/2*span+pad).toFixed(2)+"%"; },     // x=-1 left (incumbent)
      toTop: function(y){ return ((-y+1)/2*span+pad).toFixed(2)+"%"; }     // y=+1 top (up for grabs)
    };
  }

  // ── discriminance scoring ────────────────────────────────────────────────
  function std(a){ if(a.length<2) return 0; var m=a.reduce(function(s,v){return s+v;},0)/a.length;
    var v=a.reduce(function(s,x){return s+(x-m)*(x-m);},0)/a.length; return Math.sqrt(v); }
  function settleScore(pts){ return Math.min(1, std(pts.filter(function(p){return p.y!=null;}).map(function(p){return p.y;}))); }
  function moatScore(pts){
    var ls=pts.map(function(p){return laneOf(p.moat_type||p.moat);}).filter(Boolean);
    if(!ls.length) return 0;
    var c={}; ls.forEach(function(l){c[l]=(c[l]||0)+1;});
    var n=ls.length,H=0; Object.keys(c).forEach(function(k){var p=c[k]/n; H-=p*Math.log(p);});
    return H/Math.log(ENUM_K);
  }

  // ── state + mode resolution ───────────────────────────────────────────────
  var state = { override:"auto", mode:null, showAnchors:true, margin:0.04, sessionMode:null };

  function chooseMode(pts){
    // explicit toggle wins
    if(state.override==="settle" || state.override==="moat"){ state.mode=state.override; return {s:settleScore(pts),m:moatScore(pts)}; }
    // auto, but if a session lock exists, inherit it (this is what 3-path uses)
    if(state.sessionMode==="settle" || state.sessionMode==="moat"){ state.mode=state.sessionMode; return {s:settleScore(pts),m:moatScore(pts)}; }
    if(pts.length<3){ state.mode="settle"; return {s:settleScore(pts),m:moatScore(pts)}; }
    var s=settleScore(pts), m=moatScore(pts);
    if(state.mode===null) state.mode=(m>=s)?"moat":"settle";
    else if(state.mode==="settle" && m>s+state.margin) state.mode="moat";
    else if(state.mode==="moat"  && s>m+state.margin) state.mode="settle";
    return {s:s,m:m};
  }

  // ── controls UI (segmented Auto/Settledness/Moat + Anchors on/off) ─────────
  function injectStyleOnce(){
    if(document.getElementById("course-axis-style")) return;
    var st=document.createElement("style"); st.id="course-axis-style";
    st.textContent =
      ".ca-controls{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:11px}"+
      ".ca-seg{display:flex;border:1px solid rgba(244,240,233,0.28)}"+
      ".ca-seg button{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:5px 11px;background:transparent;color:rgba(244,240,233,0.62);border:none;border-right:1px solid rgba(244,240,233,0.18);cursor:pointer}"+
      ".ca-seg button:last-child{border-right:none}"+
      ".ca-seg button.on{background:rgb(198,165,83);color:rgb(25,60,63)}"+
      ".ca-anchor-btn{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:5px 12px;border:1px solid rgba(244,240,233,0.28);color:rgba(244,240,233,0.62);background:transparent;cursor:pointer}"+
      ".ca-anchor-btn:hover{border-color:rgb(198,165,83);color:rgb(198,165,83)}"+
      ".ca-field{position:absolute;inset:0;z-index:1}"+
      ".ca-gl{position:absolute;background:rgba(244,240,233,0.18);z-index:2}"+
      ".ca-gl-h{top:50%;left:0;right:0;height:1px}.ca-gl-v{left:50%;top:0;bottom:0;width:1px}"+
      ".ca-lane{position:absolute;left:0;right:0;z-index:1}.ca-lane.empty{background:rgba(244,240,233,0.015)}"+
      ".ca-lane-lbl{position:absolute;left:8px;font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.06em;text-transform:uppercase;z-index:3;transform:translateY(-50%)}"+
      ".ca-pdot{position:absolute;width:12px;height:12px;border-radius:50%;transform:translate(-50%,-50%);z-index:10;border:1.5px solid rgba(244,240,233,0.55)}"+
      ".ca-dotlbl{position:absolute;font-family:\'IBM Plex Mono\',monospace;font-size:8.5px;color:rgba(244,240,233,0.8);white-space:nowrap;transform:translate(9px,-50%);z-index:11;pointer-events:none}";
    document.head.appendChild(st);
  }

  function mountControls(container, opts){
    opts = opts || {}; injectStyleOnce();
    var allowAuto = opts.allowAuto !== false;
    var onChange = opts.onChange || function(){};
    var wrap=document.createElement("div"); wrap.className="ca-controls";

    var seg=document.createElement("div"); seg.className="ca-seg";
    var L = opts.labels || {};
    var modes = allowAuto ? [["auto", L.auto||"Auto"],["settle", L.settle||"Settledness"],["moat", L.moat||"Moat"]]
                          : [["settle", L.settle||"Settledness"],["moat", L.moat||"Moat"]];
    modes.forEach(function(pair){
      var b=document.createElement("button"); b.textContent=pair[1]; b.dataset.m=pair[0];
      if(pair[0]===state.override) b.classList.add("on");
      b.onclick=function(){
        state.override=pair[0];
        [].forEach.call(seg.children,function(x){x.classList.toggle("on",x===b);});
        if(state.override!=="auto") state.mode=state.override;
        onChange();
      };
      seg.appendChild(b);
    });
    wrap.appendChild(seg);

    var ab=document.createElement("button"); ab.className="ca-anchor-btn";
    ab.textContent="Anchors: "+(state.showAnchors?"on":"off");
    ab.onclick=function(){ state.showAnchors=!state.showAnchors; ab.textContent="Anchors: "+(state.showAnchors?"on":"off"); onChange(); };
    wrap.appendChild(ab);

    container.appendChild(wrap);
  }

  // ── anchor rendering (both modes); coords = makeCoords(...) for THIS grid ──
  function renderAnchors(grid, mode, coords){
    if(!state.showAnchors) return;
    var laneH=100/LANE_ORDER.length;
    Object.keys(LENS_ANCHORS).forEach(function(k){
      var a=LENS_ANCHORS[k], top;
      if(mode==="moat"){
        var i=LANE_ORDER.indexOf(KEY2LANE[a.m]); if(i<0) return;
        var within=(1-(a.y+1)/2);
        top=(i*laneH+(0.18+within*0.64)*laneH)+"%";
      } else { top=coords.toTop(a.y); }
      var ring=document.createElement("div"); ring.className="ca-anchor";
      ring.style.cssText="position:absolute;width:16px;height:16px;border-radius:50%;border:1px dashed rgba(244,240,233,0.30);transform:translate(-50%,-50%);z-index:4;pointer-events:none;left:"+coords.toLeft(a.x)+";top:"+top;
      grid.appendChild(ring);
      var lbl=document.createElement("div"); lbl.className="ca-anchor";
      lbl.style.cssText="position:absolute;font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.06em;text-transform:uppercase;color:rgba(244,240,233,0.36);transform:translate(-50%,-50%);white-space:nowrap;z-index:4;pointer-events:none;left:"+coords.toLeft(a.x)+";top:calc("+top+" + 13px)";
      lbl.textContent=ANCHOR_LABEL[k]||k;
      grid.appendChild(lbl);
    });
  }
  function clearAnchors(grid){ [].slice.call(grid.querySelectorAll(".ca-anchor")).forEach(function(n){n.remove();}); }

  // ── session lock (course_sessions.axis_mode) ───────────────────────────────
  async function readSessionMode(URL, ANON, SID){
    try{
      var r=await fetch(URL+"/rest/v1/course_sessions?id=eq."+SID+"&select=axis_mode",
        { headers:{ "apikey":ANON, "Authorization":"Bearer "+ANON } });
      if(r.ok){ var rows=await r.json(); state.sessionMode=(rows[0]&&rows[0].axis_mode)||null; }
    }catch(e){ console.warn("axis_mode read:",e.message); }
    return state.sessionMode;
  }
  async function writeSessionMode(URL, KEY, SID, mode){
    try{
      await fetch(URL+"/rest/v1/course_sessions?id=eq."+SID,
        { method:"PATCH",
          headers:{ "Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+KEY,"Prefer":"return=minimal" },
          body: JSON.stringify({ axis_mode: mode }) });
    }catch(e){ console.warn("axis_mode write:",e.message); }
  }


  // position of a point in the current mode (for dots AND overlays like arrows)
  function pointPos(p, mode, coords){
    var left = coords.toLeft(p.x);
    if(mode==="moat"){
      var lane=laneOf(p.moat_type||p.moat); var i=LANE_ORDER.indexOf(lane);
      var laneH=100/LANE_ORDER.length;
      if(i<0) return { left:left, top:"50%" };
      var within=(p.y==null)?0.5:(1-(p.y+1)/2);
      return { left:left, top:(i*laneH+(0.18+within*0.64)*laneH).toFixed(2)+"%" };
    }
    return { left:left, top:coords.toTop(p.y==null?0:p.y) };
  }

  // Y-axis label text for the page to drop into its own yaxis element
  function yLabels(mode){
    return (mode==="moat")
      ? { top:"\u2191 furthest from silicon \u00b7 trust", title:"The moat stack", bottom:"\u2193 closest to silicon \u00b7 compute" }
      : { top:"\u2191 up for grabs", title:"Is the outcome settled?", bottom:"\u2193 locked in" };
  }

  function ensureField(grid){
    var f=grid.querySelector(".ca-field");
    if(!f){ f=document.createElement("div"); f.className="ca-field"; grid.insertBefore(f, grid.firstChild); }
    return f;
  }

  // The shared field — identical visuals everywhere. Draws gridlines (settle) or
  // 7 lanes (moat) + anchors + dots into a .ca-field child, leaving sibling
  // overlay layers (e.g. an <svg> for arrows) untouched.
  function renderField(grid, points, mode, coords, opts){
    opts = opts || {};
    var f = ensureField(grid); f.innerHTML = "";
    if(mode==="moat"){
      var counts={}; points.forEach(function(p){ var l=laneOf(p.moat_type||p.moat); if(l) counts[l]=(counts[l]||0)+1; });
      var laneH=100/LANE_ORDER.length;
      LANE_ORDER.forEach(function(lane,i){
        var top=i*laneH, n=counts[lane]||0;
        var band=document.createElement("div"); band.className="ca-lane"+(n===0?" empty":"");
        band.style.top=top+"%"; band.style.height=laneH+"%"; band.style.borderTop=(i>0)?"1px solid rgba(244,240,233,0.10)":"none";
        f.appendChild(band);
        var lbl=document.createElement("div"); lbl.className="ca-lane-lbl"; lbl.style.top=(top+laneH/2)+"%"; lbl.style.color=LANE_META[lane].colour;
        if(n===0) lbl.style.opacity="0.5";
        lbl.innerHTML=LANE_META[lane].label+' <span style="opacity:.6">'+(n||"\u00b7")+'</span>'; f.appendChild(lbl);
      });
    } else {
      var h=document.createElement("div"); h.className="ca-gl ca-gl-h"; f.appendChild(h);
      var v=document.createElement("div"); v.className="ca-gl ca-gl-v"; f.appendChild(v);
    }
    renderAnchors(f, mode, coords);
    if(opts.noDots) return f;
    points.forEach(function(p){
      if(p.x==null) return;
      var pos=pointPos(p, mode, coords);
      var d=document.createElement("div"); d.className="ca-pdot"+(opts.dotClass?(" "+opts.dotClass):"");
      d.style.left=pos.left; d.style.top=pos.top;
      d.style.background = p.color || colour(p.moat_type||p.moat);
      if(p.border) d.style.borderColor=p.border;
      if(p.label) d.title=p.label;
      f.appendChild(d);
      if(opts.showLabels && p.label){
        var L=document.createElement("div"); L.className="ca-dotlbl"; L.style.left=pos.left; L.style.top=pos.top; L.textContent=p.label; f.appendChild(L);
      }
    });
    return f;
  }

  window.CourseAxis = {
    KEY2LANE:KEY2LANE, LANE_ORDER:LANE_ORDER, LANE_META:LANE_META, ENUM_K:ENUM_K,
    LENS_ANCHORS:LENS_ANCHORS, ANCHOR_LABEL:ANCHOR_LABEL,
    laneOf:laneOf, colour:colour, makeCoords:makeCoords,
    settleScore:settleScore, moatScore:moatScore, chooseMode:chooseMode,
    mountControls:mountControls, renderAnchors:renderAnchors, clearAnchors:clearAnchors,
    pointPos:pointPos, yLabels:yLabels, renderField:renderField,
    readSessionMode:readSessionMode, writeSessionMode:writeSessionMode,
    state:state
  };
})();
