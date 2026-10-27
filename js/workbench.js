// Workbench: a tiny Blender. Add primitives, move/rotate/scale them with a gizmo,
// export an STL, or send the model to the print bed above (printbed.js).

const root = document.querySelector("[data-workbench]");
const $ = (s) => root.querySelector(s);
const $$ = (s) => [...root.querySelectorAll(s)];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const PERF = window.PERF || { lite: false };
const S = (k, v) => I18N.s(k, v);

const COLOURS = [
  ["orange", 0xff6a13], ["white", 0xeeece6], ["black", 0x2a2a2e], ["green", 0x00ae42],
  ["red", 0xd7263d], ["yellow", 0xf5c400], ["sky", 0x7cc4ff],
];

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
  const { mergeGeometries } = await import("three/addons/utils/BufferGeometryUtils.js");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");

  const view = $(".wb__view");
  const canvas = $(".wb__canvas");
  root.classList.add("ready");
  root.classList.toggle("touch", !finePointer);

  /* ── Scene (Z up, millimetres, like the printer) ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 16 / 10, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(110, -150, 110);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(80, -100, 160);
  scene.add(sun);

  // Floor grid with Blender-style coloured axes
  const grid = new THREE.GridHelper(256, 32, 0x555b66, 0x30343c);
  grid.rotation.x = Math.PI / 2;
  const axes = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-128, 0, 0.05), new THREE.Vector3(128, 0, 0.05), new THREE.Vector3(0, -128, 0.05), new THREE.Vector3(0, 128, 0.05)]),
    new THREE.LineBasicMaterial({ vertexColors: true })
  );
  axes.geometry.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.3, 0.35, 1, 0.3, 0.35, 0.5, 0.85, 0.2, 0.5, 0.85, 0.2], 3));
  scene.add(grid, axes);

  const objects = new THREE.Group();
  scene.add(objects);

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(0, 0, 18);
  orbit.enableDamping = true;
  orbit.enableZoom = false; // turned on once the visitor clicks into the viewport
  orbit.maxPolarAngle = Math.PI / 2 - 0.02;
  orbit.update();

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(finePointer ? 0.9 : 1.25);
  scene.add(gizmo);
  gizmo.addEventListener("dragging-changed", (e) => (orbit.enabled = !e.value));
  gizmo.addEventListener("mouseDown", snapshot);
  gizmo.addEventListener("objectChange", showProps);

  /* ── Shapes, all 20 mm and centred, sitting on the floor when added ── */
  const SHAPES = {
    cube: () => new THREE.BoxGeometry(20, 20, 20),
    sphere: () => new THREE.SphereGeometry(10, 48, 32),
    cylinder: () => new THREE.CylinderGeometry(10, 10, 20, 48).rotateX(Math.PI / 2),
    cone: () => new THREE.ConeGeometry(10, 20, 48).rotateX(Math.PI / 2),
    torus: () => new THREE.TorusGeometry(10, 3.5, 24, 64),
    capsule: () => new THREE.CapsuleGeometry(7, 10, 8, 32).rotateX(Math.PI / 2),
  };
  const geoCache = {};
  const geometryFor = (type) => (geoCache[type] ||= (() => { const g = SHAPES[type](); g.computeBoundingBox(); return g; })());

  let wire = false;
  function make(type, colour = COLOURS[0][1]) {
    const mesh = new THREE.Mesh(geometryFor(type), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5, wireframe: wire }));
    mesh.userData = { type, colour };
    objects.add(mesh);
    return mesh;
  }

  /* ── Undo / redo: whole-scene snapshots (scenes here are tiny) ── */
  const undo = [], redo = [];
  const state = () => objects.children.map((o) => ({ type: o.userData.type, colour: o.userData.colour, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() }));
  function restore(list) {
    select(null);
    objects.children.slice().forEach((o) => { o.material.dispose(); objects.remove(o); });
    list.forEach((d) => {
      const o = make(d.type, d.colour);
      o.position.fromArray(d.p);
      o.quaternion.fromArray(d.q);
      o.scale.fromArray(d.s);
    });
    updateCount();
  }
  function snapshot() {
    undo.push(state());
    if (undo.length > 60) undo.shift();
    redo.length = 0;
  }
  function doUndo() { if (undo.length) { redo.push(state()); restore(undo.pop()); } }
  function doRedo() { if (redo.length) { undo.push(state()); restore(redo.pop()); } }

  /* ── Selection ── */
  let selected = null;
  function select(o) {
    if (selected) selected.material.emissive.setHex(0x000000);
    selected = o;
    if (o) {
      o.material.emissive.setHex(0x1a1a1a);
      gizmo.attach(o);
    } else gizmo.detach();
    showProps();
  }

  const size = new THREE.Vector3();
  function showProps() {
    const edit = $("[data-wb-edit]");
    edit.hidden = !selected;
    $("[data-wb-sel]").textContent = selected ? S(`wb.${selected.userData.type}`) : S("wb.none");
    if (!selected) return;
    // Blender-style dimensions: the shape's own box times its scale
    selected.geometry.boundingBox.getSize(size).multiply(selected.scale);
    ["x", "y", "z"].forEach((a) => {
      const input = $(`[data-wb-size="${a}"]`);
      if (document.activeElement !== input) input.value = Math.round(Math.abs(size[a]) * 10) / 10;
    });
    $$("[data-wb-colors] button").forEach((b, i) => b.setAttribute("aria-checked", COLOURS[i][1] === selected.userData.colour));
  }

  // tap/click selects; a drag (orbit) doesn't
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  canvas.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
    orbit.enableZoom = true; // the visitor is working in here now
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!gizmo.enabled) return; // phones: only after "Tap to edit"
    if (!downAt || gizmo.dragging || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(objects.children, false)[0];
    select(hit ? hit.object : null);
  });
  root.addEventListener("pointerleave", () => { if (!root.classList.contains("full")) orbit.enableZoom = false; });

  /* ── Actions ── */
  function dropToBed(o) {
    const b = new THREE.Box3().setFromObject(o);
    o.position.z -= b.min.z;
  }
  function add(type) {
    snapshot();
    const o = make(type, COLOURS[objects.children.length % COLOURS.length][1]);
    o.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0);
    dropToBed(o);
    select(o);
    gizmo.setMode("translate");
    setMode("translate");
    updateCount();
  }
  const actions = {
    dup() {
      if (!selected) return;
      snapshot();
      const o = make(selected.userData.type, selected.userData.colour);
      o.position.copy(selected.position).add(new THREE.Vector3(12, 12, 0));
      o.quaternion.copy(selected.quaternion);
      o.scale.copy(selected.scale);
      select(o);
      updateCount();
    },
    del() {
      if (!selected) return;
      snapshot();
      const o = selected;
      select(null);
      o.material.dispose();
      objects.remove(o);
      updateCount();
    },
    drop() {
      if (!selected) return;
      snapshot();
      dropToBed(selected);
      showProps();
    },
    clear() {
      if (!objects.children.length) return;
      snapshot();
      restore([]);
    },
    undo: doUndo,
    redo: doRedo,
    export() {
      if (!objects.children.length) return toast(S("wb.empty"));
      select(null);
      const data = new STLExporter().parse(objects, { binary: true });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "model/stl" }));
      a.download = "workbench.stl";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    send() {
      if (!objects.children.length) return toast(S("wb.empty"));
      objects.updateMatrixWorld(true);
      const parts = objects.children.map((o) => {
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

  /* ── UI wiring ── */
  const addMenu = $("[data-wb-addmenu]"), addToggle = $("[data-wb-addtoggle]");
  const showAdd = (on) => { addMenu.hidden = !on; addToggle.setAttribute("aria-expanded", on); };
  addToggle.addEventListener("click", () => showAdd(addMenu.hidden));
  $$("[data-wb-add]").forEach((b) => b.addEventListener("click", () => { add(b.dataset.wbAdd); showAdd(false); }));
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".wb__addwrap")) showAdd(false); });

  const seg = $(".seg");
  function setMode(m) {
    gizmo.setMode(m);
    $$("[data-wb-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.wbMode === m));
    movePill(seg);
  }
  $$("[data-wb-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.wbMode)));
  $$("[data-wb-act]").forEach((b) => b.addEventListener("click", () => actions[b.dataset.wbAct]()));

  const toggles = { snap: true, wire: false };
  function applyToggles() {
    gizmo.setTranslationSnap(toggles.snap ? 5 : null);
    gizmo.setRotationSnap(toggles.snap ? THREE.MathUtils.degToRad(15) : null);
    gizmo.setScaleSnap(toggles.snap ? 0.1 : null);
    wire = toggles.wire;
    objects.children.forEach((o) => (o.material.wireframe = wire));
    $$("[data-wb-toggle]").forEach((b) => b.setAttribute("aria-pressed", toggles[b.dataset.wbToggle]));
  }
  $$("[data-wb-toggle]").forEach((b) => b.addEventListener("click", () => { toggles[b.dataset.wbToggle] = !toggles[b.dataset.wbToggle]; applyToggles(); }));
  applyToggles();

  // typed dimensions in mm
  $$("[data-wb-size]").forEach((input) =>
    input.addEventListener("change", () => {
      const val = parseFloat(input.value);
      if (!selected || !(val > 0)) return showProps();
      snapshot();
      const a = input.dataset.wbSize;
      selected.geometry.boundingBox.getSize(size);
      selected.scale[a] = Math.min(250, val) / size[a];
      showProps();
    })
  );

  const sw = $("[data-wb-colors]");
  sw.innerHTML = COLOURS.map(([, hex]) => `<button role="radio" aria-checked="false" style="--c:#${hex.toString(16).padStart(6, "0")}"></button>`).join("");
  $$("[data-wb-colors] button").forEach((b, i) =>
    b.addEventListener("click", () => {
      if (!selected) return;
      snapshot();
      selected.userData.colour = COLOURS[i][1];
      selected.material.color.setHex(COLOURS[i][1]);
      showProps();
    })
  );

  function updateCount() {
    const n = objects.children.length;
    $("[data-wb-count]").textContent = n ? S("wb.objects", { n }) : S("wb.empty");
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
    if (!on && !finePointer) select(null);
    requestAnimationFrame(() => { resize(); movePill(seg); });
  }
  $("[data-wb-full]").addEventListener("click", () => setFull(!root.classList.contains("full")));
  tap.addEventListener("click", () => setFull(true));
  setFull(false);

  // Keyboard shortcuts while the pointer is over the workbench (or it's fullscreen)
  let hover = false;
  root.addEventListener("pointerenter", () => (hover = true));
  root.addEventListener("pointerleave", () => (hover = false));
  addEventListener("keydown", (e) => {
    if (!(hover || root.classList.contains("full")) || e.target.matches("input, textarea")) return;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === "z") (e.shiftKey ? doRedo : doUndo)();
    else if (mod && k === "y") doRedo();
    else if (mod) return;
    else if (k === "g") setMode("translate");
    else if (k === "r") setMode("rotate");
    else if (k === "s") setMode("scale");
    else if (k === "x" || k === "delete" || k === "backspace") actions.del();
    else if (e.shiftKey && k === "d") actions.dup();
    else if (k === "escape") root.classList.contains("full") ? setFull(false) : select(null);
    else return;
    e.preventDefault();
  });

  /* ── Render loop, only while visible ── */
  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  applyQuality = () => { renderer.setPixelRatio(PERF.lite ? 1 : Math.min(devicePixelRatio, 2)); resize(); };
  applyQuality();

  new IntersectionObserver(([e]) => {
    renderer.setAnimationLoop(e.isIntersecting || root.classList.contains("full") ? () => { orbit.update(); renderer.render(scene, camera); } : null);
  }).observe(view);

  document.addEventListener("langchange", () => { updateCount(); showProps(); requestAnimationFrame(() => movePill(seg)); });

  /* ── A little starter model: a tiny robot ── */
  restore([
    { type: "cylinder", colour: 0xeeece6, p: [0, 0, 3], q: [0, 0, 0, 1], s: [1.4, 1.4, 0.3] },
    { type: "cube", colour: 0xff6a13, p: [0, 0, 17], q: [0, 0, 0, 1], s: [1, 0.8, 1.1] },
    { type: "sphere", colour: 0xeeece6, p: [0, 0, 36], q: [0, 0, 0, 1], s: [0.9, 0.9, 0.9] },
    { type: "capsule", colour: 0x2a2a2e, p: [0, 0, 48], q: [0, 0, 0, 1], s: [0.25, 0.25, 0.45] },
    { type: "torus", colour: 0x00ae42, p: [0, 0, 55], q: [0, 0, 0, 1], s: [0.45, 0.45, 0.6] },
  ]);
  setMode("translate");
}
