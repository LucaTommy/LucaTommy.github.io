// Polygon meshes for the Workbench, Blender style.
// A mesh is { verts: [[x,y,z], …], faces: [[i, j, k, …], …], smooth } — faces wind counter-clockwise
// seen from outside. smooth: 0 = flat, 1 = smooth, 2 = auto smooth (30°). Units are millimetres.

/* ── Primitives (20 mm, centred on the origin, Z up) ── */
export function prim(type) {
  const V = [], F = [];
  const ring = (n, r, z, a0 = 0) => {
    const start = V.length;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      V.push([Math.cos(a) * r, Math.sin(a) * r, z]);
    }
    return start;
  };
  if (type === "plane") {
    V.push([-10, -10, 0], [10, -10, 0], [10, 10, 0], [-10, 10, 0]);
    F.push([0, 1, 2, 3]);
    return { verts: V, faces: F, smooth: 0 };
  }
  if (type === "cube") {
    for (const z of [-10, 10]) V.push([-10, -10, z], [10, -10, z], [10, 10, z], [-10, 10, z]);
    F.push([0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]);
    return { verts: V, faces: F, smooth: 0 };
  }
  if (type === "cylinder" || type === "cone") {
    const n = 32;
    const b = ring(n, 10, -10);
    if (type === "cylinder") {
      const t = ring(n, 10, 10);
      for (let i = 0; i < n; i++) F.push([b + i, b + ((i + 1) % n), t + ((i + 1) % n), t + i]);
      F.push(Array.from({ length: n }, (_, i) => t + i));
    } else {
      const apex = V.push([0, 0, 10]) - 1;
      for (let i = 0; i < n; i++) F.push([b + i, b + ((i + 1) % n), apex]);
    }
    F.push(Array.from({ length: n }, (_, i) => b + n - 1 - i));
    return { verts: V, faces: F, smooth: 2 };
  }
  if (type === "uvsphere") {
    const seg = 32, rings = 16, r = 10;
    const top = V.push([0, 0, r]) - 1;
    const rows = [];
    for (let k = 1; k < rings; k++) {
      const phi = (k / rings) * Math.PI;
      rows.push(ring(seg, Math.sin(phi) * r, Math.cos(phi) * r));
    }
    const bottom = V.push([0, 0, -r]) - 1;
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      F.push([top, rows[0] + i, rows[0] + j]);
      for (let k = 0; k < rows.length - 1; k++) F.push([rows[k] + i, rows[k + 1] + i, rows[k + 1] + j, rows[k] + j]);
      const last = rows[rows.length - 1];
      F.push([bottom, last + j, last + i]);
    }
    return { verts: V, faces: F, smooth: 1 };
  }
  if (type === "icosphere") {
    const t = (1 + Math.sqrt(5)) / 2;
    const P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    let T = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < 2; s++) {
      const cache = new Map(), next = [];
      const mid = (a, b) => {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (!cache.has(k)) cache.set(k, P.push(P[a].map((x, i) => (x + P[b][i]) / 2)) - 1);
        return cache.get(k);
      };
      for (const [a, b, c] of T) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      T = next;
    }
    for (const p of P) {
      const l = Math.hypot(...p);
      V.push(p.map((x) => (x / l) * 10));
    }
    return { verts: V, faces: T, smooth: 1 };
  }
  if (type === "torus") {
    const seg = 48, tub = 16, R = 10, r = 3.5;
    for (let i = 0; i < seg; i++) {
      const u = (i / seg) * Math.PI * 2;
      for (let j = 0; j < tub; j++) {
        const v = (j / tub) * Math.PI * 2;
        V.push([(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]);
      }
    }
    const id = (i, j) => (i % seg) * tub + (j % tub);
    for (let i = 0; i < seg; i++) for (let j = 0; j < tub; j++) F.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
    return { verts: V, faces: F, smooth: 1 };
  }
  throw new Error(`unknown primitive ${type}`);
}

export const clone = (d) => ({ verts: d.verts.map((v) => v.slice()), faces: d.faces.map((f) => f.slice()), smooth: d.smooth });

// Newell normal: direction of the face, length = 2 × area
export function newell(d, f) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < f.length; i++) {
    const a = d.verts[f[i]], b = d.verts[f[(i + 1) % f.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}
const unit = (n) => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };

export function centroid(d, idx) {
  const c = [0, 0, 0];
  for (const i of idx) for (let k = 0; k < 3; k++) c[k] += d.verts[i][k];
  return c.map((x) => x / (idx.length || 1));
}

// Unique edges, as [a, b] with a < b
export function edges(d) {
  const seen = new Set(), out = [];
  for (const f of d.faces)
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a * 1e7 + b : b * 1e7 + a;
      if (!seen.has(k)) { seen.add(k); out.push(a < b ? [a, b] : [b, a]); }
    }
  return out;
}

// Triangles for rendering, with flat / smooth / auto-smooth normals; triFace maps triangle → face
export function triangulate(d) {
  const nTri = d.faces.reduce((n, f) => n + f.length - 2, 0);
  const pos = new Float32Array(nTri * 9), nor = new Float32Array(nTri * 9), triFace = new Int32Array(nTri);
  const fn = d.faces.map((f) => newell(d, f));
  const fu = fn.map(unit);
  let around = null;
  if (d.smooth) {
    around = d.verts.map(() => []);
    d.faces.forEach((f, i) => f.forEach((v) => around[v].push(i)));
  }
  const cos30 = Math.cos(Math.PI / 6);
  const cornerNormal = (v, fi) => {
    if (!d.smooth) return fu[fi];
    const s = [0, 0, 0];
    for (const g of around[v]) {
      if (d.smooth === 2 && fu[g][0] * fu[fi][0] + fu[g][1] * fu[fi][1] + fu[g][2] * fu[fi][2] < cos30) continue;
      s[0] += fn[g][0]; s[1] += fn[g][1]; s[2] += fn[g][2];
    }
    return unit(s);
  };
  let t = 0;
  d.faces.forEach((f, fi) => {
    const corner = f.map((v) => cornerNormal(v, fi));
    for (let i = 1; i < f.length - 1; i++) {
      for (const [k, c] of [[0, 0], [1, i], [2, i + 1]]) {
        pos.set(d.verts[f[c]], t * 9 + k * 3);
        nor.set(corner[c], t * 9 + k * 3);
      }
      triFace[t++] = fi;
    }
  });
  return { pos, nor, triFace };
}

// Remove unused vertices; returns old → new index map
export function compact(d) {
  const map = new Map();
  const verts = [];
  for (const f of d.faces) for (const v of f) if (!map.has(v)) { map.set(v, verts.length); verts.push(d.verts[v]); }
  d.verts = verts;
  d.faces = d.faces.map((f) => f.map((v) => map.get(v)));
  return map;
}

// Faces whose vertices are all selected
export const selectedFaces = (d, sel) => d.faces.map((f, i) => (f.every((v) => sel.has(v)) ? i : -1)).filter((i) => i >= 0);

/* ── Edit operations (in place) ── */

// Extrude a region of faces: the region gets new vertices, side walls join it to where it was.
// Returns the moved vertex indices and the region's average normal.
export function extrude(d, F) {
  const moved = new Map();
  for (const fi of F) for (const v of d.faces[fi]) if (!moved.has(v)) moved.set(v, d.verts.push(d.verts[v].slice()) - 1);
  const inside = new Set();
  for (const fi of F) { const f = d.faces[fi]; f.forEach((a, i) => inside.add(`${a}_${f[(i + 1) % f.length]}`)); }
  const sides = [];
  for (const fi of F) {
    const f = d.faces[fi];
    f.forEach((a, i) => {
      const b = f[(i + 1) % f.length];
      if (!inside.has(`${b}_${a}`)) sides.push([a, b, moved.get(b), moved.get(a)]);
    });
  }
  const n = [0, 0, 0];
  for (const fi of F) { const w = newell(d, d.faces[fi]); n[0] += w[0]; n[1] += w[1]; n[2] += w[2]; }
  for (const fi of F) d.faces[fi] = d.faces[fi].map((v) => moved.get(v));
  d.faces.push(...sides);
  const map = compact(d);
  return { moved: [...moved.values()].map((v) => map.get(v)), normal: unit(n) };
}

// Inset each face: an inner copy plus a ring of quads. Move the inner copy with setInset.
export function inset(d, F) {
  const items = [];
  for (const fi of F) {
    const outer = d.faces[fi].slice();
    const inner = outer.map((v) => d.verts.push(d.verts[v].slice()) - 1);
    const n = outer.length;
    for (let i = 0; i < n; i++) d.faces.push([outer[i], outer[(i + 1) % n], inner[(i + 1) % n], inner[i]]);
    d.faces[fi] = inner;
    items.push({ outer, inner, c: centroid(d, outer) });
  }
  return items;
}
export function setInset(d, items, t) {
  for (const { outer, inner, c } of items)
    outer.forEach((o, i) => {
      const p = d.verts[o], dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
      const len = Math.hypot(dx, dy, dz) || 1, k = Math.min(Math.max(t, 0), len * 0.95) / len;
      d.verts[inner[i]] = [p[0] + dx * k, p[1] + dy * k, p[2] + dz * k];
    });
}

// Merge the selection into one vertex at its centre; returns its index
export function merge(d, sel) {
  const ids = [...sel];
  if (ids.length < 2) return ids[0];
  const nv = d.verts.push(centroid(d, ids)) - 1;
  d.faces = d.faces
    .map((f) => f.map((v) => (sel.has(v) ? nv : v)).filter((v, i, a) => v !== a[(i + 1) % a.length]))
    .filter((f) => new Set(f).size >= 3);
  return compact(d).get(nv);
}

// Make a face from 3+ selected vertices (fills holes with the right winding)
export function fill(d, sel) {
  const ids = [...sel];
  if (ids.length < 3) return false;
  const c = centroid(d, ids);
  const P = ids.map((i) => d.verts[i]);
  let n = null;
  for (let i = 1; i < P.length && !n; i++)
    for (let j = i + 1; j < P.length && !n; j++) {
      const a = P[i].map((x, k) => x - P[0][k]), b = P[j].map((x, k) => x - P[0][k]);
      const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      if (Math.hypot(...cr) > 1e-6) n = unit(cr);
    }
  if (!n) return false;
  const u = unit(Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[2], 0, n[0]]);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const ang = (p) => { const q = p.map((x, k) => x - c[k]); return Math.atan2(q[0] * w[0] + q[1] * w[1] + q[2] * w[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2]); };
  let face = ids.slice().sort((a, b) => ang(d.verts[a]) - ang(d.verts[b]));
  // an existing edge a→b must appear as b→a in the new face
  const directed = new Set();
  for (const f of d.faces) f.forEach((a, i) => directed.add(`${a}_${f[(i + 1) % f.length]}`));
  const clash = face.some((a, i) => directed.has(`${a}_${face[(i + 1) % face.length]}`));
  const touches = face.some((a, i) => directed.has(`${face[(i + 1) % face.length]}_${a}`));
  if (clash) face.reverse();
  else if (!touches) {
    // no neighbours: face away from the mesh centre
    const mc = centroid(d, d.verts.map((_, i) => i)), fnrm = newell({ verts: d.verts }, face);
    if ((c[0] - mc[0]) * fnrm[0] + (c[1] - mc[1]) * fnrm[1] + (c[2] - mc[2]) * fnrm[2] < 0) face.reverse();
  }
  d.faces.push(face);
  return true;
}

// Delete by vertices, edges or faces (as in Blender's X menu)
export function remove(d, sel, what) {
  if (what === "faces") d.faces = d.faces.filter((f) => !f.every((v) => sel.has(v)));
  else if (what === "edges") d.faces = d.faces.filter((f) => !f.some((a, i) => sel.has(a) && sel.has(f[(i + 1) % f.length])));
  else d.faces = d.faces.filter((f) => !f.some((v) => sel.has(v)));
  compact(d);
}

export function flip(d, F) { for (const fi of F) d.faces[fi].reverse(); }

// Everything connected to the selection
export function linked(d, sel) {
  const out = new Set(sel);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of d.faces)
      if (f.some((v) => out.has(v)) && !f.every((v) => out.has(v))) { f.forEach((v) => out.add(v)); grew = true; }
  }
  return out;
}

// Apply a 4×4 column-major matrix (three.js .elements) to every vertex
export function transform(d, e) {
  d.verts = d.verts.map(([x, y, z]) => {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
    return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, (e[2] * x + e[6] * y + e[10] * z + e[14]) / w];
  });
  // a mirroring matrix turns faces inside out: wind them back
  const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
  if (det < 0) d.faces.forEach((f) => f.reverse());
  return d;
}

// Append mesh b into a
export function append(a, b) {
  const off = a.verts.length;
  a.verts.push(...b.verts.map((v) => v.slice()));
  a.faces.push(...b.faces.map((f) => f.map((v) => v + off)));
  return a;
}

// Triangles → polygon mesh, welding identical vertices (for imported STLs)
export function fromTriangles(pos) {
  const map = new Map(), verts = [], faces = [];
  const id = (i) => {
    const k = `${pos[i].toFixed(4)},${pos[i + 1].toFixed(4)},${pos[i + 2].toFixed(4)}`;
    if (!map.has(k)) map.set(k, verts.push([pos[i], pos[i + 1], pos[i + 2]]) - 1);
    return map.get(k);
  };
  for (let i = 0; i < pos.length; i += 9) {
    const f = [id(i), id(i + 3), id(i + 6)];
    if (new Set(f).size === 3) faces.push(f);
  }
  return { verts, faces, smooth: 2 };
}
