// Interactive print bed: a 3D model you can spin, slice layer by layer, or "print".
// three.js is only downloaded when the section is about to scroll into view.

const root = document.querySelector("[data-printbed]");
const $ = (s) => root.querySelector(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const PERF = window.PERF || { lite: false }; // set by main.js

let started = false, near = false;
let applyQuality = () => {}; // replaced once the scene exists

function boot() {
  if (started) return;
  started = true;
  $("[data-bed-load]").hidden = true;
  start().catch(fail);
}

if (root) {
  const load = $("[data-bed-load]");
  load.addEventListener("click", boot);
  // In lite mode nothing is downloaded until the visitor asks for it
  const io = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    io.disconnect();
    near = true;
    if (!PERF.lite) return boot();
    load.hidden = false;
    $("[data-bed-name]").textContent = "3D paused · Lite mode";
  }, { rootMargin: "600px 0px" });
  io.observe(root);

  document.addEventListener("perfchange", () => {
    if (!started && near && !PERF.lite) boot();
    applyQuality();
  });
}

function fail(err) {
  console.warn("Print bed unavailable:", err);
  $(".bed__canvas").hidden = true;
  $(".bed__fallback").hidden = false;
  $("[data-bed-name]").textContent = "3D preview unavailable";
  $(".bed__controls").hidden = true;
  $("[data-bed-hint]").hidden = true;
}

async function start() {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");

  const view = $(".bed__view");
  const canvas = $(".bed__canvas");
  const ui = {
    name: $("[data-bed-name]"), size: $("[data-bed-size]"), z: $("[data-bed-z]"), layer: $("[data-bed-layer]"),
    hint: $("[data-bed-hint]"), play: $("[data-bed-play]"), slice: $("[data-bed-slice]"), credit: $("[data-bed-credit]"),
  };

  /* ── Renderer, scene, camera (Z is up, like a slicer) ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 4 / 3, 1, 5000);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b39ff, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(80, -120, 160);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-120, 100, 60);
  scene.add(key, rim);

  // Build plate: 256 mm, like the printer, with a 10 mm grid
  const plate = new THREE.Group();
  const grid = new THREE.GridHelper(260, 26, 0xffffff, 0xffffff);
  grid.rotation.x = Math.PI / 2;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([[-130, -130], [130, -130], [130, 130], [-130, 130]].map(([x, y]) => new THREE.Vector3(x, y, 0))),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
  );
  plate.add(grid, border);
  scene.add(plate);

  /* ── Slicing: two clipping planes split "printed" from "not yet printed" ── */
  const printed = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // keeps z <= cut
  const pending = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); //  keeps z >= cut

  const mats = {
    solid: new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.55, metalness: 0.05, clippingPlanes: [printed] }),
    cap: new THREE.MeshBasicMaterial({ color: 0x111110, side: THREE.BackSide, clippingPlanes: [printed] }), // fills the cut
    ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, clippingPlanes: [pending] }),
    xray: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [printed] }),
    edges: new THREE.LineBasicMaterial({ color: 0xffffff, clippingPlanes: [printed] }),
  };

  const model = new THREE.Group();
  scene.add(model);

  // Moving parts of the "printer": the current layer outline and a nozzle
  const ring = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
  const nozzle = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 24), new THREE.MeshStandardMaterial({ color: 0x111110, roughness: 0.4 }));
  nozzle.rotation.x = -Math.PI / 2; // tip pointing down (-Z)
  scene.add(ring, nozzle);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false; // never steal the page scroll
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.9;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enabled = finePointer;

  let idle;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(idle);
    ui.hint.classList.add("gone");
  });
  controls.addEventListener("end", () => {
    idle = setTimeout(() => (controls.autoRotate = !reduced && !PERF.lite), 4000);
  });

  /* ── State ── */
  let meta = MODELS[0];
  let geom = null, size = new THREE.Vector3(), edges = null;
  let mode = "solid", v = 1, playing = false;

  function setGeometry(g, info) {
    model.children.forEach((c) => c.geometry !== g && c.geometry?.dispose());
    model.clear();
    geom?.dispose();
    edges = null;
    meta = info;
    geom = g;
    if (!geom.attributes.normal) geom.computeVertexNormals();

    // Sit the model on the plate, centred; shrink anything bigger than the plate
    geom.computeBoundingBox();
    let box = geom.boundingBox;
    box.getSize(size);
    const fit = Math.max(size.x, size.y) > 240 || size.z > 250 ? 240 / Math.max(size.x, size.y, size.z) : 1;
    if (fit !== 1) geom.scale(fit, fit, fit);
    geom.computeBoundingBox();
    box = geom.boundingBox;
    geom.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
    geom.computeBoundingBox();
    geom.boundingBox.getSize(size);

    model.add(
      new THREE.Mesh(geom, mats.solid),
      new THREE.Mesh(geom, mats.cap),
      new THREE.Mesh(geom, mats.ghost),
      new THREE.Mesh(geom, mats.xray)
    );

    const pad = 4, hx = size.x / 2 + pad, hy = size.y / 2 + pad;
    ring.geometry.setFromPoints([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => new THREE.Vector3(x, y, 0)));

    // Frame the camera on the model
    const r = Math.max(size.x, size.y, size.z);
    controls.target.set(0, 0, size.z * 0.42);
    camera.position.set(r * 1.9, -r * 2.3, r * 1.5);
    controls.update();

    const tris = (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
    ui.name.innerHTML = `${esc(meta.name)} <b>· ${Math.round(tris).toLocaleString("en")} tri${fit !== 1 ? " · scaled" : ""}</b>`;
    ui.size.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
    ui.credit.textContent = meta.credit || "";

    setMode(mode);
    root.classList.add("ready");
    // print it once when it appears (full mode only)
    playing = !reduced && !PERF.lite;
    v = playing ? 0 : 1;
    apply();
  }

  function setMode(m) {
    mode = m;
    if (m !== "solid" && !edges) {
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 22), mats.edges);
      model.add(edges);
    }
    const [solid, cap, , xray] = model.children;
    solid.visible = cap.visible = m === "solid";
    xray.visible = m === "xray";
    if (edges) edges.visible = m !== "solid";
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
  }

  function apply(t = 0) {
    if (!geom) return; // still downloading
    const z = v * size.z;
    printed.constant = z + 0.001;
    pending.constant = -z;
    const busy = v < 0.999;
    model.children[2].visible = busy; // ghost of what's left to print
    ring.visible = nozzle.visible = busy;
    ring.position.z = z;
    // nozzle wanders over the layer like it's tracing the outline
    nozzle.position.set(Math.sin(t * 0.009) * size.x * 0.42, Math.cos(t * 0.007) * size.y * 0.42, z + 3.6);

    const layerH = meta.layer || 0.2;
    const total = Math.round(size.z / layerH);
    ui.z.textContent = `Z ${z.toFixed(2).padStart(5, "0")} mm`;
    ui.layer.textContent = `L ${String(Math.round(v * total)).padStart(3, "0")}/${total}`;
    ui.slice.value = Math.round(v * 1000);
    ui.play.textContent = playing ? "❚❚ Pause" : v >= 0.999 ? "↺ Reprint" : "▶ Print";
  }

  /* ── Loop: only renders while the section is on screen ── */
  let last = 0;
  function tick(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (playing) {
      v = Math.min(1, v + dt / 7000);
      if (v >= 1) playing = false;
    }
    apply(t);
    controls.update();
    renderer.render(scene, camera);
  }
  new IntersectionObserver(([e]) => {
    last = 0;
    renderer.setAnimationLoop(e.isIntersecting ? tick : null);
  }).observe(view);

  function resize() {
    const { clientWidth: w, clientHeight: h } = view;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);

  // Lite: 1x resolution, no auto-spin, no running print
  applyQuality = () => {
    renderer.setPixelRatio(PERF.lite ? 1 : Math.min(devicePixelRatio, 2));
    controls.autoRotate = !reduced && !PERF.lite;
    if (PERF.lite) playing = false;
    resize();
  };
  applyQuality();

  /* ── Controls ── */
  ui.play.addEventListener("click", () => {
    if (v >= 0.999) v = 0;
    playing = !playing;
  });
  ui.slice.addEventListener("input", () => {
    playing = false;
    v = ui.slice.value / 1000;
  });
  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("[data-bed-touch]").addEventListener("click", (e) => {
    controls.enabled = !controls.enabled;
    root.classList.toggle("touch-on", controls.enabled);
    e.currentTarget.setAttribute("aria-pressed", controls.enabled);
  });

  // Visitors can drop (or pick) their own STL — it never leaves their browser
  const stl = new STLLoader();
  async function loadFile(file) {
    if (!file || !/\.stl$/i.test(file.name)) return (ui.name.textContent = "Only .stl files, please");
    if (file.size > 80e6) return (ui.name.textContent = "That STL is too big (80 MB max)");
    const g = stl.parse(await file.arrayBuffer());
    setGeometry(g, { name: file.name.replace(/\.stl$/i, ""), credit: "Your file — loaded locally, never uploaded.", layer: 0.2 });
  }
  $("[data-bed-file]").addEventListener("change", (e) => loadFile(e.target.files[0]));
  view.addEventListener("dragover", (e) => { e.preventDefault(); view.classList.add("drag"); });
  view.addEventListener("dragleave", () => view.classList.remove("drag"));
  view.addEventListener("drop", (e) => {
    e.preventDefault();
    view.classList.remove("drag");
    loadFile(e.dataTransfer.files[0]);
  });

  /* ── Load the first model ── */
  const gltf = await new GLTFLoader().loadAsync(meta.file, (e) => {
    if (e.total) ui.name.textContent = `Loading model… ${Math.round((e.loaded / e.total) * 100)}%`;
  });
  let mesh;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  setGeometry(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), meta);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
