// Interactive print bed: a 3D model you can spin, slice layer by layer, recolour, or "print".
// three.js is only downloaded when the section is about to scroll into view (or on request in lite mode).

const root = document.querySelector("[data-printbed]");
const $ = (s) => root.querySelector(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const PERF = window.PERF || { lite: false }; // set by main.js
const S = (k, v) => I18N.s(k, v);

// PLA colours, like an AMS full of spools
const FILAMENTS = [
  ["orange", 0xff6a13], ["white", 0xeeece6], ["black", 0x2a2a2e], ["green", 0x00ae42],
  ["red", 0xd7263d], ["yellow", 0xf5c400], ["sky", 0x7cc4ff],
];

let started = false, near = false;
let applyQuality = () => {}; // replaced once the scene exists
let incoming = null; // a model sent from the Workbench before the bed was ready
let receive = null;

function boot() {
  if (started) return;
  started = true;
  $("[data-bed-load]").hidden = true;
  start().catch(fail);
}

// The Workbench calls this to print what the visitor modelled
window.printbed = {
  send(geometry, info) {
    if (receive) receive(geometry, info);
    else (incoming = { geometry, info }), boot();
    root.closest("section").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  },
};

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
    $("[data-bed-name]").textContent = S("bed.paused");
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
  $("[data-bed-name]").textContent = S("bed.unavailable");
  $(".panel").hidden = true;
  $("[data-bed-hint]").hidden = true;
  $("[data-bed-slice]").hidden = true;
}

async function start() {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");

  const view = $(".bed__view");
  const canvas = $(".bed__canvas");
  const ui = {
    name: $("[data-bed-name]"), size: $("[data-bed-size]"), z: $("[data-bed-z]"), stats: $("[data-bed-stats]"),
    hint: $("[data-bed-hint]"), play: $("[data-bed-play]"), playLabel: $("[data-bed-play-label]"), credit: $("[data-bed-credit]"),
    slider: $("[data-bed-slice]"), layer: $("[data-bed-layer]"), progress: $(".bed__progress i"), colors: $("[data-bed-colors]"),
  };

  /* ── Renderer, scene, camera (Z is up, like a slicer) ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; // soft studio reflections

  const camera = new THREE.PerspectiveCamera(28, 4 / 3, 1, 5000);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b39ff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(90, -120, 200);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 600 });
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  const rim = new THREE.DirectionalLight(0xbfd0ff, 1.1);
  rim.position.set(-140, 120, 80);
  scene.add(key, rim);

  // Build plate: 256 mm, dark textured-PEI look, with a faint 10 mm grid
  const plate = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(256, 256, 4),
    new THREE.MeshStandardMaterial({ color: 0x1b1c24, roughness: 0.82, metalness: 0.15 })
  );
  slab.position.z = -2.01;
  slab.receiveShadow = true;
  const grid = new THREE.GridHelper(250, 25, 0xffffff, 0xffffff);
  grid.rotation.x = Math.PI / 2;
  grid.material.transparent = true;
  grid.material.opacity = 0.09;
  const rimLine = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
  );
  rimLine.position.copy(slab.position);
  plate.add(slab, grid, rimLine);
  scene.add(plate);

  /* ── Slicing: two clipping planes split "printed" from "not yet printed" ── */
  const printed = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // keeps z <= cut
  const pending = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); //  keeps z >= cut

  // Layer lines and the glow of the freshly extruded layer, added to a standard material
  const shared = { uLayer: { value: 0.2 }, uCut: { value: 0 }, uHot: { value: 0 } };
  const solid = new THREE.MeshStandardMaterial({ color: FILAMENTS[0][1], roughness: 0.48, metalness: 0, clippingPlanes: [printed] });
  solid.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = "varying float vWz;\n" + sh.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvWz = (modelMatrix * vec4(transformed, 1.0)).z;"
    );
    sh.fragmentShader = "varying float vWz;\nuniform float uLayer, uCut, uHot;\n" + sh.fragmentShader
      .replace("#include <color_fragment>", `#include <color_fragment>
        float lz = vWz / uLayer;
        float aa = fwidth(lz);
        float fade = 1.0 - smoothstep(0.35, 0.9, aa);           // hide lines when too small to see
        diffuseColor.rgb *= 1.0 - 0.16 * (1.0 - sin(fract(lz) * 3.14159)) * fade;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float hot = uHot * (1.0 - smoothstep(0.0, 1.4, uCut - vWz));
        totalEmissiveRadiance += vec3(1.0, 0.38, 0.08) * hot * 0.9;`);
  };

  const mats = {
    solid,
    cap: new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, clippingPlanes: [printed] }), // fills the cut
    ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthWrite: false, clippingPlanes: [pending] }),
    xray: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [printed] }),
    edges: new THREE.LineBasicMaterial({ color: 0xffffff, clippingPlanes: [printed] }),
  };

  const model = new THREE.Group();
  scene.add(model);

  // The current layer's real outline (sliced from the mesh) and the print head that traces it
  const contour = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd2a8 }));
  const head = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 5), new THREE.MeshStandardMaterial({ color: 0x2b2d36, roughness: 0.5, metalness: 0.4 }));
  block.position.z = 9.5;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 24), new THREE.MeshStandardMaterial({ color: 0xd4a64a, roughness: 0.3, metalness: 1 }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = 3.2;
  const melt = new THREE.PointLight(0xff7a2a, 0, 30, 2); // warm light from the hot nozzle
  melt.position.z = 1;
  head.add(block, tip, melt);
  block.castShadow = tip.castShadow = true;
  scene.add(contour, head);

  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false; // never steal the page scroll
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotateSpeed = 0.8;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
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
  let mode = "solid", v = 1, playing = false, filament = FILAMENTS[0];
  let tris = null, buckets = [], layerH = 0.2, total = 1, segBuf = null, segCount = 0, slicedLayer = -1;

  // Triangles grouped by layer, so slicing one layer only looks at the triangles that cross it
  function index(g) {
    const pos = g.attributes.position.array;
    const idx = g.index ? g.index.array : null;
    const n = (idx ? idx.length : pos.length / 3) / 3;
    tris = new Float32Array(n * 9);
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx[t * 3 + k] : t * 3 + k;
        tris.set(pos.subarray(vi * 3, vi * 3 + 3), t * 9 + k * 3);
      }
    buckets = Array.from({ length: total + 1 }, () => []);
    let vol = 0;
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const z0 = tris[o + 2], z1 = tris[o + 5], z2 = tris[o + 8];
      const a = Math.max(0, Math.floor(Math.min(z0, z1, z2) / layerH));
      const b = Math.min(total, Math.floor(Math.max(z0, z1, z2) / layerH));
      for (let l = a; l <= b; l++) buckets[l].push(t);
      // signed volume of the tetrahedron to the origin; sums to the mesh volume
      vol += (tris[o] * (tris[o + 4] * z2 - z1 * tris[o + 7]) - tris[o + 1] * (tris[o + 3] * z2 - z1 * tris[o + 6]) + z0 * (tris[o + 3] * tris[o + 7] - tris[o + 4] * tris[o + 6])) / 6;
    }
    const most = buckets.reduce((m, b) => Math.max(m, b.length), 0);
    segBuf = new Float32Array(most * 6);
    contour.geometry.setAttribute("position", new THREE.BufferAttribute(segBuf, 3).setUsage(THREE.DynamicDrawUsage));
    return Math.abs(vol); // mm³
  }

  function slice(l) {
    const z = (l + 0.5) * layerH;
    let s = 0;
    for (const t of buckets[Math.min(l, total)] || []) {
      const o = t * 9;
      let hits = 0;
      for (let e = 0; e < 3; e++) {
        const p = o + e * 3, q = o + ((e + 1) % 3) * 3;
        const za = tris[p + 2], zb = tris[q + 2];
        if ((za - z) * (zb - z) >= 0 || za === zb) continue;
        const f = (z - za) / (zb - za);
        segBuf[s++] = tris[p] + (tris[q] - tris[p]) * f;
        segBuf[s++] = tris[p + 1] + (tris[q + 1] - tris[p + 1]) * f;
        segBuf[s++] = z;
        if (++hits === 2) break;
      }
      if (hits === 1) s -= 3; // degenerate touch, drop the lone point
    }
    segCount = s / 6;
    contour.geometry.setDrawRange(0, segCount * 2);
    contour.geometry.attributes.position.needsUpdate = true;
    slicedLayer = l;
  }

  function setGeometry(g, info) {
    model.children.forEach((c) => c.geometry !== g && c.geometry?.dispose());
    model.clear();
    geom?.dispose();
    edges = null;
    meta = info;
    geom = g;
    geom.deleteAttribute("normal");
    geom.computeVertexNormals();

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

    const solidMesh = new THREE.Mesh(geom, mats.solid);
    solidMesh.castShadow = solidMesh.receiveShadow = true;
    model.add(solidMesh, new THREE.Mesh(geom, mats.cap), new THREE.Mesh(geom, mats.ghost), new THREE.Mesh(geom, mats.xray));

    layerH = meta.layer || 0.2;
    shared.uLayer.value = layerH;
    total = Math.max(1, Math.round(size.z / layerH));
    const volume = index(geom);
    ui.slider.setAttribute("aria-valuemax", total);

    // Frame the camera on the model
    const r = Math.max(size.x, size.y, size.z);
    controls.target.set(0, 0, size.z * 0.4);
    camera.position.set(r * 1.7, -r * 2.2, r * 1.35);
    controls.update();

    // Rough slicer-style estimate: shells + 15% infill ≈ 60% of solid volume, PLA 1.24 g/cm³
    const grams = (volume / 1000) * 1.24 * 0.6;
    ui.stats.textContent = `≈${Math.max(1, Math.round(grams))} g PLA · ≈${Math.max(1, Math.round(grams * 3.4))} min`;
    ui.size.textContent = `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
    meta.fit = fit;
    labels();

    root.classList.add("ready");
    setMode(mode);
    // print it once when it appears (full mode only)
    playing = !reduced && !PERF.lite;
    v = playing ? 0 : 1;
    slicedLayer = -1;
    apply();
  }

  function labels() {
    if (!geom) return;
    const n = (geom.index ? geom.index.count : geom.attributes.position.count) / 3;
    const name = meta.name || S(meta.nameKey);
    ui.name.innerHTML = `${esc(name)} <b>· ${Math.round(n).toLocaleString("en")} tri${meta.fit !== 1 ? ` · ${S("bed.scaled")}` : ""}</b>`;
    ui.credit.textContent = meta.credit || (meta.creditKey ? S(meta.creditKey) : "");
    ui.stats.title = S("bed.est");
    ui.colors.querySelectorAll("button").forEach((b, i) => (b.title = b.ariaLabel = S(`col.${FILAMENTS[i][0]}`)));
    lastPlayState = "";
  }

  function setMode(m) {
    mode = m;
    if (m !== "solid" && !edges) {
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 22), mats.edges);
      model.add(edges);
    }
    const [solidMesh, cap, , xray] = model.children;
    solidMesh.visible = cap.visible = m === "solid";
    xray.visible = m === "xray";
    if (edges) edges.visible = m !== "solid";
    root.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
    movePill(root.querySelector(".seg"));
  }

  function setFilament(f) {
    filament = f;
    mats.solid.color.setHex(f[1]);
    ui.colors.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-checked", FILAMENTS[i] === f));
  }

  /* ── Per-frame update ── */
  let lastPlayState = "", lastLayer = -1;
  const HOT = new THREE.Color(0xffa060);
  function apply(t = 0) {
    if (!geom) return; // still downloading
    const z = v * size.z;
    const busy = v < 0.999;
    printed.constant = z + 0.001;
    pending.constant = -z;
    shared.uCut.value = z;
    shared.uHot.value += ((playing ? 1 : 0) - shared.uHot.value) * 0.15;

    // cut face: filament shade, glowing while printing
    mats.cap.color.setHex(filament[1]).multiplyScalar(0.55).lerp(HOT, shared.uHot.value * 0.8);

    model.children[2].visible = busy; // ghost of what's left to print
    const layer = Math.min(total, Math.floor(z / layerH));
    if (busy && layer !== slicedLayer) slice(layer);
    contour.visible = busy && segCount > 0;
    contour.material.color.setHex(playing ? 0xffb070 : 0xffffff);

    // the print head walks the outline during a print; parks above the part otherwise
    head.visible = busy;
    melt.intensity = playing ? 150 : 0;
    if (busy && segCount) {
      const lf = (z / layerH) % 1;
      const p = Math.min(segCount * 2 - 1, Math.floor(lf * segCount * 2));
      head.position.set(segBuf[p * 3], segBuf[p * 3 + 1], z + 0.2);
    } else head.position.set(0, 0, z + 20);

    if (layer !== lastLayer) {
      lastLayer = layer;
      ui.z.textContent = `Z ${z.toFixed(2).padStart(5, "0")} mm`;
      ui.layer.textContent = `${layer}/${total}`;
      ui.slider.setAttribute("aria-valuenow", layer);
    }
    ui.slider.style.setProperty("--p", v.toFixed(4));
    ui.progress.style.transform = `scaleX(${v})`;

    const state = playing ? "pause" : busy ? "print" : "reprint";
    if (state !== lastPlayState) {
      lastPlayState = state;
      ui.playLabel.textContent = S(`bed.${state}`);
      ui.play.querySelector("use").setAttribute("href", playing ? "#i-pause" : state === "reprint" ? "#i-restart" : "#i-play");
      root.classList.toggle("printing", playing);
    }
  }

  /* ── Loop: only renders while the section is on screen ── */
  let last = 0;
  function tick(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    if (playing) {
      v = Math.min(1, v + dt / 9000);
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

  // Lite: 1x resolution, no shadows, no auto-spin, no running print
  applyQuality = () => {
    renderer.setPixelRatio(PERF.lite ? 1 : Math.min(devicePixelRatio, 2));
    key.castShadow = !PERF.lite;
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
  $("[data-bed-restart]").addEventListener("click", () => {
    v = 0;
    playing = true;
  });
  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  ui.colors.innerHTML = FILAMENTS.map(([, hex]) => `<button role="radio" aria-checked="false" style="--c:#${hex.toString(16).padStart(6, "0")}"></button>`).join("");
  ui.colors.querySelectorAll("button").forEach((b, i) => b.addEventListener("click", () => setFilament(FILAMENTS[i])));
  setFilament(filament);

  // Vertical layer slider: drag, click, wheel-free, keyboard
  const track = ui.slider.querySelector(".vslider__track");
  const fromPointer = (e) => {
    const r = track.getBoundingClientRect();
    playing = false;
    v = Math.min(1, Math.max(0, (r.bottom - e.clientY) / r.height));
  };
  ui.slider.addEventListener("pointerdown", (e) => {
    ui.slider.setPointerCapture(e.pointerId);
    fromPointer(e);
    ui.slider.addEventListener("pointermove", fromPointer);
  });
  ui.slider.addEventListener("pointerup", () => ui.slider.removeEventListener("pointermove", fromPointer));
  ui.slider.addEventListener("keydown", (e) => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (e.key === "Home") v = 0;
    else if (e.key === "End") v = 1;
    else if (!step) return;
    else v = Math.min(1, Math.max(0, (Math.round(v * total) + step) / total));
    playing = false;
    e.preventDefault();
  });

  $("[data-bed-touch]").addEventListener("click", (e) => {
    controls.enabled = !controls.enabled;
    root.classList.toggle("touch-on", controls.enabled);
    e.currentTarget.setAttribute("aria-pressed", controls.enabled);
  });

  // Visitors can drop (or pick) their own STL — it never leaves their browser
  const stl = new STLLoader();
  async function loadFile(file) {
    if (!file || !/\.stl$/i.test(file.name)) return (ui.name.textContent = S("bed.stlOnly"));
    if (file.size > 80e6) return (ui.name.textContent = S("bed.stlBig"));
    setGeometry(stl.parse(await file.arrayBuffer()), { name: file.name.replace(/\.stl$/i, ""), creditKey: "bed.yourFile", layer: 0.2 });
  }
  $("[data-bed-file]").addEventListener("change", (e) => loadFile(e.target.files[0]));
  view.addEventListener("dragover", (e) => { e.preventDefault(); view.classList.add("drag"); });
  view.addEventListener("dragleave", () => view.classList.remove("drag"));
  view.addEventListener("drop", (e) => {
    e.preventDefault();
    view.classList.remove("drag");
    loadFile(e.dataTransfer.files[0]);
  });

  document.addEventListener("langchange", labels);
  receive = (g, info) => setGeometry(g, info);

  /* ── First model: whatever the Workbench sent, or the Benchy ── */
  if (incoming) return setGeometry(incoming.geometry, incoming.info);
  const gltf = await new GLTFLoader().loadAsync(meta.file, (e) => {
    if (e.total) ui.name.textContent = `${S("bed.loading")} ${Math.round((e.loaded / e.total) * 100)}%`;
  });
  if (geom) return; // something else arrived while downloading
  let mesh;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  setGeometry(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), meta);
}

// Slides the white pill of a segmented control under its pressed button
function movePill(seg) {
  const on = seg?.querySelector("[aria-pressed=true]");
  if (!on) return;
  seg.style.setProperty("--x", `${on.offsetLeft}px`);
  seg.style.setProperty("--w", `${on.offsetWidth}px`);
}
addEventListener("resize", () => movePill(root?.querySelector(".seg")));
document.fonts.ready.then(() => movePill(root?.querySelector(".seg")));
document.addEventListener("langchange", () => requestAnimationFrame(() => movePill(root?.querySelector(".seg"))));

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
