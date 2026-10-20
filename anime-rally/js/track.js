// Procedural rally stages: a closed spline road with banked corners baked into a heightfield,
// toon terrain, instanced low-poly forests, chevrons, gates, sky and clouds.
(function () {
  'use strict';
  const AR = window.AR;

  // Surface ids (also index into tire grip tables)
  AR.SURF = { TARMAC: 0, GRAVEL: 1, GRASS: 2, SNOW: 3, SAND: 4 };
  AR.GRIP = {
    street: [1.08, 0.74, 0.58, 0.38, 0.55],
    gravel: [0.98, 0.95, 0.72, 0.52, 0.7],
    snow: [0.86, 0.86, 0.7, 0.8, 0.66],
  };
  AR.SURF_NAMES = ['tarmac', 'gravel', 'grass', 'snow', 'sand'];

  AR.STAGES = [
    {
      id: 'pine', name: 'Pine Hollow', jp: '松の谷', desc: 'Hardpack forest dirt with banked corners. Sunny afternoon.',
      seed: 11, radius: 300, wobble: 0.38, nPts: 15, hills: 22,
      road: AR.SURF.GRAVEL, off: AR.SURF.GRASS, width: 11,
      sky: [0x4f8fe6, 0xbfe3ff], fog: 0xcfe6f5, fogNear: 180, fogFar: 900,
      sun: 0xfff1d6, sunI: 0.78, hemi: [0xcfe8ff, 0x6c7a4a], hemiI: 0.42,
      ground: [0x6f9a3e, 0x86ad4c, 0x5c8636], roadCol: '#b8987a', rutCol: '#8c7457', shoulder: 0x9b8058,
      trees: { pine: 0.6, round: 0.4, count: 1900, pineCol: [0x5f8a52, 0x77a061], roundCol: [0x9bb86a, 0xb2c77d] },
      snowFall: false, water: false,
    },
    {
      id: 'cape', name: 'Sunset Cape', jp: '夕焼け岬', desc: 'Coastal tarmac at golden hour. Grippy, fast, sea views.',
      seed: 29, radius: 330, wobble: 0.32, nPts: 13, hills: 26,
      road: AR.SURF.TARMAC, off: AR.SURF.SAND, width: 12,
      sky: [0x5b4fb8, 0xffb070], fog: 0xffc79a, fogNear: 200, fogFar: 950,
      sun: 0xffc48a, sunI: 0.85, hemi: [0xffd6b0, 0x5a4a6a], hemiI: 0.42,
      ground: [0xd6b98a, 0xc9a978, 0xa8b064], roadCol: '#4a4a55', rutCol: '#3c3c46', shoulder: 0xc7ab7c,
      trees: { pine: 0.15, round: 0.85, count: 1100, pineCol: [0x4f7a5a, 0x5f8a62], roundCol: [0x6fa060, 0x9cbf6a] },
      snowFall: false, water: true,
    },
    {
      id: 'yuki', name: 'Yuki Pass', jp: '雪の峠', desc: 'Packed snow mountain pass. Low grip, big slides, falling snow.',
      seed: 47, radius: 280, wobble: 0.42, nPts: 16, hills: 30,
      road: AR.SURF.SNOW, off: AR.SURF.SNOW, width: 11,
      sky: [0x6f8fc0, 0xe6eef8], fog: 0xe3ebf5, fogNear: 120, fogFar: 700,
      sun: 0xf3f6ff, sunI: 0.62, hemi: [0xe8f0ff, 0x8090a8], hemiI: 0.48,
      ground: [0xf2f6fb, 0xe4ecf6, 0xd6e0ee], roadCol: '#dfe7f2', rutCol: '#b7c4d8', shoulder: 0xe8eef6,
      trees: { pine: 0.9, round: 0.1, count: 1700, pineCol: [0x3f6a5a, 0x4f7a68], roundCol: [0x8aa0a0, 0x9ab0b0] },
      snowFall: true, water: false,
    },
  ];

  const GATES = 20;

  AR.buildStage = function (stage, scene) {
    const rnd = AR.rng(stage.seed);
    const noise = AR.makeNoise(stage.seed * 3 + 1);
    const group = new THREE.Group();
    scene.add(group);

    // ---------- centre line ----------
    const ctrl = [];
    for (let i = 0; i < stage.nPts; i++) {
      const a = (i / stage.nPts) * Math.PI * 2;
      const r = stage.radius * (1 + (rnd() * 2 - 1) * stage.wobble);
      ctrl.push(new THREE.Vector3(Math.cos(a) * r * 1.15, 0, Math.sin(a) * r));
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    const length = curve.getLength();
    const N = Math.floor(length / 2);
    const ds = length / N;
    const P = [], T = [], Nr = [];
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u).setY(0).normalize();
      P.push(p);
      T.push(t);
      Nr.push(new THREE.Vector3(-t.z, 0, t.x)); // right-hand normal (x,z)
    }
    // curvature (signed, + = turning right)
    const curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = T[(i - 3 + N) % N], b = T[(i + 3) % N];
      const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
      curv[i] = ang / (6 * ds);
    }
    const sm = (arr, w) => {
      const o = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let k = -w; k <= w; k++) s += arr[(i + k + N) % N];
        o[i] = s / (2 * w + 1);
      }
      return o;
    };
    const curvS = sm(curv, 6);
    // terrain + smoothed road heights
    const terrainH = (x, z) =>
      noise.fbm(x / 260, z / 260, 4) * stage.hills + noise.fbm(x / 70 + 9, z / 70 - 3, 3) * stage.hills * 0.18;
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) raw[i] = terrainH(P[i].x, P[i].z);
    let hc = sm(raw, 18);
    hc = sm(hc, 12);
    // banking: lean into corners (outer edge higher), capped at ~13°
    const bank = new Float32Array(N);
    for (let i = 0; i < N; i++) bank[i] = AR.clamp(curvS[i] * 9.0, -0.23, 0.23);
    const bankS = sm(bank, 8);
    for (let i = 0; i < N; i++) P[i].y = hc[i];

    // ---------- spatial index of centre samples ----------
    const CELL = 32;
    const grid = new Map();
    const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    for (let i = 0; i < N; i++) {
      const k = key(Math.floor(P[i].x / CELL), Math.floor(P[i].z / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    function nearest(x, z) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let best = -1, bd = Infinity;
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const l = grid.get(key(cx + a, cz + b));
          if (!l) continue;
          for (let j = 0; j < l.length; j++) {
            const p = P[l[j]];
            const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
            if (d < bd) { bd = d; best = l[j]; }
          }
        }
      return best;
    }
    // Project onto the local segment for a continuous lateral offset & interpolated attributes.
    function project(x, z, hint) {
      const i = hint != null ? hint : nearest(x, z);
      if (i < 0) return null;
      const p = P[i], t = T[i];
      const dx = x - p.x, dz = z - p.z;
      const along = dx * t.x + dz * t.z;
      const j = along >= 0 ? (i + 1) % N : (i - 1 + N) % N;
      const f = AR.clamp(Math.abs(along) / ds, 0, 1);
      const lat = dx * Nr[i].x + dz * Nr[i].z;
      return {
        i, f, j, lat,
        h: AR.lerp(hc[i], hc[j], f),
        bank: AR.lerp(bankS[i], bankS[j], f),
        s: i * ds + along,
      };
    }
    const halfRoad = stage.width / 2;
    // ---------- bake heightfield ----------
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    P.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); });
    const margin = 170;
    minX -= margin; minZ -= margin; maxX += margin; maxZ += margin;
    const cs = 2.5;
    const GX = Math.ceil((maxX - minX) / cs) + 1, GZ = Math.ceil((maxZ - minZ) / cs) + 1;
    const H = new Float32Array(GX * GZ);
    const S = new Uint8Array(GX * GZ);
    const roadW = new Float32Array(GX * GZ); // 0..1 road/shoulder blend for colouring
    for (let gz = 0; gz < GZ; gz++) {
      for (let gx = 0; gx < GX; gx++) {
        const x = minX + gx * cs, z = minZ + gz * cs;
        const idx = gz * GX + gx;
        let h = terrainH(x, z);
        const pr = project(x, z);
        let surf = stage.off;
        if (pr) {
          const ad = Math.abs(pr.lat);
          // banked plane: right side (lat>0) height change = lat * tan(bank) where + bank raises the outer side
          const roadH = pr.h + pr.lat * Math.tan(pr.bank) * -1;
          const w = AR.smoothstep(halfRoad + 2.0, halfRoad + 22, ad);
          // slight ditch beyond the shoulder for that hardpack look
          const ditch = -0.45 * AR.smoothstep(halfRoad + 1.5, halfRoad + 4, ad) * (1 - AR.smoothstep(halfRoad + 5, halfRoad + 10, ad));
          h = AR.lerp(roadH + ditch, h, w);
          if (ad < halfRoad + 0.6) surf = stage.road;
          roadW[idx] = 1 - AR.smoothstep(halfRoad - 0.5, halfRoad + 3.5, ad);
        }
        H[idx] = h;
        S[idx] = surf;
      }
    }
    function groundRaw(x, z) {
      let fx = (x - minX) / cs, fz = (z - minZ) / cs;
      if (fx < 0 || fz < 0 || fx >= GX - 1 || fz >= GZ - 1) return { h: terrainH(x, z), surf: stage.off, out: true };
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const tx = fx - ix, tz = fz - iz;
      const i00 = iz * GX + ix;
      const h00 = H[i00], h10 = H[i00 + 1], h01 = H[i00 + GX], h11 = H[i00 + GX + 1];
      const h = h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
      const sIdx = (tz < 0.5 ? iz : iz + 1) * GX + (tx < 0.5 ? ix : ix + 1);
      return { h, surf: S[sIdx], tx, tz, h00, h10, h01, h11 };
    }
    // Ground query used by physics: height + normal + surface type.
    const _n = new THREE.Vector3();
    function ground(x, z, out) {
      const g = groundRaw(x, z);
      out = out || {};
      out.h = g.h;
      out.surf = g.surf;
      if (g.out) {
        out.n = _n.set(0, 1, 0);
        return out;
      }
      const dhdx = ((g.h10 - g.h00) * (1 - g.tz) + (g.h11 - g.h01) * g.tz) / cs;
      const dhdz = ((g.h01 - g.h00) * (1 - g.tx) + (g.h11 - g.h10) * g.tx) / cs;
      out.n = (out.n || new THREE.Vector3()).set(-dhdx, 1, -dhdz).normalize();
      return out;
    }

    // ---------- terrain mesh (vertex coloured toon) ----------
    {
      const geo = new THREE.PlaneGeometry((GX - 1) * cs, (GZ - 1) * cs, GX - 1, GZ - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      const c0 = new THREE.Color(stage.ground[0]), c1 = new THREE.Color(stage.ground[1]), c2 = new THREE.Color(stage.ground[2]);
      const sh = new THREE.Color(stage.shoulder);
      const tmp = new THREE.Color();
      // PlaneGeometry after rotation: rows go from -z to +z? vertices ordered by row (y→-z), columns x
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + (minX + ((GX - 1) * cs) / 2);
        const z = pos.getZ(i) + (minZ + ((GZ - 1) * cs) / 2);
        const gx = Math.round((x - minX) / cs), gz = Math.round((z - minZ) / cs);
        const idx = gz * GX + gx;
        pos.setXYZ(i, x, H[idx] - 0.02, z);
        const n1 = noise(x / 22, z / 22) * 0.5 + 0.5;
        const n2 = noise(x / 6 + 40, z / 6) * 0.5 + 0.5;
        tmp.copy(c0).lerp(c1, AR.smoothstep(0.35, 0.65, n1)).lerp(c2, AR.smoothstep(0.55, 0.8, n2) * 0.6);
        tmp.lerp(sh, roadW[idx] * 0.95);
        col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, AR.toonMat(0xffffff, { vertexColors: true, gradient: 'soft' }));
      m.receiveShadow = true;
      group.add(m);
    }

    // ---------- road ribbon ----------
    {
      const across = 8;
      const verts = [], uvs = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        for (let a = 0; a <= across; a++) {
          const l = (a / across - 0.5) * (stage.width + 1.2);
          const x = P[k].x + Nr[k].x * l, z = P[k].z + Nr[k].z * l;
          verts.push(x, groundRaw(x, z).h + 0.03, z);
          uvs.push(a / across, (i * ds) / 24);
        }
      }
      for (let i = 0; i < N; i++)
        for (let a = 0; a < across; a++) {
          const r0 = i * (across + 1) + a, r1 = (i + 1) * (across + 1) + a;
          idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1); // CCW from above
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const tex = roadTexture(stage);
      const m = new THREE.Mesh(geo, AR.toonMat(0xffffff, { map: tex, gradient: 'soft' }));
      m.receiveShadow = true;
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -2;
      group.add(m);
    }

    // sea level sits safely below the lowest point of the road
    let waterY = -1e9;
    if (stage.water) {
      let lo = Infinity;
      for (let i = 0; i < N; i++) lo = Math.min(lo, hc[i]);
      waterY = lo - 3.5;
    }

    // ---------- trees (instanced, inked) ----------
    const treeColliders = new Map();
    const TCELL = 8;
    const tkey = (cx, cz) => cx * 92837111 ^ cz * 689287499;
    {
      const pineTrunk = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6).translate(0, 1.6, 0);
      const pineFol = mergeCones();
      const roundTrunk = new THREE.CylinderGeometry(0.25, 0.4, 4.2, 6).translate(0, 2.1, 0);
      const roundFol = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.6, 0);
      const counts = { pine: Math.floor(stage.trees.count * stage.trees.pine), round: Math.floor(stage.trees.count * stage.trees.round) };
      const placed = { pine: [], round: [] };
      let tries = 0;
      ['pine', 'round'].forEach((kind) => {
        while (placed[kind].length < counts[kind] && tries < 60000) {
          tries++;
          // cluster trees near the road for a forest corridor, plus scattered far trees
          let x, z;
          if (rnd() < 0.7) {
            const i = Math.floor(rnd() * N);
            const side = rnd() < 0.5 ? -1 : 1;
            const d = halfRoad + 7 + Math.pow(rnd(), 1.6) * 70;
            x = P[i].x + Nr[i].x * d * side + (rnd() - 0.5) * 6;
            z = P[i].z + Nr[i].z * d * side + (rnd() - 0.5) * 6;
          } else {
            x = minX + rnd() * (maxX - minX);
            z = minZ + rnd() * (maxZ - minZ);
          }
          const pr = project(x, z);
          if (pr && Math.abs(pr.lat) < halfRoad + 6) continue;
          if (groundRaw(x, z).h < waterY + 0.5) continue;
          const s = 0.75 + rnd() * 0.7;
          placed[kind].push([x, groundRaw(x, z).h - 0.1, z, s, rnd() * Math.PI * 2, rnd()]);
        }
      });
      const mk = (geo, mat, list, thick, colorFn) => {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        AR.ensureOutlineNormals(geo);
        const om = new THREE.InstancedMesh(geo, AR.outlineMat(thick), list.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
        const col = new THREE.Color();
        list.forEach((t, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[4]);
          sc.set(t[3], t[3] * (0.9 + t[5] * 0.3), t[3]);
          ps.set(t[0], t[1], t[2]);
          m4.compose(ps, q, sc);
          im.setMatrixAt(i, m4);
          om.setMatrixAt(i, m4);
          if (colorFn) { colorFn(t, col); im.setColorAt(i, col); }
        });
        im.castShadow = true;
        im.receiveShadow = true;
        group.add(im);
        group.add(om);
      };
      const trunkMat = AR.toonMat(stage.id === 'yuki' ? 0x5a4a44 : 0x6b4a33);
      const folMat = AR.toonMat(0xffffff, { rim: 0.25 });
      const pc0 = new THREE.Color(stage.trees.pineCol[0]), pc1 = new THREE.Color(stage.trees.pineCol[1]);
      const rc0 = new THREE.Color(stage.trees.roundCol[0]), rc1 = new THREE.Color(stage.trees.roundCol[1]);
      mk(pineTrunk, trunkMat, placed.pine, 0.08);
      mk(pineFol, folMat, placed.pine, 0.12, (t, c) => c.copy(pc0).lerp(pc1, t[5]));
      mk(roundTrunk, trunkMat, placed.round, 0.08);
      mk(roundFol, folMat.clone(), placed.round, 0.14, (t, c) => c.copy(rc0).lerp(rc1, t[5]));
      if (stage.id === 'yuki') {
        // snow caps on pines
        const cap = new THREE.ConeGeometry(1.25, 1.6, 7).translate(0, 7.2, 0);
        mk(cap, AR.toonMat(0xffffff), placed.pine, 0.06);
      }
      // colliders (trunks)
      placed.pine.concat(placed.round).forEach((t) => {
        const k = tkey(Math.floor(t[0] / TCELL), Math.floor(t[2] / TCELL));
        if (!treeColliders.has(k)) treeColliders.set(k, []);
        treeColliders.get(k).push({ x: t[0], z: t[2], r: 0.35 * t[3] + 0.1, kind: 'tree' });
      });
    }
    // rigid rocks and knock-down props share the tree grid
    function addCollider(c) {
      const k = tkey(Math.floor(c.x / TCELL), Math.floor(c.z / TCELL));
      if (!treeColliders.has(k)) treeColliders.set(k, []);
      treeColliders.get(k).push(c);
    }
    function treesNear(x, z, out) {
      out.length = 0;
      const cx = Math.floor(x / TCELL), cz = Math.floor(z / TCELL);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++) {
          const l = treeColliders.get(tkey(cx + a, cz + b));
          if (l) for (let i = 0; i < l.length; i++) out.push(l[i]);
        }
      return out;
    }

    // ---------- rocks ----------
    {
      const rg = new THREE.DodecahedronGeometry(1, 0);
      const list = [];
      for (let k = 0; k < 160; k++) {
        const i = Math.floor(rnd() * N), side = rnd() < 0.5 ? -1 : 1;
        const d = halfRoad + 4 + rnd() * 30;
        const x = P[i].x + Nr[i].x * d * side, z = P[i].z + Nr[i].z * d * side;
        const s = 0.4 + rnd() * 1.1;
        list.push([x, groundRaw(x, z).h, z, s, rnd() * 6]);
        if (s > 0.6) addCollider({ x, z, r: s * 0.8, kind: 'rock' });
      }
      const im = new THREE.InstancedMesh(rg, AR.toonMat(stage.id === 'yuki' ? 0x9aa6b8 : 0x8f8a80), list.length);
      AR.ensureOutlineNormals(rg);
      const om = new THREE.InstancedMesh(rg, AR.outlineMat(0.08), list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((r, i) => {
        m4.makeRotationY(r[4]).scale(new THREE.Vector3(r[3], r[3] * 0.7, r[3])).setPosition(r[0], r[1], r[2]);
        im.setMatrixAt(i, m4);
        om.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      group.add(im, om);
    }

    // ---------- chevrons on the outside of tight corners, marker posts ----------
    {
      const chevTex = chevronTexture();
      const chevMat = AR.toonMat(0xffffff, { map: chevTex, hatch: false });
      const postMat = AR.toonMat(0x3a3a40);
      const markerMat = AR.toonMat(0xffffff);
      const markerTop = AR.toonMat(0x2f6fd6);
      for (let i = 0; i < N; i += 7) {
        const c = curvS[i];
        if (Math.abs(c) > 0.012) {
          // outer side: turning right (c>0) → outer is left (lat<0)
          const side = c > 0 ? -1 : 1;
          const d = halfRoad + 3.2;
          const x = P[i].x + Nr[i].x * d * side, z = P[i].z + Nr[i].z * d * side;
          const g = new THREE.Group();
          const board = AR.inked(new THREE.BoxGeometry(1.1, 0.8, 0.06), [postMat, postMat, postMat, postMat, chevMat, chevMat], 0.04, g);
          board.position.y = 1.4;
          if (c < 0) board.scale.x = -1;
          const post = AR.inked(new THREE.BoxGeometry(0.1, 1.4, 0.1), postMat, 0.03, g);
          post.position.y = 0.7;
          g.position.set(x, groundRaw(x, z).h, z);
          g.lookAt(P[i].x - T[i].x * 30, g.position.y, P[i].z - T[i].z * 30);
          group.add(g);
          addCollider({ x, z, r: 0.35, kind: 'prop', obj: g, broken: false });
        }
        if (i % 21 === 0) {
          [-1, 1].forEach((side) => {
            const d = halfRoad + 1.6;
            const x = P[i].x + Nr[i].x * d * side, z = P[i].z + Nr[i].z * d * side;
            const g = new THREE.Group();
            AR.inked(new THREE.BoxGeometry(0.16, 1.1, 0.16), markerMat, 0.03, g).position.y = 0.55;
            AR.inked(new THREE.BoxGeometry(0.17, 0.3, 0.17), markerTop, 0, g).position.y = 0.95;
            g.position.set(x, groundRaw(x, z).h, z);
            group.add(g);
            addCollider({ x, z, r: 0.15, kind: 'prop', obj: g, broken: false });
          });
        }
      }
    }

    // ---------- gates ----------
    const gates = [];
    {
      // finish sits 60 m before the start line so the two banners never overlap
      const gateLen = (length - 60) / GATES;
      for (let g = 1; g <= GATES; g++) {
        const s = g * gateLen;
        const i = Math.round(s / ds) % N;
        const obj = makeGate(g === GATES ? 'FINISH' : String(g), g === GATES);
        const half = halfRoad + 1.4;
        obj.position.set(P[i].x, hc[i], P[i].z);
        obj.lookAt(P[i].x + T[i].x, hc[i], P[i].z + T[i].z);
        obj.userData.half = half;
        group.add(obj);
        gates.push({ s: g * gateLen, i, obj });
      }
    }

    // ---------- sky, sun, clouds, water, mountains ----------
    const sky = makeSky(stage);
    group.add(sky);
    const clouds = makeClouds(stage, rnd);
    group.add(clouds);
    if (stage.water) {
      const wm = new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
        AR.toonMat(0x3c7fbf, { rim: 0.5, spec: 0.5, hatch: false })
      );
      wm.position.y = waterY;
      group.add(wm);
    }
    {
      // ring of stylised mountains
      const mg = new THREE.ConeGeometry(1, 1, 6);
      AR.ensureOutlineNormals(mg);
      const list = [];
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const R = Math.max(maxX - minX, maxZ - minZ) * 0.75 + 200;
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
        const r = R + rnd() * 250;
        list.push([cx + Math.cos(a) * r, -20, cz + Math.sin(a) * r, 120 + rnd() * 160, 90 + rnd() * 160]);
      }
      const col = stage.id === 'yuki' ? 0xcfdaea : stage.id === 'cape' ? 0x8a6aa8 : 0x6f9ab8;
      const im = new THREE.InstancedMesh(mg, AR.toonMat(col, { hatch: false }), list.length);
      const om = new THREE.InstancedMesh(mg, AR.outlineMat(0.012), list.length);
      const capM = new THREE.InstancedMesh(mg, AR.toonMat(0xffffff, { hatch: false }), list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((m, i) => {
        m4.makeScale(m[3], m[4], m[3]).setPosition(m[0], m[1] + m[4] / 2, m[2]);
        im.setMatrixAt(i, m4);
        om.setMatrixAt(i, m4);
        m4.makeScale(m[3] * 0.3, m[4] * 0.3, m[3] * 0.3).setPosition(m[0], m[1] + m[4] * 0.85 + 1, m[2]);
        capM.setMatrixAt(i, m4);
      });
      group.add(im, om, capM);
    }

    // start/finish banner
    {
      const start = makeGate('START', true);
      start.position.set(P[0].x, hc[0], P[0].z);
      start.lookAt(P[0].x + T[0].x, hc[0], P[0].z + T[0].z);
      start.userData.isStart = true;
      group.add(start);
    }

    const stageObj = {
      def: stage, group, length, N, ds, P, T, Nr, hc, bank: bankS, curv: curvS, gates, halfRoad,
      ground, groundRaw, project, nearest, treesNear, sky, clouds,
      bounds: { minX, maxX, minZ, maxZ },
      startPose(backOff) {
        const i = (N - Math.round((backOff || 14) / ds)) % N;
        const p = P[i];
        return { pos: new THREE.Vector3(p.x, groundRaw(p.x, p.z).h, p.z), dir: T[i].clone(), i };
      },
      poseAt(i) {
        i = ((i % N) + N) % N;
        const p = P[i];
        return { pos: new THREE.Vector3(p.x, groundRaw(p.x, p.z).h, p.z), dir: T[i].clone(), i };
      },
      dispose() {
        scene.remove(group);
        group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
      },
    };
    return stageObj;
  };

  // ---------- helpers ----------
  function mergeCones() {
    // three stacked cones like the reference's low-poly pines
    const parts = [
      new THREE.ConeGeometry(2.0, 3.0, 7).translate(0, 3.6, 0),
      new THREE.ConeGeometry(1.6, 2.6, 7).translate(0, 5.0, 0),
      new THREE.ConeGeometry(1.1, 2.2, 7).translate(0, 6.4, 0),
    ];
    const pos = [], nor = [];
    parts.forEach((g) => {
      const ng = g.toNonIndexed();
      pos.push(...ng.attributes.position.array);
      nor.push(...ng.attributes.normal.array);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return geo;
  }

  function roadTexture(stage) {
    const c = AR.canvas(256, 512), g = c.getContext('2d');
    g.fillStyle = stage.roadCol;
    g.fillRect(0, 0, 256, 512);
    const r = AR.rng(stage.seed + 5);
    // speckle grain
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
      const s = 1 + r() * 3;
      g.fillRect(r() * 256, r() * 512, s, s);
    }
    if (stage.road === AR.SURF.TARMAC) {
      g.fillStyle = '#f0ece0';
      g.fillRect(14, 0, 6, 512);
      g.fillRect(236, 0, 6, 512);
      g.fillStyle = '#f2c230';
      for (let y = 0; y < 512; y += 128) g.fillRect(124, y, 8, 70);
    } else {
      // twin ruts like the reference's hardpack tyre grooves
      g.strokeStyle = stage.rutCol;
      [70, 102, 154, 186].forEach((x) => {
        g.lineWidth = 9 + r() * 4;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.0123 * Math.PI) * 3, y);
        g.stroke();
      });
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, 0, 10, 512);
      g.fillRect(246, 0, 10, 512);
    }
    const t = AR.canvasTex(c, { repeat: true });
    return t;
  }

  function chevronTexture() {
    const c = AR.canvas(128, 96), g = c.getContext('2d');
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#16161a';
    g.beginPath();
    g.moveTo(34, 10); g.lineTo(66, 10); g.lineTo(98, 48); g.lineTo(66, 86); g.lineTo(34, 86); g.lineTo(66, 48);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#16161a';
    g.strokeRect(3, 3, 122, 90);
    return AR.canvasTex(c);
  }

  function makeGate(label, special) {
    const g = new THREE.Group();
    const poleMat = AR.toonMat(special ? 0xffffff : 0xf2c230);
    const half = 6.9;
    [-1, 1].forEach((s) => {
      const p = AR.inked(new THREE.CylinderGeometry(0.16, 0.2, 5.2, 8), poleMat, 0.05, g);
      p.position.set(s * half, 2.6, 0);
      const base = AR.inked(new THREE.BoxGeometry(0.7, 0.4, 0.7), AR.toonMat(0x2a2b31), 0.04, g);
      base.position.set(s * half, 0.2, 0);
    });
    const c = AR.canvas(512, 96), x = c.getContext('2d');
    x.fillStyle = special ? '#16161a' : '#ffffff';
    x.fillRect(0, 0, 512, 96);
    // checker edge
    for (let i = 0; i < 32; i++) {
      x.fillStyle = i % 2 ? '#16161a' : '#f2c230';
      x.fillRect(i * 16, 0, 16, 10);
      x.fillRect(i * 16 + 8 * ((i + 1) % 2), 86, 16, 10);
    }
    x.fillStyle = special ? '#f2c230' : '#16161a';
    x.font = 'bold 54px Bangers, Impact, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(special ? label : 'GATE ' + label, 256, 50);
    const tex = AR.canvasTex(c);
    const bm = AR.toonMat(0xffffff, { map: tex, hatch: false, side: THREE.DoubleSide });
    const banner = AR.inked(new THREE.BoxGeometry(half * 2 + 0.4, 1.1, 0.12), [AR.toonMat(0x16161a), AR.toonMat(0x16161a), AR.toonMat(0x16161a), AR.toonMat(0x16161a), bm, bm], 0.05, g);
    banner.position.y = 5.0;
    // glowing ring marker used to highlight the next gate
    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.12, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x7cf0d0, transparent: true, opacity: 0.9 })
    );
    glow.position.y = 6.2;
    glow.visible = false;
    g.add(glow);
    g.userData.glow = glow;
    g.userData.banner = banner;
    return g;
  }

  function makeSky(stage) {
    const geo = new THREE.SphereGeometry(2600, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(stage.sky[0]) },
        bottom: { value: new THREE.Color(stage.sky[1]) },
        sunDir: { value: new THREE.Vector3(0.4, 0.55, -0.7).normalize() },
        sunCol: { value: new THREE.Color(stage.sun) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vP;',
        'void main(){',
        '  float h = clamp(vP.y * 1.6 + 0.08, 0.0, 1.0);',
        // banded anime sky: quantise the gradient a little
        '  float hb = floor(h * 7.0) / 7.0;',
        '  vec3 c = mix(bottom, top, mix(h, hb, 0.55));',
        '  float d = dot(normalize(vP), sunDir);',
        '  c = mix(c, vec3(1.0), smoothstep(0.9965, 0.9975, d));',
        '  c += sunCol * smoothstep(0.96, 0.995, d) * 0.25;',
        '  float ring = smoothstep(0.985, 0.986, d) - smoothstep(0.987, 0.988, d);',
        '  c += vec3(ring * 0.25);',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <encodings_fragment>',
        '}',
      ].join('\n'),
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -10;
    m.frustumCulled = false;
    return m;
  }

  function cloudTexture(seed) {
    const c = AR.canvas(256, 128), g = c.getContext('2d');
    const r = AR.rng(seed);
    const blobs = [];
    for (let i = 0; i < 7; i++) blobs.push([40 + r() * 176, 70 + (r() - 0.5) * 24, 22 + r() * 30]);
    // ink outline pass
    g.fillStyle = 'rgba(60,70,110,0.9)';
    blobs.forEach((b) => { g.beginPath(); g.arc(b[0], b[1], b[2] + 3, 0, Math.PI * 2); g.fill(); });
    g.fillRect(30, 80, 196, 26);
    // shadow tone
    g.fillStyle = '#c9d6ee';
    blobs.forEach((b) => { g.beginPath(); g.arc(b[0], b[1], b[2], 0, Math.PI * 2); g.fill(); });
    g.fillRect(33, 80, 190, 23);
    // light tone
    g.fillStyle = '#ffffff';
    blobs.forEach((b) => { g.beginPath(); g.arc(b[0] - 4, b[1] - 6, b[2] * 0.82, 0, Math.PI * 2); g.fill(); });
    return AR.canvasTex(c);
  }
  function makeClouds(stage, rnd) {
    const grp = new THREE.Group();
    const texs = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, r = 900 + rnd() * 900;
      const mat = new THREE.SpriteMaterial({ map: texs[i % 3], fog: false, depthWrite: false, transparent: true });
      if (stage.id === 'cape') mat.color.set(0xffd2b8);
      const s = new THREE.Sprite(mat);
      s.position.set(Math.cos(a) * r, 180 + rnd() * 260, Math.sin(a) * r);
      const w = 260 + rnd() * 260;
      s.scale.set(w, w / 2, 1);
      grp.add(s);
    }
    return grp;
  }
})();
