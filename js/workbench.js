// Workbench: a tiny Blender with one job — make something printable.
// Model it (templates, 9 shapes, gizmo, typed transforms, outliner), check it in Preview
// (studio render + print check: size, bed contact, floating parts, overhangs, filament), then print it
// on the bed above (printbed.js). Scenes autosave on the visitor's device.

const root = document.querySelector("[data-workbench]");
const $ = (s) => root.querySelector(s);
const $$ = (s) => [...root.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const PERF = window.PERF || { lite: false };
const S = (k, v) => I18N.s(k, v);

const BED = 256; // Bambu Lab A1 build volume, mm
const SAVE_KEY = "wb-scene-v2";
const COLOURS = [0xff6a13, 0xeeece6, 0x2a2a2e, 0x00ae42, 0xd7263d, 0xf5c400, 0x7cc4ff];
const C = { o: 0xff6a13, w: 0xeeece6, k: 0x2a2a2e, g: 0x00ae42, r: 0xd7263d, y: 0xf5c400, b: 0x7cc4ff };

// Templates: [shape, colour, position mm, rotation °, scale]
const fin = (deg) => ["wedge", C.r, [Math.cos((deg * Math.PI) / 180) * 17.5, Math.sin((deg * Math.PI) / 180) * 17.5, 10], [0, 0, deg - 90], [0.15, 0.75, 1]];
const TEMPLATES = {
  robot: [
    ["cylinder", C.w, [0, 0, 3], [0, 0, 0], [1.4, 1.4, 0.3]],
    ["cube", C.o, [0, 0, 17], [0, 0, 0], [1, 0.8, 1.1]],
    ["sphere", C.w, [0, 0, 36], [0, 0, 0], [0.9, 0.9, 0.9]],
    ["capsule", C.k, [0, 0, 48], [0, 0, 0], [0.25, 0.25, 0.45]],
    ["torus", C.g, [0, 0, 55], [0, 0, 0], [0.45, 0.45, 0.6]],
  ],
  stand: [
    ["cube", C.k, [0, 0, 2.5], [0, 0, 0], [3.5, 3, 0.25]],
    ["cube", C.o, [0, 12, 30], [-20, 0, 0], [3.5, 0.3, 3]],
    ["cube", C.o, [0, -24, 11], [0, 0, 0], [3.5, 0.5, 0.6]],
  ],
  pen: [
    ["cylinder", C.k, [10, 5, 2], [0, 0, 0], [4.4, 3.4, 0.2]],
    ["tube", C.w, [0, 0, 44], [0, 0, 0], [2, 2, 4]],
    ["tube", C.o, [28, 14, 30], [0, 0, 0], [1.4, 1.4, 2.6]],
  ],
  key: [
    ["cylinder", C.g, [0, 0, 2], [0, 0, 0], [2.2, 1.3, 0.2]],
    ["torus", C.k, [-24, 0, 2.1], [0, 0, 0], [0.6, 0.6, 0.6]],
    ["cube", C.w, [4, 0, 5.5], [0, 0, 0], [0.3, 1, 0.15]],
    ["cube", C.w, [11, -7, 5.5], [0, 0, 0], [1, 0.3, 0.15]],
  ],
  rocket: [
    ["cylinder", C.w, [0, 0, 25], [0, 0, 0], [1, 1, 2.5]],
    ["cone", C.r, [0, 0, 60], [0, 0, 0], [1, 1, 1]],
    ["sphere", C.b, [9.2, 0, 34], [0, 0, 0], [0.35, 0.35, 0.35]],
    fin(0), fin(120), fin(240),
  ],
  empty: [],
};

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
    if (PERF.lite) open.hidden = false;
    else boot();
  }, { rootMargin: "500px 0px" });
  io.observe(root);
  document.addEventListener("perfchange", () => {
    if (!started && near && !PERF.lite) boot();
    applyQuality();
  });
}

// Slides the pill of a segmented control under its pressed button
function movePill(seg) {
  const on = seg?.querySelector("[aria-pressed=true]");
  if (!on) return;
  seg.style.setProperty("--x", `${on.offsetLeft}px`);
  seg.style.setProperty("--w", `${on.offsetWidth}px`);
}

async function start() {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { TransformControls } = await import("three/addons/controls/TransformControls.js");
  const { STLExporter } = await import("three/addons/exporters/STLExporter.js");
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");

  const view = $(".wb__view");
  const canvas = $(".wb__canvas");
  root.classList.add("ready");
  root.classList.toggle("touch", !finePointer);

  /* ── Scene (Z up, millimetres, like the printer) ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 16 / 10, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(110, -150, 110);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(80, -100, 160);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 600 });
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 5;
  scene.add(sun);

  // Edit mode: floor grid with Blender-style coloured axes, and the A1 build volume
  const editAids = new THREE.Group();
  const grid = new THREE.GridHelper(BED, 32, 0x555b66, 0x30343c);
  grid.rotation.x = Math.PI / 2;
  const axes = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-BED / 2, 0, 0.05), new THREE.Vector3(BED / 2, 0, 0.05), new THREE.Vector3(0, -BED / 2, 0.05), new THREE.Vector3(0, BED / 2, 0.05)]),
    new THREE.LineBasicMaterial({ vertexColors: true })
  );
  axes.geometry.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.3, 0.35, 1, 0.3, 0.35, 0.5, 0.85, 0.2, 0.5, 0.85, 0.2], 3));
  const volume = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(BED, BED, BED).translate(0, 0, BED / 2)),
    new THREE.LineBasicMaterial({ color: 0x3a3f4a, transparent: true, opacity: 0.6 })
  );
  editAids.add(grid, axes, volume);
  // Preview mode: a soft shadow-catching floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.receiveShadow = true;
  floor.visible = false;
  scene.add(editAids, floor);

  let mode = "model";
  const toggles = { bed: true, over: true, turn: !reduced };
  const objects = new THREE.Group();
  const overlay = new THREE.Group(); // red overhang faces in preview
  scene.add(objects, overlay);

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0, 20);
  orbit.enableDamping = true;
  orbit.enableZoom = false; // turned on once the visitor clicks into the viewport
  orbit.maxPolarAngle = Math.PI / 2 - 0.01;
  orbit.autoRotateSpeed = 1.4;
  orbit.update();

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(finePointer ? 0.85 : 1.25);
  scene.add(gizmo);
  gizmo.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
    if (!e.value) changed();
  });
  gizmo.addEventListener("mouseDown", snapshot);
  gizmo.addEventListener("objectChange", () => {
    if (toggles.bed && selected) keepOnBed(selected);
    queueUI();
  });

  /* ── Shapes: all 20 mm, centred on their own box ── */
  const SHAPES = {
    cube: () => new THREE.BoxGeometry(20, 20, 20),
    sphere: () => new THREE.SphereGeometry(10, 48, 32),
    cylinder: () => new THREE.CylinderGeometry(10, 10, 20, 64).rotateX(Math.PI / 2),
    cone: () => new THREE.ConeGeometry(10, 20, 64).rotateX(Math.PI / 2),
    torus: () => new THREE.TorusGeometry(10, 3.5, 24, 64),
    capsule: () => new THREE.CapsuleGeometry(7, 10, 8, 32).rotateX(Math.PI / 2),
    tube: () => {
      const ring = new THREE.Shape().absarc(0, 0, 10, 0, Math.PI * 2);
      ring.holes.push(new THREE.Path().absarc(0, 0, 6, 0, Math.PI * 2, true));
      return new THREE.ExtrudeGeometry(ring, { depth: 20, bevelEnabled: false, curveSegments: 64 }).center();
    },
    wedge: () => {
      const tri = new THREE.Shape().moveTo(0, 0).lineTo(20, 0).lineTo(0, 20).closePath();
      // triangle stands in the Y–Z plane (ramp), extruded along X
      return new THREE.ExtrudeGeometry(tri, { depth: 20, bevelEnabled: false })
        .applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)).center();
    },
    dome: () => {
      const cap = new THREE.CircleGeometry(10, 64).rotateX(Math.PI);
      const top = new THREE.SphereGeometry(10, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
      return mergeGeometries([top, cap]).center();
    },
  };
  const geoCache = {};
  const prep = (g) => { g.computeBoundingBox(); g.computeVertexNormals(); return g; };
  const geometryFor = (type) => (geoCache[type] ||= prep(SHAPES[type]()));
  const edgeCache = new WeakMap();
  const edgesFor = (g) => { if (!edgeCache.has(g)) edgeCache.set(g, new THREE.EdgesGeometry(g, 25)); return edgeCache.get(g); };

  // Materials: plain for editing, "printed PLA" (layer lines) for preview
  function printMaterial(colour) {
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = "varying float vWz;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\nvWz = (modelMatrix * vec4(transformed, 1.0)).z;");
      sh.fragmentShader = "varying float vWz;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float lz = vWz / 0.2; float aa = fwidth(lz);
        diffuseColor.rgb *= 1.0 - 0.16 * (1.0 - sin(fract(lz) * 3.14159)) * (1.0 - smoothstep(0.35, 0.9, aa));`);
    };
    return m;
  }

  const counters = {};
  function make(type, colour = COLOURS[0], geometry = null, name = "") {
    const g = geometry || geometryFor(type);
    const edit = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45 });
    const print = printMaterial(colour);
    const mesh = new THREE.Mesh(g, mode === "preview" ? print : edit);
    counters[type] = (counters[type] || 0) + 1;
    mesh.userData = { type, colour, n: counters[type], name, edit, print };
    mesh.castShadow = mesh.receiveShadow = true;
    objects.add(mesh);
    return mesh;
  }
  const label = (o) => o.userData.name || `${S(`wb.${o.userData.type}`)}${o.userData.n > 1 ? ` ${o.userData.n}` : ""}`;

  /* ── Undo / redo / autosave: whole-scene snapshots (scenes here are small) ── */
  const undo = [], redo = [];
  const state = () => objects.children.map((o) => ({
    type: o.userData.type, colour: o.userData.colour, name: o.userData.name, hidden: !o.visible,
    geometry: o.userData.type === "mesh" ? o.geometry : undefined,
    p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(),
  }));
  function restore(list) {
    select(null);
    objects.children.slice().forEach((o) => { o.userData.edit.dispose(); o.userData.print.dispose(); objects.remove(o); });
    for (const k in counters) delete counters[k];
    list.forEach((d) => {
      if (d.type === "mesh" && !d.geometry) return;
      const o = make(d.type, d.colour, d.geometry, d.name);
      o.position.fromArray(d.p);
      o.quaternion.fromArray(d.q);
      o.scale.fromArray(d.s);
      o.visible = !d.hidden;
    });
    changed();
  }
  function snapshot() {
    undo.push(state());
    if (undo.length > 80) undo.shift();
    redo.length = 0;
  }
  const doUndo = () => { if (undo.length) { redo.push(state()); restore(undo.pop()); } };
  const doRedo = () => { if (redo.length) { undo.push(state()); restore(redo.pop()); } };

  let saveTimer;
  function changed() {
    queueUI();
    if (mode === "preview") buildCheck();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // imported meshes are too big to keep; everything else survives a reload
      const data = state().filter((d) => d.type !== "mesh").map(({ geometry, ...d }) => d);
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
    }, 400);
  }

  function loadTemplate(name) {
    restore(TEMPLATES[name].map(([type, colour, p, r, s]) => ({
      type, colour, p, s, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map((d) => (d * Math.PI) / 180))).toArray(),
    })));
    frame();
  }

  /* ── Selection, with a Blender-like orange outline ── */
  let selected = null;
  const outline = new THREE.LineSegments(undefined, new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.95, depthTest: false }));
  outline.renderOrder = 10;
  function select(o) {
    selected?.remove(outline);
    selected = o && o.visible ? o : null;
    if (selected && mode === "model") {
      outline.geometry = edgesFor(selected.geometry);
      selected.add(outline);
      gizmo.attach(selected);
    } else gizmo.detach();
    queueUI();
  }

  // click/tap selects; a drag (orbit) doesn't
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  canvas.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
    orbit.enableZoom = true; // the visitor is working in here now
    closeMenus();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!gizmo.enabled || mode !== "model") return; // phones: only after "Tap to edit"
    if (!downAt || gizmo.dragging || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(objects.children.filter((o) => o.visible), false)[0];
    select(hit ? hit.object : null);
  });
  root.addEventListener("pointerleave", () => { if (!root.classList.contains("full")) orbit.enableZoom = false; });

  /* ── Geometry helpers ── */
  const box = new THREE.Box3(), v3 = new THREE.Vector3();
  function keepOnBed(o) {
    box.setFromObject(o, true);
    if (box.min.z < 0) o.position.z -= box.min.z;
  }
  function dropToBed(o) {
    box.setFromObject(o, true);
    o.position.z -= box.min.z;
  }
  function bounds(list) {
    const b = new THREE.Box3();
    list.forEach((o) => b.union(box.setFromObject(o, true)));
    return b;
  }
  const visible = () => objects.children.filter((o) => o.visible);

  /* ── Camera: views and framing, with a short fly-to ── */
  let fly = null;
  function flyTo(pos, target) {
    if (reduced) { camera.position.copy(pos); orbit.target.copy(target); orbit.update(); return; }
    fly = { p0: camera.position.clone(), p1: pos, t0: orbit.target.clone(), t1: target, t: 0 };
  }
  function frame(list = selected ? [selected] : visible()) {
    const b = list.length ? bounds(list) : new THREE.Box3(new THREE.Vector3(-30, -30, 0), new THREE.Vector3(30, 30, 40));
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.max(15, b.getSize(v3).length() / 2);
    const dist = (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    const dir = camera.position.clone().sub(orbit.target).normalize();
    flyTo(c.clone().add(dir.multiplyScalar(dist)), c);
  }
  function setView(name) {
    const list = visible();
    const b = list.length ? bounds(list) : new THREE.Box3(new THREE.Vector3(-30, -30, 0), new THREE.Vector3(30, 30, 40));
    const c = b.getCenter(new THREE.Vector3());
    const d = (Math.max(30, b.getSize(v3).length()) / 2 / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    const dirs = { persp: [0.55, -0.7, 0.45], top: [0, -0.001, 1], front: [0, -1, 0.001], right: [1, 0, 0.001] };
    flyTo(c.clone().add(new THREE.Vector3(...dirs[name]).normalize().multiplyScalar(d)), c);
  }

  /* ── Actions ── */
  function add(type) {
    if (mode !== "model") setWorkspace("model");
    snapshot();
    const o = make(type, COLOURS[(objects.children.length + 1) % COLOURS.length]);
    // drop new shapes next to what's there, on the bed
    const b = visible().length > 1 ? bounds(visible().filter((x) => x !== o)) : null;
    o.position.set(b ? b.min.x - 15 : 0, b ? (b.min.y + b.max.y) / 2 : 0, 0);
    dropToBed(o);
    select(o);
    setMode("translate");
    changed();
    showShapes(false);
  }
  const actions = {
    dup() {
      if (!selected) return;
      snapshot();
      const s = selected;
      const o = make(s.userData.type, s.userData.colour, s.userData.type === "mesh" ? s.geometry : null, s.userData.name);
      o.position.copy(s.position).add(new THREE.Vector3(12, 12, 0));
      o.quaternion.copy(s.quaternion);
      o.scale.copy(s.scale);
      select(o);
      changed();
    },
    del() {
      if (!selected) return;
      snapshot();
      const o = selected;
      select(null);
      o.userData.edit.dispose();
      o.userData.print.dispose();
      objects.remove(o);
      changed();
    },
    drop() { if (selected) { snapshot(); dropToBed(selected); changed(); } },
    frame: () => frame(),
    undo: doUndo,
    redo: doRedo,
    export() {
      const list = visible();
      if (!list.length) return toast(S("wb.empty"));
      const group = new THREE.Group();
      list.forEach((o) => group.add(new THREE.Mesh(o.geometry, o.material).copy(o, false)));
      const data = new STLExporter().parse(group, { binary: true });
      download(new Blob([data], { type: "model/stl" }), "workbench.stl");
    },
    shot() {
      const keep = [gizmo.visible, outline.visible];
      gizmo.visible = outline.visible = false;
      renderer.setClearColor(mode === "preview" ? 0xecebe6 : 0x1d2026, 1);
      renderer.render(scene, camera);
      const url = canvas.toDataURL("image/png");
      renderer.setClearColor(0x000000, 0);
      [gizmo.visible, outline.visible] = keep;
      const a = document.createElement("a");
      a.href = url;
      a.download = "workbench.png";
      a.click();
    },
    send() {
      const list = visible();
      if (!list.length) return toast(S("wb.empty"));
      const b = bounds(list).getSize(v3);
      if (Math.max(b.x, b.y, b.z) > BED) return toast(S("wb.c.big"));
      objects.updateMatrixWorld(true);
      const parts = list.map((o) => {
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        g.deleteAttribute("uv");
        g.deleteAttribute("normal");
        return g.index ? g.toNonIndexed() : g;
      });
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      setFull(false);
      toast(S("wb.sent"));
      window.printbed?.send(merged, { nameKey: "bed.wbName", creditKey: "bed.fromWb", layer: 0.2 });
    },
  };
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // STL import: becomes an object you can move, check and print
  const stl = new STLLoader();
  $("[data-wb-import]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    closeMenus();
    if (!file || !/\.stl$/i.test(file.name)) return toast(S("bed.stlOnly"));
    if (file.size > 80e6) return toast(S("bed.stlBig"));
    const g = stl.parse(await file.arrayBuffer());
    g.computeBoundingBox();
    const size = g.boundingBox.getSize(new THREE.Vector3());
    const fit = Math.max(size.x, size.y, size.z) > 200 ? 200 / Math.max(size.x, size.y, size.z) : 1;
    g.center().scale(fit, fit, fit);
    g.deleteAttribute("normal");
    prep(g);
    if (mode !== "model") setWorkspace("model");
    snapshot();
    const o = make("mesh", C.w, g, file.name.replace(/\.stl$/i, ""));
    dropToBed(o);
    select(o);
    changed();
    frame([o]);
  });

  /* ── Preview: studio render + print check ── */
  function setWorkspace(m) {
    mode = m;
    const preview = m === "preview";
    root.classList.toggle("preview", preview);
    $$("[data-wb-ws]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.wbWs === m));
    movePill($(".wb__ws"));
    editAids.visible = !preview;
    floor.visible = preview;
    sun.castShadow = preview && !PERF.lite;
    objects.children.forEach((o) => (o.material = preview ? o.userData.print : o.userData.edit));
    orbit.autoRotate = preview && toggles.turn;
    if (preview) { buildCheck(); select(null); }
    else { overlay.clear(); select(selected); }
    queueUI();
  }

  // the analysis: size, bed contact, floating parts, overhangs, volume
  function analyse() {
    const list = visible();
    objects.updateMatrixWorld(true);
    const all = bounds(list), size = all.getSize(new THREE.Vector3());
    const boxes = list.map((o) => new THREE.Box3().setFromObject(o, true));
    // grounded = touches the bed, or touches something grounded
    const grounded = boxes.map((b) => b.min.z < 0.6);
    for (let changedAny = true; changedAny; ) {
      changedAny = false;
      boxes.forEach((b, i) => {
        if (grounded[i]) return;
        const near = b.clone().expandByScalar(0.6);
        if (boxes.some((o, j) => grounded[j] && near.intersectsBox(o))) grounded[i] = changedAny = true;
      });
    }
    let area = 0, over = 0, vol = 0;
    const red = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    list.forEach((o) => {
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
        vol += a.dot(n.copy(b).cross(c)) / 6;
        n.copy(b).sub(a).cross(v3.copy(c).sub(a));
        const len = n.length(), ar = len / 2;
        area += ar;
        // facing down more than 45°, and not lying on the bed
        if (len && n.z / len < -0.7071 && Math.min(a.z, b.z, c.z) > 0.3) {
          over += ar;
          red.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        }
      }
    });
    return { size, minZ: all.min.z, floating: grounded.filter((g) => !g).length, overPct: area ? (over / area) * 100 : 0, red, volume: Math.abs(vol), empty: !list.length };
  }

  const overMat = new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  function buildCheck() {
    const r = analyse();
    overlay.clear();
    if (toggles.over && r.red.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(r.red, 3));
      overlay.add(new THREE.Mesh(g, overMat));
    }
    const fits = Math.max(r.size.x, r.size.y, r.size.z) <= BED;
    const items = r.empty ? [["warn", S("wb.empty")]] : [
      [fits ? "ok" : "bad", fits ? S("wb.c.fits") : S("wb.c.big"), `${r.size.x.toFixed(0)} × ${r.size.y.toFixed(0)} × ${r.size.z.toFixed(0)} mm`],
      [r.minZ < 0.6 ? "ok" : "warn", r.minZ < 0.6 ? S("wb.c.bed") : S("wb.c.air")],
      [r.floating ? "warn" : "ok", r.floating ? S("wb.c.float", { n: r.floating }) : S("wb.c.solid")],
      [r.overPct > 8 ? "warn" : "ok", r.overPct > 1 ? S("wb.c.over", { p: r.overPct.toFixed(0) }) : S("wb.c.overOk"), r.overPct > 8 ? S("wb.c.supports") : ""],
    ];
    $("[data-wb-checklist]").innerHTML = items.map(([k, t, sub]) => `<li class="${k}"><i>${k === "ok" ? "✓" : k === "bad" ? "✕" : "!"}</i><span>${t}${sub ? `<small>${sub}</small>` : ""}</span></li>`).join("");
    // shells + 15% infill ≈ 60% of the solid, PLA 1.24 g/cm³ (same estimate as the print bed)
    const grams = (r.volume / 1000) * 1.24 * 0.6;
    $("[data-wb-est]").textContent = r.empty ? "" : `≈${Math.max(1, Math.round(grams))} g PLA · ≈${Math.max(1, Math.round(grams * 3.4))} min`;
    $("[data-wb-est]").title = S("bed.est");
  }

  /* ── UI ── */
  function setMode(m) {
    gizmo.setMode(m);
    $$("[data-wb-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.wbMode === m));
  }
  $$("[data-wb-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.wbMode)));
  $$("[data-wb-add]").forEach((b) => b.addEventListener("click", () => add(b.dataset.wbAdd)));
  $$("[data-wb-act]").forEach((b) => b.addEventListener("click", () => { closeMenus(); actions[b.dataset.wbAct](); }));
  $$("[data-wb-ws]").forEach((b) => b.addEventListener("click", () => setWorkspace(b.dataset.wbWs)));
  $$("[data-wb-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.wbView)));
  $$("[data-wb-template]").forEach((b) => b.addEventListener("click", () => { closeMenus(); snapshot(); loadTemplate(b.dataset.wbTemplate); }));

  // menus and the phone sheets
  const menu = $("[data-wb-menupanel]"), menuBtn = $("[data-wb-menu]");
  function closeMenus() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", false); }
  menuBtn.addEventListener("click", () => { menu.hidden = !menu.hidden; menuBtn.setAttribute("aria-expanded", !menu.hidden); });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".wb__menuwrap")) closeMenus(); });
  const showShapes = (on) => { root.classList.toggle("shapes-open", on); $("[data-wb-addtoggle]").setAttribute("aria-expanded", on); };
  $("[data-wb-addtoggle]").addEventListener("click", () => showShapes(!root.classList.contains("shapes-open")));
  $("[data-wb-sheet]").addEventListener("click", (e) => {
    const on = root.classList.toggle("sheet-open");
    e.currentTarget.setAttribute("aria-expanded", on);
  });

  // toggles: keep-on-bed, overhang overlay, turntable
  function applyToggles() {
    $$("[data-wb-toggle]").forEach((b) => b.setAttribute("aria-pressed", toggles[b.dataset.wbToggle]));
    orbit.autoRotate = mode === "preview" && toggles.turn;
    if (mode === "preview") buildCheck();
  }
  $$("[data-wb-toggle]").forEach((b) => b.addEventListener("click", () => { toggles[b.dataset.wbToggle] = !toggles[b.dataset.wbToggle]; applyToggles(); }));
  applyToggles();

  const snapSel = $("[data-wb-snap]");
  function applySnap() {
    const s = +snapSel.value;
    gizmo.setTranslationSnap(s || null);
    gizmo.setRotationSnap(s ? THREE.MathUtils.degToRad(15) : null);
    gizmo.setScaleSnap(s ? 0.05 : null);
  }
  snapSel.addEventListener("change", applySnap);
  applySnap();

  // proportional size lock
  let lock = false;
  $("[data-wb-lock]").addEventListener("click", (e) => { lock = !lock; e.currentTarget.setAttribute("aria-pressed", lock); });

  // typed transforms (Blender's N panel): location, rotation in degrees, size in mm
  const size = new THREE.Vector3(), euler = new THREE.Euler();
  $$("[data-wb-f]").forEach((input) => {
    input.addEventListener("change", () => {
      const val = parseFloat(input.value);
      if (!selected || !Number.isFinite(val)) return queueUI();
      snapshot();
      const [kind, axis] = input.dataset.wbF;
      if (kind === "p") selected.position[axis] = val;
      if (kind === "r") {
        euler.setFromQuaternion(selected.quaternion);
        euler[axis] = THREE.MathUtils.degToRad(val);
        selected.quaternion.setFromEuler(euler);
      }
      if (kind === "s" && val > 0) {
        selected.geometry.boundingBox.getSize(size);
        const next = Math.min(BED, val) / size[axis];
        if (lock) selected.scale.multiplyScalar(next / selected.scale[axis]);
        else selected.scale[axis] = next;
      }
      if (toggles.bed) keepOnBed(selected);
      changed();
    });
  });

  const sw = $("[data-wb-colors]");
  sw.innerHTML = COLOURS.map((hex) => `<button role="radio" aria-checked="false" style="--c:#${hex.toString(16).padStart(6, "0")}"></button>`).join("");
  $$("[data-wb-colors] button").forEach((b, i) =>
    b.addEventListener("click", () => {
      if (!selected) return;
      snapshot();
      selected.userData.colour = COLOURS[i];
      selected.userData.edit.color.setHex(COLOURS[i]);
      selected.userData.print.color.setHex(COLOURS[i]);
      changed();
    })
  );

  // outliner: click to select, eye to hide
  const outliner = $("[data-wb-outliner]");
  outliner.addEventListener("click", (e) => {
    const li = e.target.closest("[data-id]");
    if (!li) return;
    const o = objects.getObjectById(+li.dataset.id);
    if (e.target.closest("[data-eye]")) {
      snapshot();
      o.visible = !o.visible;
      if (!o.visible && o === selected) select(null);
      changed();
    } else if (mode === "model") select(o);
  });

  // tooltips with shortcuts
  const tip = $("[data-wb-tipbox]");
  root.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t || !finePointer) return (tip.hidden = true);
    tip.innerHTML = `${S(t.dataset.tip)}${t.dataset.key ? ` <kbd>${t.dataset.key}</kbd>` : ""}`;
    const r = t.getBoundingClientRect(), rv = view.getBoundingClientRect();
    tip.style.left = `${r.left - rv.left + r.width / 2}px`;
    tip.style.top = `${r.top - rv.top - 8}px`;
    tip.hidden = false;
  });
  root.addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });

  // one UI refresh per frame at most
  let uiQueued = false;
  function queueUI() {
    if (uiQueued) return;
    uiQueued = true;
    requestAnimationFrame(() => { uiQueued = false; updateUI(); });
  }
  function updateUI() {
    const list = objects.children;
    $("[data-wb-count]").textContent = list.length ? ` · ${list.length}` : "";
    outliner.innerHTML = list.length
      ? list.map((o) => `<li data-id="${o.id}" class="${o === selected ? "on" : ""}${o.visible ? "" : " off"}">
          <svg><use href="#s-${o.userData.type === "mesh" ? "cube" : o.userData.type}" /></svg>
          <span>${esc(label(o))}</span><i style="--c:#${o.userData.colour.toString(16).padStart(6, "0")}"></i>
          <button data-eye aria-label="Hide"><svg><use href="#i-eye${o.visible ? "" : "-off"}" /></svg></button></li>`).join("")
      : `<li class="empty">${S("wb.empty")}</li>`;

    const vis = visible();
    const b = vis.length ? bounds(vis).getSize(new THREE.Vector3()) : null;
    const tris = vis.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
    $("[data-wb-stats]").textContent = b ? `${Math.round(tris).toLocaleString("en")} tri · ${b.x.toFixed(0)}×${b.y.toFixed(0)}×${b.z.toFixed(0)} mm` : "";

    $("[data-wb-edit]").hidden = !selected;
    $("[data-wb-selname]").textContent = selected ? label(selected) : S("wb.none");
    if (!selected) return;
    selected.geometry.boundingBox.getSize(size).multiply(selected.scale);
    euler.setFromQuaternion(selected.quaternion);
    const vals = {
      px: selected.position.x, py: selected.position.y, pz: selected.position.z,
      rx: THREE.MathUtils.radToDeg(euler.x), ry: THREE.MathUtils.radToDeg(euler.y), rz: THREE.MathUtils.radToDeg(euler.z),
      sx: Math.abs(size.x), sy: Math.abs(size.y), sz: Math.abs(size.z),
    };
    $$("[data-wb-f]").forEach((input) => { if (document.activeElement !== input) input.value = Math.round(vals[input.dataset.wbF] * 10) / 10; });
    $$("[data-wb-colors] button").forEach((btn, i) => btn.setAttribute("aria-checked", COLOURS[i] === selected.userData.colour));
  }

  let toastTimer;
  function toast(msg) {
    const t = $("[data-wb-toast]");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  /* ── Fullscreen (and the only way to edit on phones, so the page still scrolls) ── */
  const tap = $("[data-wb-tap]");
  function setFull(on) {
    root.classList.toggle("full", on);
    document.body.classList.toggle("locked", on);
    orbit.enableZoom = on;
    const editable = on || finePointer;
    orbit.enabled = gizmo.enabled = editable;
    tap.hidden = editable;
    canvas.style.touchAction = editable ? "none" : "pan-y";
    if (!on && !finePointer) { select(null); root.classList.remove("sheet-open", "shapes-open"); }
    requestAnimationFrame(() => { resize(); movePill($(".wb__ws")); });
  }
  $("[data-wb-full]").addEventListener("click", () => setFull(!root.classList.contains("full")));
  tap.addEventListener("click", () => setFull(true));

  // Keyboard shortcuts while the pointer is over the workbench (or it's fullscreen)
  let hover = false;
  root.addEventListener("pointerenter", () => (hover = true));
  root.addEventListener("pointerleave", () => (hover = false));
  addEventListener("keydown", (e) => {
    if (!(hover || root.classList.contains("full")) || e.target.matches("input, select, textarea")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") (e.shiftKey ? doRedo : doUndo)();
    else if (mod && k === "y") doRedo();
    else if (mod) return;
    else if (k === "tab") setWorkspace(mode === "model" ? "preview" : "model");
    else if (k === "g") setMode("translate");
    else if (k === "r") setMode("rotate");
    else if (k === "s") setMode("scale");
    else if (k === "x" || k === "delete" || k === "backspace") actions.del();
    else if (e.shiftKey && k === "d") actions.dup();
    else if (k === "f" || k === ".") frame();
    else if (k === "h" && e.altKey) { snapshot(); objects.children.forEach((o) => (o.visible = true)); changed(); }
    else if (k === "h" && selected) { snapshot(); selected.visible = false; select(null); changed(); }
    else if ({ 0: "persp", 7: "top", 1: "front", 3: "right" }[e.key]) setView({ 0: "persp", 7: "top", 1: "front", 3: "right" }[e.key]);
    else if (k === "escape") root.classList.contains("full") ? setFull(false) : select(null);
    else return;
    e.preventDefault();
  });

  /* ── Render loop, only while visible ── */
  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // centre the scene in the free space between the tool column and the side panel
    const side = $(".wb__side"), tools = $(".wb__tools");
    const shift = innerWidth > 860 && side.offsetWidth ? (side.offsetWidth - tools.offsetWidth) / 2 : 0;
    if (shift) camera.setViewOffset(w, h, shift, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  applyQuality = () => {
    renderer.setPixelRatio(PERF.lite ? 1 : Math.min(devicePixelRatio, 2));
    sun.castShadow = mode === "preview" && !PERF.lite;
    resize();
  };
  applyQuality();

  let last = 0;
  function tick(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 420);
      const e = 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      orbit.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.t >= 1) fly = null;
    }
    orbit.update();
    renderer.render(scene, camera);
  }
  new IntersectionObserver(([e]) => {
    last = 0;
    renderer.setAnimationLoop(e.isIntersecting || root.classList.contains("full") ? tick : null);
  }).observe(view);

  document.addEventListener("langchange", () => { queueUI(); if (mode === "preview") buildCheck(); requestAnimationFrame(() => movePill($(".wb__ws"))); });

  /* ── Start: last session on this device, or the robot ── */
  setFull(false);
  setMode("translate");
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch {}
  if (Array.isArray(saved) && saved.length) restore(saved);
  else loadTemplate("robot");
  setView("persp");
  movePill($(".wb__ws"));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
