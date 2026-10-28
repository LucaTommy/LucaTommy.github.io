// Workbench: a small Blender in the browser, made for printing.
// Object / Edit Mode (vertex, edge, face), G R S with axis locks and typed values, extrude, inset, merge,
// fill, 3D cursor, outliner, properties, four shading modes, axis gizmo — and a Print tab that checks the
// model and sends it to the print bed above (printbed.js). Mesh maths lives in meshops.js.

import * as M from "./meshops.js?v=7";

const root = document.querySelector("[data-workbench]");
const $ = (s) => root.querySelector(s);
const $$ = (s) => [...root.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const PERF = window.PERF || { lite: false };
const S = (k, v) => I18N.s(k, v);

const BED = 256; // Bambu Lab A1 build volume, mm
const SAVE_KEY = "wb-scene-v3";
const PALETTE = [0xff6a13, 0xeeece6, 0x2a2a2e, 0x00ae42, 0xd7263d, 0xf5c400, 0x7cc4ff, 0x9a6bff];
const ADDABLE = [["plane", "Plane"], ["cube", "Cube"], ["uvsphere", "UV Sphere"], ["icosphere", "Ico Sphere"], ["cylinder", "Cylinder"], ["cone", "Cone"], ["torus", "Torus"]];

let started = false, near = false;
let applyQuality = () => {};

function boot() {
  if (started) return;
  started = true;
  $("[data-wb-open]").hidden = true;
  start().catch((err) => {
    console.warn("Workbench unavailable:", err);
    root.classList.add("broken");
  });
}

if (root) {
  const open = $("[data-wb-open]");
  open.addEventListener("click", boot);
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    near = true;
    if (!PERF.lite) boot();
    else open.hidden = started; // the visitor may have opened it already
  }, { rootMargin: "500px 0px" });
  io.observe(root);
  document.addEventListener("perfchange", () => {
    if (!started && near && !PERF.lite) boot();
    applyQuality();
  });
}

async function start() {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { TransformControls } = await import("three/addons/controls/TransformControls.js");
  const { STLExporter } = await import("three/addons/exporters/STLExporter.js");
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
  const V3 = THREE.Vector3;

  const view = $(".wb__view");
  const canvas = $(".wb__canvas");
  root.classList.add("ready");
  root.classList.toggle("touch", !finePointer);

  /* ═════════ Scene ═════════ */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !PERF.lite, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  let envReady = false;
  const ensureEnv = () => {
    if (envReady || PERF.lite) return;
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    envReady = true;
  };
  ensureEnv();

  // Two cameras, like Blender's perspective / orthographic toggle (Z up, millimetres)
  const persp = new THREE.PerspectiveCamera(40, 16 / 10, 1, 8000);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -8000, 8000);
  persp.up.set(0, 0, 1);
  ortho.up.set(0, 0, 1);
  persp.position.set(95, -120, 85);
  let cam = persp;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(80, -100, 160);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 5;
  scene.add(hemi, sun);

  // Blender's floor grid with red X and green Y axis lines, plus the A1 bed outline
  const aids = new THREE.Group();
  const grid = new THREE.GridHelper(600, 60, 0x575757, 0x4a4a4a);
  grid.rotation.x = Math.PI / 2;
  grid.material.transparent = true;
  grid.material.opacity = 0.9;
  const axisLine = (a, b, c) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: c }));
  const bedLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([[-128, -128], [128, -128], [128, 128], [-128, 128]].map(([x, y]) => new V3(x, y, 0.05))),
    new THREE.LineBasicMaterial({ color: 0x6b6b6b })
  );
  aids.add(grid, axisLine(new V3(-300, 0, 0.06), new V3(300, 0, 0.06), 0x9c3443), axisLine(new V3(0, -300, 0.06), new V3(0, 300, 0.06), 0x6a8b23), bedLine);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.receiveShadow = true;
  floor.visible = false;
  const objects = new THREE.Group();
  const overhangs = new THREE.Group();
  scene.add(aids, floor, objects, overhangs);

  const orbit = new OrbitControls(cam, canvas);
  orbit.target.set(0, 0, 10);
  orbit.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: -1 }; // Blender: middle mouse orbits
  orbit.zoomSpeed = 1.2;
  orbit.enableZoom = false; // switched on once the visitor clicks into the viewport
  orbit.update();

  const gizmo = new TransformControls(cam, canvas);
  gizmo.setSize(finePointer ? 0.9 : 1.3);
  scene.add(gizmo);
  const pivot = new THREE.Object3D();
  scene.add(pivot);

  /* ═════════ State ═════════ */
  let mode = "object", selMode = "vert", tool = "select", shading = "solid", xray = false, space = "global";
  let snapOn = false, inc = 5, keepBed = true, showOver = true, turntable = false, ptab = "object";
  let active = null;
  const selObjs = new Set();
  let editSel = new Set(); // selected vertex indices of the active object in Edit Mode
  const cursor3d = new V3();

  let needsRender = true;
  const invalidate = () => (needsRender = true);

  /* ═════════ Materials ═════════ */
  const solidMat = new THREE.MeshStandardMaterial({ color: 0xbababa, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x0b0b0b });
  const wireSelMat = new THREE.LineBasicMaterial({ color: 0xf08c33 });
  const wireActMat = new THREE.LineBasicMaterial({ color: 0xffc061 });
  const outlineSel = new THREE.LineBasicMaterial({ color: 0xf0802a });
  const outlineAct = new THREE.LineBasicMaterial({ color: 0xffb446 });

  function printMaterial(colour) {
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying float vWz;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\nvWz = (modelMatrix * vec4(transformed, 1.0)).z;");
      sh.fragmentShader = "varying float vWz;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float lz = vWz / 0.2; float aa = fwidth(lz);
        diffuseColor.rgb *= 1.0 - 0.16 * (1.0 - sin(fract(lz) * 3.14159)) * (1.0 - smoothstep(0.35, 0.9, aa));`);
    };
    return m;
  }
  function applyMaterial(o) {
    const u = o.userData;
    o.material = shading === "wire" ? hiddenMat : shading === "solid" ? solidMat : shading === "rendered" ? u.pmat : u.mat;
    u.wire.visible = shading === "wire" && !(mode === "edit" && o === active);
    u.wire.material = selObjs.has(o) && mode === "object" ? (o === active ? wireActMat : wireSelMat) : wireMat;
    u.outline.visible = mode === "object" && shading !== "wire" && selObjs.has(o);
    u.outline.material = o === active ? outlineAct : outlineSel;
  }
  function applyXray() {
    const mats = [solidMat, ...objects.children.flatMap((o) => [o.userData.mat, o.userData.pmat])];
    mats.forEach((m) => {
      m.transparent = xray;
      m.opacity = xray ? 0.4 : 1;
      m.depthWrite = !xray;
      m.needsUpdate = true;
    });
    if (overlay) [overlay.pts, overlay.lines].forEach((o) => (o.material.depthTest = !xray));
    $("[data-wb-xray]").setAttribute("aria-pressed", xray);
    invalidate();
  }

  /* ═════════ Objects ═════════ */
  const uniqueName = (base) => {
    const taken = new Set(objects.children.map((o) => o.userData.name));
    if (!taken.has(base)) return base;
    for (let i = 1; ; i++) { const n = `${base}.${String(i).padStart(3, "0")}`; if (!taken.has(n)) return n; }
  };

  function rebuild(o) {
    const u = o.userData;
    const { pos, nor, triFace } = M.triangulate(u.data);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    o.geometry.dispose();
    o.geometry = g;
    u.triFace = triFace;
    u.edges = M.edges(u.data);
    const wp = new Float32Array(u.edges.length * 6);
    u.edges.forEach(([a, b], i) => { wp.set(u.data.verts[a], i * 6); wp.set(u.data.verts[b], i * 6 + 3); });
    u.wire.geometry.dispose();
    u.wire.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(wp, 3));
    u.outline.geometry.dispose();
    u.outline.geometry = u.data.faces.length < 20000 ? new THREE.EdgesGeometry(g, 35) : new THREE.BufferGeometry();
    if (o === active && mode === "edit") rebuildOverlay();
    invalidate();
  }

  function addObject(data, opt = {}) {
    const wire = new THREE.LineSegments(new THREE.BufferGeometry(), wireMat);
    const outline = new THREE.LineSegments(new THREE.BufferGeometry(), outlineSel);
    outline.renderOrder = 5;
    const o = new THREE.Mesh(new THREE.BufferGeometry(), solidMat);
    o.add(wire, outline);
    const colour = opt.colour ?? PALETTE[objects.children.length % PALETTE.length];
    o.userData = {
      name: opt.keepName ? opt.name : uniqueName(opt.name || "Cube"), colour, data, wire, outline,
      hidden: !!opt.hidden, printable: opt.printable ?? true, locked: data.faces.length > 20000,
      mat: new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      pmat: printMaterial(colour),
    };
    o.castShadow = o.receiveShadow = true;
    if (opt.p) o.position.fromArray(opt.p);
    if (opt.q) o.quaternion.fromArray(opt.q);
    if (opt.s) o.scale.fromArray(opt.s);
    o.visible = !o.userData.hidden;
    objects.add(o);
    rebuild(o);
    applyMaterial(o);
    if (xray) applyXray();
    return o;
  }

  function removeObject(o) {
    o.geometry.dispose();
    o.userData.mat.dispose();
    o.userData.pmat.dispose();
    selObjs.delete(o);
    if (active === o) active = null;
    objects.remove(o);
  }

  const visibleObjs = () => objects.children.filter((o) => !o.userData.hidden);
  const printables = () => visibleObjs().filter((o) => o.userData.printable);
  const setColour = (o, c) => { o.userData.colour = c; o.userData.mat.color.setHex(c); o.userData.pmat.color.setHex(c); };

  /* ═════════ Undo / redo / autosave ═════════ */
  const undo = [], redo = [];
  const state = () => ({
    objs: objects.children.map((o) => ({
      name: o.userData.name, colour: o.userData.colour, data: M.clone(o.userData.data), hidden: o.userData.hidden, printable: o.userData.printable,
      p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(),
      sel: selObjs.has(o), active: o === active,
    })),
    mode, editSel: [...editSel],
  });
  function restore(st) {
    if (mode === "edit") detachOverlay();
    objects.children.slice().forEach(removeObject);
    selObjs.clear();
    active = null;
    st.objs.forEach((d) => {
      const o = addObject(d.data, { ...d, keepName: true });
      if (d.sel) selObjs.add(o);
      if (d.active) active = o;
    });
    mode = "object";
    if (st.mode === "edit" && active) { enterEdit(); editSel = new Set(st.editSel); rebuildOverlay(); }
    refresh();
  }
  function snapshot() {
    undo.push(state());
    if (undo.length > 60) undo.shift();
    redo.length = 0;
  }
  const doUndo = () => { if (!undo.length) return toast("Nothing to undo"); redo.push(state()); restore(undo.pop()); changed(); };
  const doRedo = () => { if (!redo.length) return toast("Nothing to redo"); undo.push(state()); restore(redo.pop()); changed(); };

  let saveTimer;
  function changed(save = true) {
    refresh();
    if (!save) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const st = state();
        st.objs = st.objs.filter((o) => o.data.verts.length < 15000);
        const json = JSON.stringify(st, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v));
        if (json.length < 3e6) localStorage.setItem(SAVE_KEY, json);
      } catch {}
    }, 500);
  }

  /* ═════════ Edit-mode overlay: vertices, edges, selected faces ═════════ */
  let overlay = null;
  function makeOverlay() {
    const group = new THREE.Group();
    const pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: finePointer ? 6 : 9, sizeAttenuation: false, vertexColors: true, depthTest: !xray }));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, depthTest: !xray }));
    const faces = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    pts.renderOrder = lines.renderOrder = 6;
    group.add(faces, lines, pts);
    return { group, pts, lines, faces };
  }
  function rebuildOverlay() {
    if (!overlay || !active) return;
    const d = active.userData.data, E = active.userData.edges;
    const black = [0.04, 0.04, 0.04], orange = [1, 0.55, 0.12], white = [1, 1, 1];
    const vp = new Float32Array(d.verts.length * 3), vc = new Float32Array(d.verts.length * 3);
    d.verts.forEach((v, i) => { vp.set(v, i * 3); vc.set(editSel.has(i) ? orange : black, i * 3); });
    overlay.pts.geometry.dispose();
    overlay.pts.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(vp, 3)).setAttribute("color", new THREE.BufferAttribute(vc, 3));
    overlay.pts.visible = selMode === "vert";
    const lp = new Float32Array(E.length * 6), lc = new Float32Array(E.length * 6);
    E.forEach(([a, b], i) => {
      lp.set(d.verts[a], i * 6); lp.set(d.verts[b], i * 6 + 3);
      const c = editSel.has(a) && editSel.has(b) ? orange : shading === "wire" ? white : black;
      lc.set(c, i * 6); lc.set(c, i * 6 + 3);
    });
    overlay.lines.geometry.dispose();
    overlay.lines.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(lp, 3)).setAttribute("color", new THREE.BufferAttribute(lc, 3));
    const F = M.selectedFaces(d, editSel), fp = [];
    for (const fi of F) { const f = d.faces[fi]; for (let i = 1; i < f.length - 1; i++) fp.push(...d.verts[f[0]], ...d.verts[f[i]], ...d.verts[f[i + 1]]); }
    overlay.faces.geometry.dispose();
    overlay.faces.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    invalidate();
  }
  function detachOverlay() { overlay?.group.removeFromParent(); }

  /* ═════════ Picking ═════════ */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const rect = () => canvas.getBoundingClientRect();
  function setRay(px) {
    const r = rect();
    ndc.set((px.x / r.width) * 2 - 1, -(px.y / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  }
  function project(w) {
    const r = rect(), p = w.clone().project(cam);
    return { x: ((p.x + 1) / 2) * r.width, y: ((1 - p.y) / 2) * r.height, behind: p.z > 1 || p.z < -1 };
  }
  const hitObject = (px) => { setRay(px); return ray.intersectObjects(visibleObjs(), false)[0]; };
  function seen(w) {
    if (xray) return true;
    const p = project(w);
    setRay(p);
    const h = ray.intersectObject(active, false)[0];
    const dist = ray.ray.origin.distanceTo(w);
    return !h || h.distance > dist - Math.max(0.05, dist * 0.004);
  }
  const worldVert = (i) => new V3(...active.userData.data.verts[i]).applyMatrix4(active.matrixWorld);

  function pickEdit(px) {
    const u = active.userData;
    if (selMode === "face") {
      setRay(px);
      const h = ray.intersectObject(active, false)[0];
      return h ? u.data.faces[u.triFace[h.faceIndex]] : null;
    }
    let best = null, bestD = selMode === "vert" ? 14 : 10;
    if (selMode === "vert") {
      u.data.verts.forEach((_, i) => {
        const w = worldVert(i), p = project(w);
        const d = Math.hypot(p.x - px.x, p.y - px.y);
        if (!p.behind && d < bestD && seen(w)) { bestD = d; best = [i]; }
      });
    } else {
      for (const [a, b] of u.edges) {
        const wa = worldVert(a), wb = worldVert(b), pa = project(wa), pb = project(wb);
        if (pa.behind || pb.behind) continue;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((px.x - pa.x) * dx + (px.y - pa.y) * dy) / L));
        const d = Math.hypot(pa.x + dx * t - px.x, pa.y + dy * t - px.y);
        if (d < bestD && seen(wa.clone().lerp(wb, 0.5))) { bestD = d; best = [a, b]; }
      }
    }
    return best;
  }

  function clickSelect(px, extend) {
    if (mode === "object") {
      const h = hitObject(px);
      if (!h) { if (!extend) { selObjs.clear(); active = null; } return; }
      const o = h.object;
      if (extend) {
        if (selObjs.has(o) && active === o) { selObjs.delete(o); active = null; }
        else { selObjs.add(o); active = o; }
      } else { selObjs.clear(); selObjs.add(o); active = o; }
    } else {
      const el = pickEdit(px);
      if (!el) { if (!extend) editSel.clear(); return; }
      if (extend) {
        const all = el.every((v) => editSel.has(v));
        el.forEach((v) => (all ? editSel.delete(v) : editSel.add(v)));
      } else editSel = new Set(el);
    }
  }

  function boxSelect(a, b, how) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const inside = (p) => !p.behind && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    if (mode === "object") {
      if (how === "set") { selObjs.clear(); active = null; }
      for (const o of visibleObjs()) {
        const vs = o.userData.data.verts, step = Math.max(1, Math.floor(vs.length / 400));
        let hit = false;
        for (let i = 0; i < vs.length && !hit; i += step) hit = inside(project(new V3(...vs[i]).applyMatrix4(o.matrixWorld)));
        if (!hit) continue;
        if (how === "sub") selObjs.delete(o);
        else { selObjs.add(o); active ||= o; }
      }
      if (active && !selObjs.has(active)) active = [...selObjs][0] || null;
    } else {
      if (how === "set") editSel.clear();
      active.userData.data.verts.forEach((_, i) => {
        const w = worldVert(i);
        if (!inside(project(w)) || !seen(w)) return;
        how === "sub" ? editSel.delete(i) : editSel.add(i);
      });
      if (selMode === "face") {
        // in face mode only keep vertices of fully enclosed faces
        const keep = new Set();
        M.selectedFaces(active.userData.data, editSel).forEach((fi) => active.userData.data.faces[fi].forEach((v) => keep.add(v)));
        editSel = keep;
      }
    }
  }

  function placeCursor(px) {
    const h = hitObject(px);
    if (h) cursor3d.copy(h.point);
    else {
      setRay(px);
      const p = new V3();
      if (ray.ray.intersectPlane(new THREE.Plane(new V3(0, 0, 1), 0), p)) cursor3d.copy(p);
    }
    invalidate();
  }

  /* ═════════ Transforms: sessions shared by the gizmo and the G/R/S modal ═════════ */
  function selectionPivot() {
    if (mode === "object") {
      const list = [...selObjs];
      if (!list.length) return null;
      return list.reduce((s, o) => s.add(o.getWorldPosition(new V3())), new V3()).divideScalar(list.length);
    }
    if (!editSel.size) return null;
    return [...editSel].reduce((s, i) => s.add(worldVert(i)), new V3()).divideScalar(editSel.size);
  }
  function beginSession(idx = null) {
    objects.updateMatrixWorld(true);
    if (mode === "object") return { kind: "obj", items: [...selObjs].map((o) => ({ o, m: o.matrixWorld.clone() })) };
    const ids = idx || [...editSel];
    return { kind: "edit", ids, start: ids.map((i) => worldVert(i)), inv: active.matrixWorld.clone().invert() };
  }
  const tmp = new THREE.Matrix4();
  function applySession(s, D) {
    if (s.kind === "obj") {
      for (const { o, m } of s.items) tmp.multiplyMatrices(D, m).decompose(o.position, o.quaternion, o.scale);
    } else {
      const d = active.userData.data;
      s.ids.forEach((i, k) => {
        const p = s.start[k].clone().applyMatrix4(D).applyMatrix4(s.inv);
        d.verts[i] = [p.x, p.y, p.z];
      });
      rebuild(active);
    }
    invalidate();
  }
  function afterTransform() {
    if (mode === "object" && keepBed) for (const o of selObjs) dropToBed(o, true);
    changed();
  }
  function worldBox(o) {
    o.updateMatrixWorld(true);
    const b = new THREE.Box3();
    for (const v of o.userData.data.verts) b.expandByPoint(new V3(...v).applyMatrix4(o.matrixWorld));
    return b;
  }
  function dropToBed(o, onlyIfBelow = false) {
    const z = worldBox(o).min.z;
    if (!onlyIfBelow || z < 0) o.position.z -= z;
  }

  // gizmo tools (Move / Rotate / Scale)
  let gSess = null;
  const pivotStart = new THREE.Matrix4();
  gizmo.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value));
  gizmo.addEventListener("mouseDown", () => {
    snapshot();
    pivot.updateMatrixWorld(true);
    pivotStart.copy(pivot.matrixWorld);
    gSess = beginSession();
  });
  gizmo.addEventListener("objectChange", () => {
    if (!gSess) return;
    pivot.updateMatrixWorld(true);
    applySession(gSess, new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, pivotStart.clone().invert()));
    refreshStats();
  });
  gizmo.addEventListener("mouseUp", () => { if (gSess) { gSess = null; afterTransform(); } });
  gizmo.addEventListener("change", invalidate);

  function refreshGizmo() {
    const p = ["move", "rotate", "scale"].includes(tool) && !modal ? selectionPivot() : null;
    if (!p) { gizmo.detach(); return invalidate(); }
    pivot.position.copy(p);
    pivot.quaternion.copy(space === "local" && active ? active.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion());
    pivot.scale.set(1, 1, 1);
    gizmo.setMode({ move: "translate", rotate: "rotate", scale: "scale" }[tool]);
    gizmo.setSpace(space === "local" ? "local" : "world");
    applySnap();
    gizmo.attach(pivot);
    invalidate();
  }
  function applySnap() {
    gizmo.setTranslationSnap(snapOn ? inc : null);
    gizmo.setRotationSnap(snapOn ? THREE.MathUtils.degToRad(5) : null);
    gizmo.setScaleSnap(snapOn ? 0.1 : null);
  }

  /* ═════════ Modal operators: G / R / S, extrude, inset — Blender style ═════════ */
  let modal = null;
  const mouse = { x: 0, y: 0 };
  const AXES = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) };

  function startModal(kind, opt = {}) {
    if (modal) return;
    const pv = opt.pivot || selectionPivot();
    if (!pv) return toast(mode === "edit" ? "Select something first" : "Select an object first");
    if (!opt.noSnapshot) snapshot();
    modal = { kind, pivot: pv, axis: opt.axis || null, axisVec: opt.axisVec || null, typed: "", m0: { ...mouse }, sess: opt.sess || beginSession(), items: opt.items, touch: !!opt.touch, cancelRestore: opt.cancelRestore };
    gizmo.detach();
    orbit.enabled = false;
    root.classList.add("modal");
    updateModal();
  }

  function modalAxis() {
    if (modal.axisVec) return modal.axisVec;
    if (!modal.axis) return null;
    const a = AXES[modal.axis].clone();
    if (space === "local" && mode === "object" && active) a.applyQuaternion(active.getWorldQuaternion(new THREE.Quaternion()));
    return a;
  }

  function updateModal() {
    if (!modal) return;
    const m = modal, p = m.pivot, ax = modalAxis();
    const ps = project(p), dm = { x: mouse.x - m.m0.x, y: mouse.y - m.m0.y };
    const typed = m.typed !== "" && m.typed !== "-" ? parseFloat(m.typed) : null;
    const snap = snapOn !== !!modal.ctrl; // Ctrl inverts the snap toggle, as in Blender
    const D = new THREE.Matrix4();
    let label = "";
    const T = (v) => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
    const about = (R) => T(p).multiply(R).multiply(T(p.clone().negate()));

    if (m.kind === "move" || m.kind === "extrude") {
      let t;
      if (ax) {
        const s1 = project(p.clone().add(ax.clone().multiplyScalar(10)));
        const sv = { x: s1.x - ps.x, y: s1.y - ps.y }, l2 = sv.x * sv.x + sv.y * sv.y;
        let dist = typed ?? (l2 > 4 ? ((dm.x * sv.x + dm.y * sv.y) / l2) * 10 : 0);
        if (snap && typed == null) dist = Math.round(dist / inc) * inc;
        t = ax.clone().multiplyScalar(dist);
        label = `D: ${dist.toFixed(2)} mm along ${m.kind === "extrude" && m.axisVec ? "normal" : `${space === "local" ? "local" : "global"} ${m.axis.toUpperCase()}`}`;
      } else {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cam.getWorldDirection(new V3()), p);
        const a = new V3(), b = new V3();
        setRay(m.m0); ray.ray.intersectPlane(plane, a);
        setRay(mouse); ray.ray.intersectPlane(plane, b);
        t = b.sub(a);
        if (typed != null) t.set(typed, 0, 0);
        if (snap && typed == null) t.set(Math.round(t.x / inc) * inc, Math.round(t.y / inc) * inc, Math.round(t.z / inc) * inc);
        label = `D: ${t.x.toFixed(2)}  ${t.y.toFixed(2)}  ${t.z.toFixed(2)} mm (${t.length().toFixed(2)} mm)`;
      }
      D.copy(T(t));
      label = (m.kind === "extrude" ? "Extrude  " : "Move  ") + label;
    } else if (m.kind === "rotate") {
      const v0 = { x: m.m0.x - ps.x, y: m.m0.y - ps.y }, v1 = { x: mouse.x - ps.x, y: mouse.y - ps.y };
      let deg = THREE.MathUtils.radToDeg(Math.atan2(v0.x * v1.y - v0.y * v1.x, v0.x * v1.x + v0.y * v1.y));
      const fwd = cam.getWorldDirection(new V3());
      let axis;
      if (typed != null) {
        // typed: counter-clockwise around the axis (or around the view, facing you)
        deg = typed;
        axis = ax ? ax.clone() : fwd.clone().negate();
      } else {
        // dragged: follows the mouse around the pivot on screen
        if (snap) deg = Math.round(deg / 5) * 5;
        axis = ax ? ax.clone().multiplyScalar(Math.sign(ax.dot(fwd)) || 1) : fwd;
      }
      D.copy(about(new THREE.Matrix4().makeRotationAxis(axis.normalize(), THREE.MathUtils.degToRad(deg))));
      label = `Rotate  ${deg.toFixed(1)}°${m.axis ? `  ${m.axis.toUpperCase()} axis` : ""}`;
    } else if (m.kind === "scale") {
      const d0 = Math.hypot(m.m0.x - ps.x, m.m0.y - ps.y) || 1;
      let f = typed ?? Math.hypot(mouse.x - ps.x, mouse.y - ps.y) / d0;
      if (snap && typed == null) f = Math.round(f * 10) / 10;
      let Sm;
      if (ax) { const a = ax.clone().normalize(); Sm = new THREE.Matrix4().set(
        1 + (f - 1) * a.x * a.x, (f - 1) * a.x * a.y, (f - 1) * a.x * a.z, 0,
        (f - 1) * a.y * a.x, 1 + (f - 1) * a.y * a.y, (f - 1) * a.y * a.z, 0,
        (f - 1) * a.z * a.x, (f - 1) * a.z * a.y, 1 + (f - 1) * a.z * a.z, 0, 0, 0, 0, 1); }
      else Sm = new THREE.Matrix4().makeScale(f, f, f);
      D.copy(about(Sm));
      label = `Scale  ${f.toFixed(3)}${m.axis ? `  along ${m.axis.toUpperCase()}` : ""}`;
    } else if (m.kind === "inset") {
      const d0 = Math.hypot(m.m0.x - ps.x, m.m0.y - ps.y) || 1;
      const s1 = project(p.clone().add(cam.up.clone().applyQuaternion(cam.quaternion).multiplyScalar(10)));
      const pxPerMm = Math.max(0.05, Math.hypot(s1.x - ps.x, s1.y - ps.y) / 10);
      let t = typed ?? Math.max(0, (d0 - Math.hypot(mouse.x - ps.x, mouse.y - ps.y)) / pxPerMm + 1);
      if (snap && typed == null) t = Math.round(t);
      M.setInset(active.userData.data, m.items, t);
      rebuild(active);
      label = `Inset  thickness ${t.toFixed(2)} mm`;
    }
    if (m.kind !== "inset") applySession(m.sess, D);
    $("[data-wb-modal]").textContent = `${label}${m.typed ? `   [${m.typed}]` : ""}`;
    $("[data-wb-modal]").hidden = false;
    refreshStats();
  }

  function endModal(ok) {
    if (!modal) return;
    const m = modal;
    modal = null;
    root.classList.remove("modal");
    $("[data-wb-modal]").hidden = true;
    orbit.enabled = true;
    if (ok) afterTransform();
    else {
      // cancel: back to how it was before the operator started
      const st = undo.pop();
      if (st) restore(st);
    }
    refreshGizmo();
    refresh();
    void m;
  }

  /* ═════════ Operators ═════════ */
  function addPrimitive(type, label) {
    const data = M.prim(type);
    if (mode === "edit" && active) {
      // Blender: in Edit Mode a new primitive joins the mesh you're editing
      snapshot();
      const local = active.matrixWorld.clone().invert().multiply(new THREE.Matrix4().makeTranslation(cursor3d.x, cursor3d.y, cursor3d.z));
      M.transform(data, local.elements);
      const base = active.userData.data.verts.length;
      M.append(active.userData.data, data);
      editSel = new Set(data.verts.map((_, i) => base + i));
      rebuild(active);
      return changed();
    }
    snapshot();
    const o = addObject(data, { name: label, p: cursor3d.toArray() });
    if (keepBed) dropToBed(o, true);
    selObjs.clear();
    selObjs.add(o);
    active = o;
    changed();
  }

  function duplicate() {
    if (mode === "edit") {
      if (!editSel.size) return;
      snapshot();
      const d = active.userData.data, F = M.selectedFaces(d, editSel);
      if (!F.length) return toast("Duplicate needs whole faces");
      const map = new Map(), add = [];
      F.forEach((fi) => add.push(d.faces[fi].map((v) => { if (!map.has(v)) map.set(v, d.verts.push(d.verts[v].slice()) - 1); return map.get(v); })));
      d.faces.push(...add);
      editSel = new Set(map.values());
      rebuild(active);
      return startModal("move", { noSnapshot: true });
    }
    if (!selObjs.size) return;
    snapshot();
    const copies = [...selObjs].map((o) => {
      const c = addObject(M.clone(o.userData.data), { name: o.userData.name.replace(/\.\d{3}$/, ""), colour: o.userData.colour, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() });
      if (o === active) active = c;
      return c;
    });
    selObjs.clear();
    copies.forEach((c) => selObjs.add(c));
    refresh();
    startModal("move", { noSnapshot: true });
  }

  function del() {
    if (mode === "edit") {
      if (!editSel.size) return;
      snapshot();
      M.remove(active.userData.data, editSel, { vert: "verts", edge: "edges", face: "faces" }[selMode]);
      editSel.clear();
      rebuild(active);
      return changed();
    }
    if (!selObjs.size) return;
    snapshot();
    [...selObjs].forEach(removeObject);
    changed();
  }

  function extrudeOp(touch) {
    if (mode !== "edit") return toast("Extrude works in Edit Mode (Tab)");
    const d = active.userData.data, F = M.selectedFaces(d, editSel);
    if (!F.length) return toast("Select one or more faces to extrude");
    snapshot();
    const { moved, normal } = M.extrude(d, F);
    editSel = new Set(moved);
    rebuild(active);
    const n = new V3(...normal).transformDirection(active.matrixWorld);
    startModal("extrude", { noSnapshot: true, axisVec: n, touch });
  }

  function insetOp(touch) {
    if (mode !== "edit") return toast("Inset works in Edit Mode (Tab)");
    const d = active.userData.data, F = M.selectedFaces(d, editSel);
    if (!F.length) return toast("Select one or more faces to inset");
    snapshot();
    const items = M.inset(d, F);
    editSel = new Set(items.flatMap((it) => it.inner));
    rebuild(active);
    startModal("inset", { noSnapshot: true, items, touch, sess: { kind: "none" } });
  }

  function editOp(fn, need = 1, msg = "") {
    if (mode !== "edit") return;
    if (editSel.size < need) return toast(msg || "Select more vertices");
    snapshot();
    fn(active.userData.data);
    rebuild(active);
    changed();
  }

  function joinObjects() {
    if (mode !== "object" || !active || selObjs.size < 2) return toast("Select two or more objects (the active one keeps the name)");
    snapshot();
    const inv = active.matrixWorld.clone().invert();
    for (const o of [...selObjs]) {
      if (o === active) continue;
      M.append(active.userData.data, M.transform(M.clone(o.userData.data), new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).elements));
      removeObject(o);
    }
    selObjs.clear();
    selObjs.add(active);
    rebuild(active);
    changed();
  }

  function originToGeometry() {
    if (mode !== "object") return;
    snapshot();
    for (const o of selObjs) {
      const d = o.userData.data, c = M.centroid(d, d.verts.map((_, i) => i));
      d.verts = d.verts.map((v) => [v[0] - c[0], v[1] - c[1], v[2] - c[2]]);
      o.position.add(new V3(...c).applyMatrix3(new THREE.Matrix3().setFromMatrix4(o.matrixWorld)));
      rebuild(o);
    }
    changed();
  }

  function setSmooth(v) {
    snapshot();
    const list = mode === "edit" ? [active] : [...selObjs];
    list.forEach((o) => { o.userData.data.smooth = v; rebuild(o); });
    changed();
  }

  function selectAll(how) {
    if (mode === "object") {
      if (how === "none") { selObjs.clear(); active = null; }
      else if (how === "invert") { const was = new Set(selObjs); selObjs.clear(); visibleObjs().forEach((o) => !was.has(o) && selObjs.add(o)); active = [...selObjs][0] || null; }
      else { visibleObjs().forEach((o) => selObjs.add(o)); active ||= [...selObjs][0] || null; }
    } else {
      const n = active.userData.data.verts.length;
      if (how === "none") editSel.clear();
      else if (how === "invert") editSel = new Set([...Array(n).keys()].filter((i) => !editSel.has(i)));
      else editSel = new Set(Array.from({ length: n }, (_, i) => i));
    }
    refresh();
  }

  function hide(on) {
    if (mode !== "object") return;
    snapshot();
    if (on) { for (const o of selObjs) o.userData.hidden = true; selObjs.clear(); active = null; }
    else objects.children.forEach((o) => (o.userData.hidden = false));
    objects.children.forEach((o) => (o.visible = !o.userData.hidden));
    changed();
  }

  /* ═════════ Modes, tools, shading, views ═════════ */
  function enterEdit() {
    mode = "edit";
    selObjs.clear();
    selObjs.add(active);
    overlay ||= makeOverlay();
    active.add(overlay.group);
    editSel = new Set();
  }
  function setMode(m) {
    if (modal) endModal(true);
    if (m === mode) return;
    if (m === "edit") {
      if (!active) return toast("Select an object to edit");
      if (active.userData.locked) return toast("This mesh is too dense to edit here");
      enterEdit();
      rebuildOverlay();
    } else {
      mode = "object";
      detachOverlay();
      if (["extrude", "inset"].includes(tool)) tool = "select";
    }
    refresh();
  }
  function setTool(t) {
    if (t === "extrude") return extrudeOp(!finePointer);
    if (t === "inset") return insetOp(!finePointer);
    if (t === "addcube") return addPrimitive("cube", "Cube");
    tool = t;
    refresh();
  }
  function setShading(s) {
    shading = s;
    if (s === "material" || s === "rendered") ensureEnv();
    objects.children.forEach(applyMaterial);
    floor.visible = s === "rendered";
    aids.visible = s !== "rendered";
    sun.castShadow = s === "rendered" && !PERF.lite;
    root.classList.toggle("shade-rendered", s === "rendered");
    orbit.autoRotate = s === "rendered" && turntable;
    $$("[data-shade]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.shade === s));
    buildOverhangs();
    rebuildOverlay();
    invalidate();
  }

  // Views (numpad), framing, perspective / orthographic
  let viewAxis = null; // "Top", "Front", … while looking straight down an axis
  let fly = null;
  function useOrtho(on) {
    const dist = cam.position.distanceTo(orbit.target);
    if (on && cam === persp) {
      ortho.position.copy(persp.position);
      ortho.quaternion.copy(persp.quaternion);
      ortho.userData.h = dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
      ortho.zoom = 1;
      cam = ortho;
    } else if (!on && cam === ortho) {
      const d = (ortho.userData.h / Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))) / ortho.zoom;
      persp.position.copy(orbit.target).add(ortho.position.clone().sub(orbit.target).setLength(d));
      persp.quaternion.copy(ortho.quaternion);
      cam = persp;
    } else return;
    orbit.object = cam;
    gizmo.camera = cam;
    resize();
    orbit.update();
    refreshInfo();
  }
  const VIEWS = { front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1] };
  function setView(name) {
    const dist = cam === ortho ? (ortho.userData.h / Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))) / ortho.zoom : cam.position.distanceTo(orbit.target);
    const dir = new V3(...VIEWS[name]);
    if (name === "top" || name === "bottom") dir.y -= 0.0001;
    flyTo(orbit.target.clone().add(dir.normalize().multiplyScalar(dist)), orbit.target.clone(), () => {
      orbit.userData = {}; // forget the last drag, so this isn't mistaken for orbiting away
      viewAxis = name[0].toUpperCase() + name.slice(1);
      useOrtho(true);
      refreshInfo();
    });
  }
  function frame(list) {
    const pts = [];
    if (mode === "edit" && list === "sel") [...editSel].forEach((i) => pts.push(worldVert(i)));
    else (list === "sel" ? [...selObjs] : visibleObjs()).forEach((o) => { const b = worldBox(o); pts.push(b.min, b.max); });
    if (!pts.length) return;
    const b = new THREE.Box3().setFromPoints(pts), c = b.getCenter(new V3());
    const r = Math.max(8, b.getSize(new V3()).length() / 2);
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2))) * 1.1;
    const dir = cam.position.clone().sub(orbit.target).normalize();
    if (cam === ortho) { ortho.userData.h = r * 1.15; ortho.zoom = 1; }
    flyTo(c.clone().add(dir.multiplyScalar(dist)), c);
  }
  function flyTo(pos, target, done) {
    if (reduced) { cam.position.copy(pos); orbit.target.copy(target); orbit.update(); done?.(); return invalidate(); }
    fly = { p0: cam.position.clone(), p1: pos, t0: orbit.target.clone(), t1: target, t: 0, done };
  }
  // leaving an axis view by orbiting goes back to perspective (Blender's "auto perspective")
  orbit.addEventListener("start", () => (orbit.userData = { q: cam.quaternion.clone() }));
  orbit.addEventListener("change", () => {
    if (viewAxis && orbit.userData?.q && cam.quaternion.angleTo(orbit.userData.q) > 0.01) {
      viewAxis = null;
      useOrtho(false);
    }
    invalidate();
    refreshInfo();
  });

  /* ═════════ Print check ═════════ */
  function worldTriangles(list) {
    const out = [];
    list.forEach((o) => {
      o.updateMatrixWorld(true);
      const pos = o.geometry.attributes.position.array, v = new V3();
      for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
    });
    return new Float32Array(out);
  }
  function analyse() {
    const list = printables();
    const tri = worldTriangles(list);
    const boxes = list.map(worldBox);
    const all = boxes.reduce((b, x) => b.union(x), new THREE.Box3());
    const grounded = boxes.map((b) => b.min.z < 0.6);
    for (let again = true; again; ) {
      again = false;
      boxes.forEach((b, i) => {
        if (grounded[i]) return;
        const nb = b.clone().expandByScalar(0.6);
        if (boxes.some((o, j) => grounded[j] && nb.intersectsBox(o))) grounded[i] = again = true;
      });
    }
    let area = 0, over = 0, vol = 0;
    const red = [];
    for (let i = 0; i < tri.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = tri.subarray(i, i + 9);
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
      area += len / 2;
      if (len && nz / len < -0.7071 && Math.min(az, bz, cz) > 0.3) { over += len / 2; red.push(ax, ay, az, bx, by, bz, cx, cy, cz); }
    }
    return { empty: !list.length, size: all.isEmpty() ? new V3() : all.getSize(new V3()), minZ: all.min.z, floating: grounded.filter((g) => !g).length, overPct: area ? (over / area) * 100 : 0, red, volume: Math.abs(vol), tri };
  }
  const overMat = new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  function buildOverhangs(r) {
    overhangs.children.forEach((c) => c.geometry.dispose());
    overhangs.clear();
    if (shading !== "rendered" || !showOver) return;
    r ||= analyse();
    if (!r.red.length) return;
    overhangs.add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(r.red, 3)), overMat));
    invalidate();
  }

  function sendToPrinter() {
    const r = analyse();
    if (r.empty) return toast(S("wb.empty"));
    if (Math.max(r.size.x, r.size.y, r.size.z) > BED) return toast(S("wb.c.big"));
    if (mode === "edit") setMode("object");
    const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(r.tri, 3));
    setFull(false);
    toast(S("wb.sent"));
    window.printbed?.send(g, { nameKey: "bed.wbName", creditKey: "bed.fromWb", layer: 0.2 });
  }
  function exportSTL() {
    const r = analyse();
    if (r.empty) return toast(S("wb.empty"));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(r.tri, 3)));
    download(new Blob([new STLExporter().parse(mesh, { binary: true })], { type: "model/stl" }), "workbench.stl");
  }
  function saveImage() {
    const keep = gizmo.visible;
    gizmo.visible = false;
    renderer.setClearColor(shading === "rendered" ? 0xecebe6 : 0x3d3d3d, 1);
    renderer.render(scene, cam);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "workbench.png";
    a.click();
    renderer.setClearColor(0x000000, 0);
    gizmo.visible = keep;
    invalidate();
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // STL import
  const stl = new STLLoader();
  $("[data-wb-import]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !/\.stl$/i.test(file.name)) return toast(S("bed.stlOnly"));
    if (file.size > 80e6) return toast(S("bed.stlBig"));
    const g = stl.parse(await file.arrayBuffer());
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new V3()), mx = Math.max(size.x, size.y, size.z);
    g.center();
    if (mx > 200) g.scale(200 / mx, 200 / mx, 200 / mx);
    const data = M.fromTriangles(g.attributes.position.array);
    if (mode === "edit") setMode("object");
    snapshot();
    const o = addObject(data, { name: file.name.replace(/\.stl$/i, ""), colour: 0xeeece6, p: cursor3d.toArray() });
    dropToBed(o);
    selObjs.clear();
    selObjs.add(o);
    active = o;
    changed();
    frame("sel");
    if (o.userData.locked) toast("Dense mesh: Object Mode only");
  });

  /* ═════════ Templates (File menu) ═════════ */
  const deg = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d)))).toArray();
  const C = { o: 0xff6a13, w: 0xeeece6, k: 0x2a2a2e, g: 0x00ae42, r: 0xd7263d, b: 0x7cc4ff };
  const bake = (type, s) => M.transform(M.prim(type), new THREE.Matrix4().makeScale(...s).elements);
  const TEMPLATES = {
    cube: () => [{ data: M.prim("cube"), name: "Cube", colour: C.o, p: [0, 0, 10] }],
    robot: () => [
      { data: bake("cylinder", [1.4, 1.4, 0.3]), name: "Base", colour: C.w, p: [0, 0, 3] },
      { data: bake("cube", [1, 0.8, 1.1]), name: "Body", colour: C.o, p: [0, 0, 17] },
      { data: bake("uvsphere", [0.9, 0.9, 0.9]), name: "Head", colour: C.w, p: [0, 0, 36] },
      { data: bake("cylinder", [0.15, 0.15, 0.6]), name: "Antenna", colour: C.k, p: [0, 0, 48] },
      { data: bake("torus", [0.45, 0.45, 0.6]), name: "Halo", colour: C.g, p: [0, 0, 55] },
    ],
    stand: () => [
      { data: bake("cube", [3.5, 3, 0.25]), name: "Base", colour: C.k, p: [0, 0, 2.5] },
      { data: bake("cube", [3.5, 0.3, 3]), name: "Back", colour: C.o, p: [0, 12, 30], q: deg([-20, 0, 0]) },
      { data: bake("cube", [3.5, 0.5, 0.6]), name: "Lip", colour: C.o, p: [0, -24, 11] },
    ],
    pen: () => {
      // a cylinder hollowed with Inset + Extrude — the same tools as in Edit Mode
      const cup = (r, h) => {
        const d = bake("cylinder", [r / 10, r / 10, h / 20]);
        const top = d.faces.findIndex((f) => M.newell(d, f)[2] > 0 && f.length > 4);
        M.setInset(d, M.inset(d, [top]), 2.4);
        const { moved } = M.extrude(d, [top]);
        moved.forEach((i) => (d.verts[i][2] -= h - 3));
        return d;
      };
      return [
        { data: cup(20, 80), name: "Cup", colour: C.w, p: [0, 0, 40] },
        { data: cup(13, 52), name: "Cup", colour: C.o, p: [28, 14, 26] },
      ];
    },
    key: () => [
      { data: bake("cylinder", [2.2, 1.3, 0.2]), name: "Tag", colour: C.g, p: [0, 0, 2] },
      { data: bake("torus", [0.6, 0.6, 0.6]), name: "Ring", colour: C.k, p: [-24, 0, 2.1] },
      { data: bake("cube", [0.3, 1, 0.15]), name: "L", colour: C.w, p: [4, 0, 5.5] },
      { data: bake("cube", [1, 0.3, 0.15]), name: "L", colour: C.w, p: [11, -7, 5.5] },
    ],
    rocket: () => [
      { data: bake("cylinder", [1, 1, 2.5]), name: "Body", colour: C.w, p: [0, 0, 25] },
      { data: M.prim("cone"), name: "Nose", colour: C.r, p: [0, 0, 60] },
      { data: bake("uvsphere", [0.35, 0.35, 0.35]), name: "Window", colour: C.b, p: [9.2, 0, 34] },
      ...[0, 120, 240].map((a) => ({ data: bake("cube", [0.15, 0.6, 1]), name: "Fin", colour: C.r, p: [Math.cos((a * Math.PI) / 180) * 16, Math.sin((a * Math.PI) / 180) * 16, 10], q: deg([0, 0, a - 90]) })),
    ],
  };
  function loadTemplate(name) {
    if (modal) endModal(false);
    snapshot();
    if (mode === "edit") { detachOverlay(); mode = "object"; }
    objects.children.slice().forEach(removeObject);
    TEMPLATES[name]().forEach((d) => { const o = addObject(d.data, d); selObjs.add(o); active = o; });
    selObjs.clear();
    active = null;
    changed();
    frame("all");
  }

  /* ═════════ Menus (header, Shift+A, right-click) ═════════ */
  const pop = $("[data-wb-pop]");
  let popOpen = null;
  function openMenu(items, x, y, title = "") {
    pop.innerHTML = (title ? `<p class="wb__poph">${title}</p>` : "") + items.map((it, i) =>
      it.sep ? "<hr />" : it.head ? `<p class="wb__poph">${it.head}</p>` :
      `<button data-i="${i}" ${it.disabled ? "disabled" : ""}>${it.icon ? `<svg><use href="#${it.icon}" /></svg>` : "<i></i>"}<span>${it.label}</span><kbd>${it.key || ""}</kbd></button>`).join("");
    pop.hidden = false;
    const vr = view.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(x, vr.width - pop.offsetWidth - 4))}px`;
    pop.style.top = `${Math.max(4, Math.min(y, vr.height - pop.offsetHeight - 4))}px`;
    popOpen = items;
  }
  function closeMenu() { pop.hidden = true; popOpen = null; }
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const it = popOpen[+b.dataset.i];
    closeMenu();
    it.run();
  });
  document.addEventListener("pointerdown", (e) => { if (popOpen && !e.target.closest(".wb__pop, [data-menu]")) closeMenu(); });

  const objMenu = () => [
    { label: "Duplicate Objects", key: "Shift D", run: duplicate },
    { label: "Join", key: "Ctrl J", run: joinObjects },
    { sep: 1 },
    { label: "Shade Smooth", run: () => setSmooth(1) },
    { label: "Shade Auto Smooth", run: () => setSmooth(2) },
    { label: "Shade Flat", run: () => setSmooth(0) },
    { sep: 1 },
    { label: "Origin to Geometry", run: originToGeometry },
    { label: "Drop to Bed", run: () => { snapshot(); selObjs.forEach((o) => dropToBed(o)); changed(); } },
    { sep: 1 },
    { label: "Hide Selected", key: "H", run: () => hide(true) },
    { label: "Reveal Hidden", key: "Alt H", run: () => hide(false) },
    { label: "Delete", key: "X", run: del },
  ];
  const meshMenu = () => [
    { label: "Extrude Region", key: "E", icon: "b-extrude", run: () => extrudeOp(false) },
    { label: "Inset Faces", key: "I", icon: "b-inset", run: () => insetOp(false) },
    { sep: 1 },
    { label: "Merge at Center", key: "M", run: () => editOp((d) => (editSel = new Set([M.merge(d, editSel)])), 2, "Select 2+ vertices to merge") },
    { label: "Fill (make face)", key: "F", run: () => editOp((d) => { if (!M.fill(d, editSel)) toast("Couldn't make a face from that"); }, 3, "Select 3+ vertices to fill") },
    { label: "Flip Normals", run: () => editOp((d) => M.flip(d, M.selectedFaces(d, editSel))) },
    { label: "Select Linked", key: "Ctrl L", run: () => { editSel = M.linked(active.userData.data, editSel); refresh(); } },
    { sep: 1 },
    { label: "Shade Smooth", run: () => setSmooth(1) },
    { label: "Shade Flat", run: () => setSmooth(0) },
    { sep: 1 },
    { label: `Delete ${{ vert: "Vertices", edge: "Edges", face: "Faces" }[selMode]}`, key: "X", run: del },
  ];
  const MENUS = {
    file: () => [
      { head: "New" },
      { label: "Default Cube", run: () => loadTemplate("cube") },
      { label: "Robot", run: () => loadTemplate("robot") },
      { label: "Phone Stand", run: () => loadTemplate("stand") },
      { label: "Pen Holder", run: () => loadTemplate("pen") },
      { label: "Keychain", run: () => loadTemplate("key") },
      { label: "Rocket", run: () => loadTemplate("rocket") },
      { sep: 1 },
      { label: "Import STL…", run: () => $("[data-wb-import]").click() },
      { label: "Export STL", run: exportSTL },
      { label: "Save Image", run: saveImage },
      { sep: 1 },
      { label: "Undo", key: "Ctrl Z", run: doUndo },
      { label: "Redo", key: "Ctrl Shift Z", run: doRedo },
    ],
    mode: () => [
      { label: "Object Mode", icon: "b-object", key: "Tab", run: () => setMode("object") },
      { label: "Edit Mode", icon: "b-edit", key: "Tab", run: () => setMode("edit") },
    ],
    view: () => [
      { label: "Frame Selected", key: "Numpad .", run: () => frame("sel") },
      { label: "Frame All", key: "Home", run: () => frame("all") },
      { sep: 1 },
      { label: "Top", key: "Numpad 7", run: () => setView("top") },
      { label: "Front", key: "Numpad 1", run: () => setView("front") },
      { label: "Right", key: "Numpad 3", run: () => setView("right") },
      { label: "Perspective / Orthographic", key: "Numpad 5", run: () => useOrtho(cam === persp) },
      { sep: 1 },
      { label: "Toggle X-Ray", key: "Alt Z", run: () => { xray = !xray; applyXray(); } },
      { label: "Cursor to World Origin", key: "Shift C", run: () => { cursor3d.set(0, 0, 0); frame("all"); } },
      { label: "Outliner & Properties", key: "N", run: togglePanels },
    ],
    select: () => [
      { label: "All", key: "A", run: () => selectAll("all") },
      { label: "None", key: "Alt A", run: () => selectAll("none") },
      { label: "Invert", key: "Ctrl I", run: () => selectAll("invert") },
      ...(mode === "edit" ? [{ sep: 1 }, { label: "Select Linked", key: "Ctrl L", run: () => { editSel = M.linked(active.userData.data, editSel); refresh(); } }] : []),
    ],
    add: () => [
      { head: "Mesh" },
      ...ADDABLE.map(([t, l]) => ({ label: l, run: () => addPrimitive(t, l) })),
      { sep: 1 },
      { label: "Import STL…", run: () => $("[data-wb-import]").click() },
    ],
    object: () => (mode === "edit" ? meshMenu() : objMenu()),
  };
  $$("[data-menu]").forEach((b) => b.addEventListener("click", () => {
    if (popOpen) return closeMenu();
    const r = b.getBoundingClientRect(), vr = view.getBoundingClientRect();
    openMenu(MENUS[b.dataset.menu](), r.left - vr.left, r.bottom - vr.top + 2);
  }));

  /* ═════════ Pointer: select, box select, cursor, Alt+drag orbit, modal ═════════ */
  let down = null, boxing = false;
  const boxEl = $("[data-wb-box]");
  const local = (e) => { const r = rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let editable = finePointer;

  // capture phase: decide what a left-drag means before OrbitControls sees it
  canvas.addEventListener("pointerdown", (e) => {
    orbit.mouseButtons.LEFT = e.altKey || e.pointerType === "touch" ? THREE.MOUSE.ROTATE : -1;
  }, true);
  canvas.addEventListener("pointerdown", (e) => {
    Object.assign(mouse, local(e));
    orbit.enableZoom = true; // working in here now: the wheel zooms the view
    closeMenu();
    if (!editable) return;
    if (modal) {
      if (modal.touch || e.pointerType === "touch") { modal.m0 = { ...mouse }; modal.touch = true; return; }
      if (e.button === 0) endModal(true);
      else if (e.button === 2) endModal(false);
      return;
    }
    if (e.button !== 0 || e.altKey) return;
    down = { ...mouse, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, onGizmo: gizmo.axis !== null && !!gizmo.object, touch: e.pointerType === "touch" };
  });
  addEventListener("pointermove", (e) => {
    if (!started) return;
    const p = local(e);
    if (modal) { Object.assign(mouse, p); modal.ctrl = e.ctrlKey; return updateModal(); }
    Object.assign(mouse, p);
    if (!down || down.onGizmo || down.touch || tool !== "select") return;
    if (!boxing && Math.hypot(p.x - down.x, p.y - down.y) > 5) { boxing = true; boxEl.hidden = false; }
    if (boxing) Object.assign(boxEl.style, { left: `${Math.min(p.x, down.x)}px`, top: `${Math.min(p.y, down.y)}px`, width: `${Math.abs(p.x - down.x)}px`, height: `${Math.abs(p.y - down.y)}px` });
  });
  addEventListener("pointerup", (e) => {
    if (!started) return;
    if (modal && modal.touch && e.pointerType === "touch") return endModal(true);
    if (!down) return;
    const d = down;
    down = null;
    const p = local(e);
    if (boxing) {
      boxing = false;
      boxEl.hidden = true;
      boxSelect(d, p, d.ctrl ? "sub" : d.shift ? "add" : "set");
      return refresh();
    }
    if (d.onGizmo || gizmo.dragging || Math.hypot(p.x - d.x, p.y - d.y) > 6) return;
    if (tool === "cursor") return placeCursor(p);
    clickSelect(p, d.shift);
    refresh();
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!editable) return;
    const p = local(e);
    if (modal) return endModal(false);
    if (e.shiftKey) return placeCursor(p);
    openMenu(mode === "edit" ? meshMenu() : objMenu(), p.x, p.y, mode === "edit" ? `${{ vert: "Vertex", edge: "Edge", face: "Face" }[selMode]} Context Menu` : "Object Context Menu");
  });
  canvas.addEventListener("wheel", () => invalidate(), { passive: true });

  /* ═════════ Keyboard (Blender shortcuts) ═════════ */
  let hover = false;
  root.addEventListener("pointerenter", () => (hover = true));
  root.addEventListener("pointerleave", () => { hover = false; if (!root.classList.contains("full")) orbit.enableZoom = false; });
  addEventListener("keydown", (e) => {
    if (!started || !editable || !(hover || root.classList.contains("full")) || e.target.matches("input, select, textarea")) return;
    const k = e.key.toLowerCase(), code = e.code, mod = e.ctrlKey || e.metaKey;

    if (modal) {
      if (k === "escape") endModal(false);
      else if (k === "enter" || code === "NumpadEnter") endModal(true);
      else if ("xyz".includes(k) && k.length === 1) { modal.axis = modal.axis === k ? null : k; modal.axisVec = null; updateModal(); }
      else if (/^[0-9.]$/.test(e.key)) { modal.typed += e.key; updateModal(); }
      else if (k === "-" || code === "Minus" || code === "NumpadSubtract") { modal.typed = modal.typed.startsWith("-") ? modal.typed.slice(1) : `-${modal.typed}`; updateModal(); }
      else if (k === "backspace") { modal.typed = modal.typed.slice(0, -1); updateModal(); }
      else return;
      return e.preventDefault();
    }
    if (popOpen && k === "escape") { closeMenu(); return e.preventDefault(); }

    const numpad = { Numpad1: "front", Numpad3: "right", Numpad7: "top" }[code];
    if (numpad) setView(e.ctrlKey ? { front: "back", right: "left", top: "bottom" }[numpad] : numpad);
    else if (code === "Numpad5") useOrtho(cam === persp);
    else if (code === "NumpadDecimal" || (k === "." && !e.shiftKey)) frame("sel");
    else if (k === "home") frame("all");
    else if (mod && k === "z") (e.shiftKey ? doRedo : doUndo)();
    else if (mod && k === "y") doRedo();
    else if (mod && k === "j") joinObjects();
    else if (mod && k === "i") selectAll("invert");
    else if (mod && k === "l" && mode === "edit") { editSel = M.linked(active.userData.data, editSel); refresh(); }
    else if (mod) return;
    else if (k === "tab") setMode(mode === "object" ? "edit" : "object");
    else if (e.altKey && k === "z") { xray = !xray; applyXray(); }
    else if (e.altKey && k === "a") selectAll("none");
    else if (e.altKey && k === "h") hide(false);
    else if (e.shiftKey && k === "a") openMenu(MENUS.add(), mouse.x, mouse.y, "Add");
    else if (e.shiftKey && k === "d") duplicate();
    else if (e.shiftKey && k === "c") { cursor3d.set(0, 0, 0); frame("all"); }
    else if (k === "a") selectAll("all");
    else if (k === "g") startModal("move");
    else if (k === "r") startModal("rotate");
    else if (k === "s") startModal("scale");
    else if (k === "x" || k === "delete") del();
    else if (k === "h") hide(true);
    else if (k === "n") togglePanels();
    else if (mode === "edit" && ["1", "2", "3"].includes(e.key) && !code.startsWith("Numpad")) setSelMode(["vert", "edge", "face"][+e.key - 1]);
    else if (mode === "object" && { 1: "front", 3: "right", 7: "top" }[e.key] && !code.startsWith("Numpad")) setView({ 1: "front", 3: "right", 7: "top" }[e.key]); // laptops without numpad
    else if (mode === "edit" && k === "e") extrudeOp(false);
    else if (mode === "edit" && k === "i") insetOp(false);
    else if (mode === "edit" && k === "m") MENUS.object()[3].run();
    else if (mode === "edit" && k === "f") MENUS.object()[4].run();
    else return;
    e.preventDefault();
  });

  function setSelMode(m) {
    selMode = m;
    if (m === "face") editSel = new Set(M.selectedFaces(active.userData.data, editSel).flatMap((fi) => active.userData.data.faces[fi]));
    refresh();
  }
  $$("[data-sel]").forEach((b) => b.addEventListener("click", () => setSelMode(b.dataset.sel)));
  $$("[data-shade]").forEach((b) => b.addEventListener("click", () => setShading(b.dataset.shade)));
  $("[data-wb-xray]").addEventListener("click", () => { xray = !xray; applyXray(); });
  $("[data-wb-space]").addEventListener("click", () => { space = space === "global" ? "local" : "global"; refresh(); });
  $("[data-wb-snap]").addEventListener("click", (e) => { snapOn = !snapOn; e.currentTarget.setAttribute("aria-pressed", snapOn); applySnap(); });
  $("[data-wb-inc]").addEventListener("change", (e) => { inc = +e.target.value; applySnap(); });
  const right = $("[data-wb-right]");
  function togglePanels() { root.classList.toggle("panels-open"); $("[data-wb-panels]").setAttribute("aria-pressed", root.classList.contains("panels-open")); requestAnimationFrame(resize); }
  $("[data-wb-panels]").addEventListener("click", togglePanels);

  /* ═════════ Navigation gizmo (axes), zoom / pan / ortho buttons ═════════ */
  const axesCanvas = $("[data-wb-axes]"), actx = axesCanvas.getContext("2d");
  const AX = [["X", new V3(1, 0, 0), "#ff3352"], ["Y", new V3(0, 1, 0), "#8bdc00"], ["Z", new V3(0, 0, 1), "#2890ff"]];
  let axHover = null, axBubbles = [];
  function drawAxes() {
    const W = axesCanvas.width, R = W * 0.36, c = W / 2;
    actx.clearRect(0, 0, W, W);
    if (axHover === "bg") { actx.fillStyle = "rgba(255,255,255,.08)"; actx.beginPath(); actx.arc(c, c, W / 2 - 2, 0, 7); actx.fill(); }
    const inv = cam.quaternion.clone().invert();
    axBubbles = [];
    for (const [l, v, col] of AX) for (const s of [1, -1]) {
      const p = v.clone().multiplyScalar(s).applyQuaternion(inv);
      axBubbles.push({ l, s, col, x: c + p.x * R, y: c - p.y * R, z: p.z });
    }
    axBubbles.sort((a, b) => a.z - b.z);
    for (const b of axBubbles) {
      const r = W * (b.s > 0 ? 0.085 : 0.07);
      if (b.s > 0) { actx.strokeStyle = b.col; actx.lineWidth = W * 0.02; actx.beginPath(); actx.moveTo(c, c); actx.lineTo(b.x, b.y); actx.stroke(); }
      actx.beginPath();
      actx.arc(b.x, b.y, r, 0, 7);
      actx.fillStyle = b.s > 0 ? b.col : `${b.col}55`;
      actx.fill();
      if (b.s < 0) { actx.strokeStyle = b.col; actx.lineWidth = W * 0.012; actx.stroke(); }
      if (axHover === `${b.l}${b.s}`) { actx.strokeStyle = "#fff"; actx.lineWidth = W * 0.015; actx.stroke(); }
      if (b.s > 0) { actx.fillStyle = "#151515"; actx.font = `bold ${W * 0.09}px system-ui, sans-serif`; actx.textAlign = "center"; actx.textBaseline = "middle"; actx.fillText(b.l, b.x, b.y + 1); }
    }
  }
  const axAt = (e) => {
    const r = axesCanvas.getBoundingClientRect(), k = axesCanvas.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const hit = [...axBubbles].reverse().find((b) => Math.hypot(b.x - x, b.y - y) < axesCanvas.width * 0.09);
    return hit ? `${hit.l}${hit.s}` : "bg";
  };
  function navDrag(el, onMove, onClick) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      let last = { x: e.clientX, y: e.clientY }, moved = 0;
      const mv = (ev) => { const dx = ev.clientX - last.x, dy = ev.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy); last = { x: ev.clientX, y: ev.clientY }; if (moved > 3) onMove(dx, dy); };
      const up = (ev) => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); if (moved <= 3) onClick?.(ev); };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
    });
  }
  function orbitBy(dx, dy) {
    const off = cam.position.clone().sub(orbit.target);
    const sph = new THREE.Spherical().setFromVector3(new V3(off.x, off.z, -off.y)); // Z-up → Y-up spherical
    sph.theta -= dx * 0.01;
    sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dy * 0.01));
    const v = new V3().setFromSpherical(sph);
    cam.position.copy(orbit.target).add(new V3(v.x, -v.z, v.y));
    cam.lookAt(orbit.target);
    if (viewAxis) { viewAxis = null; useOrtho(false); }
    orbit.update();
  }
  axesCanvas.addEventListener("pointermove", (e) => { const h = axAt(e); if (h !== axHover) { axHover = h; drawAxes(); } });
  axesCanvas.addEventListener("pointerleave", () => { axHover = null; drawAxes(); });
  navDrag(axesCanvas, orbitBy, (e) => {
    const h = axAt(e);
    if (h === "bg") return;
    setView({ X1: "right", "X-1": "left", Y1: "back", "Y-1": "front", Z1: "top", "Z-1": "bottom" }[h]);
  });
  navDrag($('[data-nav="zoom"]'), (dx, dy) => {
    if (cam === ortho) ortho.zoom = Math.max(0.05, ortho.zoom * Math.exp(-dy * 0.01));
    else cam.position.copy(orbit.target).add(cam.position.clone().sub(orbit.target).multiplyScalar(Math.exp(dy * 0.01)));
    cam.updateProjectionMatrix();
    orbit.update();
  });
  navDrag($('[data-nav="pan"]'), (dx, dy) => {
    const r = rect();
    const h = cam === ortho ? (ortho.top - ortho.bottom) / ortho.zoom : 2 * cam.position.distanceTo(orbit.target) * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
    const k = h / r.height;
    const move = new V3(-dx * k, dy * k, 0).applyQuaternion(cam.quaternion);
    cam.position.add(move);
    orbit.target.add(move);
    orbit.update();
  });
  $('[data-nav="ortho"]').addEventListener("click", () => { viewAxis = null; useOrtho(cam === persp); });

  /* ═════════ Panels: toolbar, outliner, properties, info, status ═════════ */
  const TOOLS = {
    object: [["select", "b-select", "Select Box", "B"], ["cursor", "b-cursor", "Cursor", "Shift RMB"], null, ["move", "i-move", "Move", "G"], ["rotate", "i-rotate", "Rotate", "R"], ["scale", "i-scale", "Scale", "S"], null, ["addcube", "b-addcube", "Add Cube", "Shift A"]],
    edit: [["select", "b-select", "Select Box", "B"], ["cursor", "b-cursor", "Cursor", "Shift RMB"], null, ["move", "i-move", "Move", "G"], ["rotate", "i-rotate", "Rotate", "R"], ["scale", "i-scale", "Scale", "S"], null, ["extrude", "b-extrude", "Extrude Region", "E"], ["inset", "b-inset", "Inset Faces", "I"]],
  };
  const tb = $("[data-wb-tools]");
  function renderTools() {
    tb.innerHTML = TOOLS[mode].map((t) => (t ? `<button data-tool="${t[0]}" aria-pressed="${tool === t[0]}" data-tip="${t[2]}" data-key="${t[3]}"><svg><use href="#${t[1]}" /></svg></button>` : "<hr />")).join("");
  }
  tb.addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });

  const tip = $("[data-wb-tip]");
  root.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip], [title]");
    if (!t || !finePointer || !root.contains(t) || !t.dataset.tip) return (tip.hidden = true);
    tip.innerHTML = `${t.dataset.tip}${t.dataset.key ? ` <kbd>${t.dataset.key}</kbd>` : ""}`;
    const r = t.getBoundingClientRect(), vr = view.getBoundingClientRect();
    tip.style.left = `${r.right - vr.left + 8}px`;
    tip.style.top = `${r.top - vr.top + r.height / 2}px`;
    tip.hidden = false;
  });
  root.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });

  // Outliner: Scene Collection → Collection → objects
  const tree = $("[data-wb-tree]");
  let search = "";
  $("[data-wb-search]").addEventListener("input", (e) => { search = e.target.value.toLowerCase(); renderOutliner(); });
  function renderOutliner() {
    const list = objects.children.filter((o) => o.userData.name.toLowerCase().includes(search));
    const anyVisible = objects.children.some((o) => !o.userData.hidden);
    const allPrint = objects.children.every((o) => o.userData.printable);
    tree.innerHTML =
      `<li class="wb__row wb__row--scene"><svg><use href="#b-collection" /></svg><span>Scene Collection</span></li>
       <li class="wb__row wb__row--coll"><svg class="wb__chev"><use href="#b-chev" /></svg><svg><use href="#b-collection" /></svg><span>Collection</span>
         <button data-coll="check" title="Exclude"><svg><use href="#${anyVisible ? "b-check" : "b-uncheck"}" /></svg></button>
         <button data-coll="eye" title="Hide in viewport"><svg><use href="#i-eye${anyVisible ? "" : "-off"}" /></svg></button>
         <button data-coll="cam" title="Include in print"><svg class="${allPrint ? "" : "off"}"><use href="#b-camera" /></svg></button></li>` +
      list.map((o) => `<li class="wb__row wb__row--obj${selObjs.has(o) ? " sel" : ""}${o === active ? " act" : ""}${o.userData.hidden ? " hid" : ""}" data-id="${o.id}">
         <svg><use href="#b-mesh" /></svg><span class="wb__name" title="Double-click to rename">${esc(o.userData.name)}</span><svg class="wb__data"><use href="#b-meshdata" /></svg>
         <button data-eye title="Hide in viewport (H)"><svg><use href="#i-eye${o.userData.hidden ? "-off" : ""}" /></svg></button>
         <button data-cam title="Include in print & export"><svg class="${o.userData.printable ? "" : "off"}"><use href="#b-camera" /></svg></button></li>`).join("") +
      (list.length ? "" : `<li class="wb__row wb__row--empty">${objects.children.length ? "No match" : "Empty — Add a mesh (Shift A)"}</li>`);
  }
  tree.addEventListener("click", (e) => {
    const coll = e.target.closest("[data-coll]");
    if (coll) {
      snapshot();
      const all = objects.children;
      if (coll.dataset.coll === "cam") { const v = !all.every((o) => o.userData.printable); all.forEach((o) => (o.userData.printable = v)); }
      else { const hideAll = all.some((o) => !o.userData.hidden); all.forEach((o) => { o.userData.hidden = hideAll; o.visible = !hideAll; }); if (hideAll) { selObjs.clear(); active = null; } }
      return changed();
    }
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const o = objects.getObjectById(+row.dataset.id);
    if (e.target.closest("[data-eye]")) {
      snapshot();
      o.userData.hidden = !o.userData.hidden;
      o.visible = !o.userData.hidden;
      if (o.userData.hidden) { selObjs.delete(o); if (active === o) active = null; }
      return changed();
    }
    if (e.target.closest("[data-cam]")) { snapshot(); o.userData.printable = !o.userData.printable; return changed(); }
    if (o.userData.hidden) return;
    if (mode === "edit" && o !== active) setMode("object");
    if (e.ctrlKey || e.shiftKey || e.metaKey) { selObjs.has(o) && active === o ? selObjs.delete(o) : selObjs.add(o); active = selObjs.has(o) ? o : [...selObjs][0] || null; }
    else { selObjs.clear(); selObjs.add(o); active = o; }
    refresh();
  });
  tree.addEventListener("dblclick", (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const o = objects.getObjectById(+row.dataset.id), span = row.querySelector(".wb__name");
    const input = document.createElement("input");
    input.className = "wb__rename";
    input.value = o.userData.name;
    span.replaceWith(input);
    input.focus();
    input.select();
    const done = (ok) => {
      if (ok && input.value.trim() && input.value.trim() !== o.userData.name) { snapshot(); o.userData.name = uniqueName(input.value.trim().slice(0, 40)); }
      changed(ok);
    };
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); if (ev.key === "Escape") { input.value = o.userData.name; input.blur(); } ev.stopPropagation(); });
    input.addEventListener("blur", () => done(true), { once: true });
  });

  // Properties editor: Object · Material · Print
  const pbody = $("[data-wb-pbody]");
  $$("[data-ptab]").forEach((b) => b.addEventListener("click", () => { ptab = b.dataset.ptab; renderProps(true); }));
  let propsKey = "";
  const field = (k, v, step = 1) => `<label><b class="ax-${k.slice(-1)}">${k.slice(-1).toUpperCase()}</b><input type="number" step="${step}" data-f="${k}" value="${Math.round(v * 100) / 100}" /></label>`;
  const row3 = (label, key, vec, step) => `<div class="wb__prow"><span>${label}</span><div class="wb__xyz">${["x", "y", "z"].map((a) => field(key + a, vec[a], step)).join("")}</div></div>`;
  function renderProps(force = false) {
    $$("[data-ptab]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.ptab === ptab));
    const key = `${ptab}|${mode}|${active?.id}|${selObjs.size}|${editSel.size > 0}`;
    if (!force && key === propsKey && ptab !== "print") return updatePropValues();
    propsKey = key;
    let html = "";
    if (ptab === "object") {
      if (!active) html = `<p class="wb__muted">No active object. Click one in the viewport or the outliner.</p>`;
      else if (mode === "edit") {
        html = `<div class="wb__ptitle"><svg><use href="#b-meshdata" /></svg>${esc(active.userData.name)} <small>Edit Mode</small></div>
          ${editSel.size ? row3("Median", "m", new V3(), 1) : ""}<p class="wb__muted" data-edit-count></p>
          <p class="wb__muted">Tab: back to Object Mode · 1 2 3: vertex / edge / face</p>`;
      } else {
        const e = new THREE.Euler().setFromQuaternion(active.quaternion);
        html = `<div class="wb__ptitle"><svg><use href="#b-object" /></svg><input class="wb__pname" data-pname value="${esc(active.userData.name)}" /></div>
          <h5>Transform</h5>
          ${row3("Location", "p", active.position, 1)}
          ${row3("Rotation °", "r", { x: THREE.MathUtils.radToDeg(e.x), y: THREE.MathUtils.radToDeg(e.y), z: THREE.MathUtils.radToDeg(e.z) }, 5)}
          ${row3("Scale", "s", active.scale, 0.1)}
          ${row3("Dimensions", "d", worldBox(active).getSize(new V3()), 1)}
          <h5>Visibility</h5>
          <label class="wb__check"><input type="checkbox" data-printable ${active.userData.printable ? "checked" : ""} /> Include in print &amp; export</label>`;
      }
    } else if (ptab === "material") {
      if (!active) html = `<p class="wb__muted">Select an object to set its colour.</p>`;
      else html = `<div class="wb__ptitle"><svg><use href="#b-material" /></svg>${esc(active.userData.name)}</div>
        <h5>Base Color</h5>
        <div class="wb__swatches">${PALETTE.map((c) => `<button data-colour="${c}" style="--c:#${c.toString(16).padStart(6, "0")}" aria-pressed="${active.userData.colour === c}"></button>`).join("")}
          <label class="wb__pick" title="Any colour"><input type="color" data-colourpick value="#${active.userData.colour.toString(16).padStart(6, "0")}" /></label></div>
        <p class="wb__muted">Colours show in Material Preview and Rendered shading.</p>
        <h5>Shading</h5>
        <div class="wb__seg">${[["Flat", 0], ["Smooth", 1], ["Auto Smooth", 2]].map(([l, v]) => `<button data-smooth="${v}" aria-pressed="${active.userData.data.smooth === v}">${l}</button>`).join("")}</div>`;
    } else {
      const r = analyse();
      buildOverhangs(r);
      const fits = Math.max(r.size.x, r.size.y, r.size.z) <= BED;
      const items = r.empty ? [["warn", S("wb.empty")]] : [
        [fits ? "ok" : "bad", fits ? S("wb.c.fits") : S("wb.c.big"), `${r.size.x.toFixed(0)} × ${r.size.y.toFixed(0)} × ${r.size.z.toFixed(0)} mm`],
        [r.minZ < 0.6 ? "ok" : "warn", r.minZ < 0.6 ? S("wb.c.bed") : S("wb.c.air")],
        [r.floating ? "warn" : "ok", r.floating ? S("wb.c.float", { n: r.floating }) : S("wb.c.solid")],
        [r.overPct > 8 ? "warn" : "ok", r.overPct > 1 ? S("wb.c.over", { p: r.overPct.toFixed(0) }) : S("wb.c.overOk"), r.overPct > 8 ? S("wb.c.supports") : ""],
      ];
      const grams = (r.volume / 1000) * 1.24 * 0.6;
      html = `<div class="wb__ptitle"><svg><use href="#i-print" /></svg>${S("wb.check")}</div>
        <ul class="wb__checklist">${items.map(([k, t, sub]) => `<li class="${k}"><i>${k === "ok" ? "✓" : k === "bad" ? "✕" : "!"}</i><span>${t}${sub ? `<small>${sub}</small>` : ""}</span></li>`).join("")}</ul>
        ${r.empty ? "" : `<p class="wb__est" title="${S("bed.est")}">≈${Math.max(1, Math.round(grams))} g PLA · ≈${Math.max(1, Math.round(grams * 3.4))} min</p>`}
        <label class="wb__check"><input type="checkbox" data-over ${showOver ? "checked" : ""} /> ${S("wb.overhangs")} <small>(Rendered)</small></label>
        <label class="wb__check"><input type="checkbox" data-turn ${turntable ? "checked" : ""} /> ${S("wb.turn")}</label>
        <div class="wb__pactions">
          <button class="wb__btn" data-act="render">See it Rendered</button>
          <button class="wb__btn wb__btn--go" data-act="print"><svg><use href="#i-print" /></svg>${S("wb.send")}</button>
          <button class="wb__btn" data-act="export">Export STL</button>
          <button class="wb__btn" data-act="image">Save Image</button>
        </div>`;
    }
    pbody.innerHTML = html;
    updatePropValues();
  }
  function updatePropValues() {
    if (!active) return;
    const set = (k, v) => { const i = pbody.querySelector(`[data-f="${k}"]`); if (i && document.activeElement !== i) i.value = Math.round(v * 100) / 100; };
    if (mode === "edit") {
      const c = selectionPivot();
      if (c) ["x", "y", "z"].forEach((a) => set(`m${a}`, c[a]));
      const n = pbody.querySelector("[data-edit-count]");
      if (n) n.textContent = `${editSel.size} / ${active.userData.data.verts.length} vertices selected`;
      return;
    }
    const e = new THREE.Euler().setFromQuaternion(active.quaternion), dim = worldBox(active).getSize(new V3());
    ["x", "y", "z"].forEach((a) => {
      set(`p${a}`, active.position[a]); set(`r${a}`, THREE.MathUtils.radToDeg(e[a])); set(`s${a}`, active.scale[a]); set(`d${a}`, dim[a]);
    });
  }
  pbody.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.f && active) {
      const v = parseFloat(t.value);
      if (!Number.isFinite(v)) return renderProps(true);
      snapshot();
      const [k, a] = t.dataset.f;
      if (k === "p") active.position[a] = v;
      if (k === "r") { const eu = new THREE.Euler().setFromQuaternion(active.quaternion); eu[a] = THREE.MathUtils.degToRad(v); active.quaternion.setFromEuler(eu); }
      if (k === "s") active.scale[a] = v || 0.001;
      if (k === "d" && v > 0) { const cur = worldBox(active).getSize(new V3())[a]; if (cur > 1e-6) active.scale[a] *= v / cur; }
      if (k === "m") {
        const c = selectionPivot(), delta = new V3();
        delta[a] = v - c[a];
        applySession(beginSession(), new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z));
      }
      return afterTransform();
    }
    if (t.matches("[data-pname]") && active) { const n = t.value.trim(); if (n && n !== active.userData.name) { snapshot(); active.userData.name = uniqueName(n.slice(0, 40)); changed(); } return; }
    if (t.matches("[data-printable]") && active) { snapshot(); active.userData.printable = t.checked; return changed(); }
    if (t.matches("[data-colourpick]") && active) { snapshot(); setColour(active, parseInt(t.value.slice(1), 16)); return changed(); }
    if (t.matches("[data-over]")) { showOver = t.checked; buildOverhangs(); return invalidate(); }
    if (t.matches("[data-turn]")) { turntable = t.checked; orbit.autoRotate = shading === "rendered" && turntable; return invalidate(); }
  });
  pbody.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.colour && active) { snapshot(); setColour(active, +t.dataset.colour); return changed(); }
    if (t.dataset.smooth) return setSmooth(+t.dataset.smooth);
    const act = { render: () => setShading("rendered"), print: sendToPrinter, export: exportSTL, image: saveImage }[t.dataset.act];
    act?.();
  });

  const modeName = $("[data-wb-modename]"), modeIcon = $(".wb__mode use");
  function refreshInfo() {
    const proj = cam === ortho ? "Orthographic" : "Perspective";
    $("[data-wb-viewname]").textContent = `${viewAxis || "User"} ${proj}`;
    $("[data-wb-active]").textContent = `(1) Collection${active ? ` | ${active.userData.name}` : ""}`;
  }
  function refreshStats() {
    const vis = visibleObjs();
    let txt;
    if (mode === "edit" && active) {
      const d = active.userData.data, E = active.userData.edges;
      txt = `${active.userData.name} | Verts ${editSel.size}/${d.verts.length} | Edges ${E.filter(([a, b]) => editSel.has(a) && editSel.has(b)).length}/${E.length} | Faces ${M.selectedFaces(d, editSel).length}/${d.faces.length}`;
    } else {
      const verts = vis.reduce((n, o) => n + o.userData.data.verts.length, 0), faces = vis.reduce((n, o) => n + o.userData.data.faces.length, 0);
      const tris = vis.reduce((n, o) => n + o.userData.triFace.length, 0);
      txt = `Objects ${selObjs.size}/${objects.children.length} | Verts ${verts.toLocaleString("en")} | Faces ${faces.toLocaleString("en")} | Tris ${tris.toLocaleString("en")}`;
    }
    $("[data-wb-stats]").textContent = txt;
    if (ptab === "object") updatePropValues();
  }
  function refreshHints() {
    const h = modal
      ? "X Y Z: axis · type a value · Ctrl: snap · Click / Enter: confirm · Right-click / Esc: cancel"
      : !finePointer
        ? "Drag: orbit · Tap: select · Tools on the left · Menus on top"
        : mode === "edit"
          ? "Click: select · Drag: box · 1 2 3: vert/edge/face · E extrude · I inset · M merge · F fill · X delete · Tab: object"
          : "Click: select · Drag: box · Middle-drag / Alt-drag: orbit · Wheel: zoom · Shift A: add · G R S · Tab: edit";
    $("[data-wb-hints]").textContent = h;
  }

  // one place that brings every panel up to date
  function refresh() {
    if (active && (active.userData.hidden || !objects.children.includes(active))) active = null;
    objects.children.forEach(applyMaterial);
    root.classList.toggle("editing", mode === "edit");
    modeName.textContent = mode === "edit" ? "Edit Mode" : "Object Mode";
    modeIcon.setAttribute("href", mode === "edit" ? "#b-edit" : "#b-object");
    $("[data-wb-selmode]").hidden = mode !== "edit";
    $$("[data-sel]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sel === selMode));
    $("[data-wb-objmenu]").textContent = mode === "edit" ? "Mesh" : "Object";
    $(".wb__space span").textContent = space === "local" ? "Local" : "Global";
    if (mode === "edit") rebuildOverlay();
    renderTools();
    renderOutliner();
    renderProps();
    refreshInfo();
    refreshStats();
    refreshHints();
    refreshGizmo();
    if (shading === "rendered") buildOverhangs();
    invalidate();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("[data-wb-toast]");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ═════════ Fullscreen (and the only way to edit on phones, so the page still scrolls) ═════════ */
  const tap = $("[data-wb-tap]");
  function setFull(on) {
    if (modal) endModal(true);
    root.classList.toggle("full", on);
    document.body.classList.toggle("locked", on);
    orbit.enableZoom = on;
    editable = on || finePointer;
    orbit.enabled = editable;
    gizmo.enabled = editable;
    tap.hidden = editable;
    canvas.style.touchAction = editable ? "none" : "pan-y";
    requestAnimationFrame(resize);
  }
  $("[data-wb-full]").addEventListener("click", () => setFull(!root.classList.contains("full")));
  tap.addEventListener("click", () => setFull(true));

  /* ═════════ Rendering: only when something changed ═════════ */
  const cursorEl = $("[data-wb-cursor]");
  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    const hh = ortho.userData.h || 50;
    Object.assign(ortho, { left: -hh * (w / h), right: hh * (w / h), top: hh, bottom: -hh });
    persp.updateProjectionMatrix();
    ortho.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio, 2), size = axesCanvas.clientWidth || 80;
    axesCanvas.width = axesCanvas.height = Math.round(size * dpr);
    invalidate();
  }
  new ResizeObserver(resize).observe(view);
  applyQuality = () => {
    renderer.setPixelRatio(PERF.lite ? 1 : Math.min(devicePixelRatio, 2));
    sun.castShadow = shading === "rendered" && !PERF.lite;
    resize();
  };
  applyQuality();

  let last = 0, visible = false;
  function tick(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 260);
      const k = 1 - Math.pow(1 - fly.t, 3);
      cam.position.lerpVectors(fly.p0, fly.p1, k);
      orbit.target.lerpVectors(fly.t0, fly.t1, k);
      cam.lookAt(orbit.target);
      if (fly.t >= 1) { const done = fly.done; fly = null; orbit.update(); done?.(); }
      needsRender = true;
    }
    if (orbit.autoRotate) { orbit.update(); needsRender = true; }
    if (!needsRender) return;
    needsRender = false;
    if (cam === ortho) {
      const hh = ortho.userData.h || 50, { clientWidth: w, clientHeight: h } = view;
      Object.assign(ortho, { left: -hh * (w / h), right: hh * (w / h), top: hh, bottom: -hh });
      ortho.updateProjectionMatrix();
    }
    renderer.render(scene, cam);
    drawAxes();
    const c = project(cursor3d);
    cursorEl.style.transform = `translate(${c.x}px, ${c.y}px)`;
    cursorEl.hidden = c.behind;
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    last = 0;
    renderer.setAnimationLoop(visible || root.classList.contains("full") ? tick : null);
    invalidate();
  }).observe(view);

  document.addEventListener("langchange", () => renderProps(true));

  /* ═════════ Start: last session on this device, or Blender's default cube ═════════ */
  setFull(false);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  if (saved?.objs?.length) { restore(saved); undo.length = 0; }
  else TEMPLATES.cube().forEach((d) => addObject(d.data, d));
  if (!active && objects.children.length) { active = objects.children[0]; selObjs.add(active); }
  setShading("solid");
  refresh();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
