// The shop: palette, materials, procedural textures and shape helpers for the SP-1200 Modern.
// Everything random comes from a seeded rng, so the object builds identically every time.
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {rng} from 'cutaway-kit/util.js';

export const PAL = {
  shell: 0x3d4045, // chassis: mid grey powder coat (front face and rim)
  panel: '#232528', // inset top panel
  rim: '#4a4d52', // top rim around it
  orange: '#e8732c',
  ink: '#d9d4cc',
  dim: '#8d8a85',
  pads: [0x8a5cff, 0x2ee6c8, 0x4a7dff, 0xff5fa8, 0x3cc8ff, 0xb05cff, 0xff6fd8, 0x5cff8f, 0x9d6bff],
  leds: [0xff3b4b, 0xff4fa3, 0x5cff7a, 0xf6ff4a, 0xff7a2e],
};

export const R = rng(1200);

export function canvasTex(w, h, draw, {srgb = true, repeat = null} = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.userData.canvas = c;
  return t;
}

// ---------- textures ----------
const brushed = canvasTex(1024, 256, (g, w, h) => {
  g.fillStyle = '#9a9894';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const y = R() * h;
    const v = (120 + R() * 110) | 0;
    g.strokeStyle = `rgba(${v},${v},${v - 6},${0.08 + R() * 0.18})`;
    g.lineWidth = R() * 1.4;
    g.beginPath();
    g.moveTo(R() * w * 0.3 - 100, y);
    g.lineTo(w + 100, y + (R() - 0.5) * 2);
    g.stroke();
  }
});
const grille = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#24252a';
  g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8)
    for (let x = ((y / 8) % 2) * 4; x < w; x += 8) {
      g.fillStyle = '#060606';
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
}, {repeat: [4, 2]});
const speckle = canvasTex(512, 512, (g, w, h) => {
  const d = g.createImageData(w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 150 + R() * 60;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
}, {srgb: false, repeat: [4, 4]});
const pcb = canvasTex(1024, 1024, (g, w, h) => {
  g.fillStyle = '#0d1f17';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    // copper traces in 45° runs
    g.strokeStyle = `rgba(190,150,70,${0.25 + R() * 0.35})`;
    g.lineWidth = 1 + R() * 2;
    let x = R() * w;
    let y = R() * h;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      const d = 20 + R() * 120;
      const k = (R() * 4) | 0;
      x += [d, 0, d, -d][k];
      y += [0, d, d, d][k];
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = 'rgba(210,180,100,0.7)';
    g.beginPath();
    g.arc(R() * w, R() * h, 2.2, 0, Math.PI * 2);
    g.fill();
  }
});

// ---------- materials ----------
export const M = {
  shell: new THREE.MeshPhysicalMaterial({color: PAL.shell, roughness: 0.58, metalness: 0.3, roughnessMap: speckle, clearcoat: 0.12, clearcoatRoughness: 0.6}),
  shellIn: new THREE.MeshStandardMaterial({color: 0x2a2b2e, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide}),
  dark: new THREE.MeshStandardMaterial({color: 0x232427, roughness: 0.6, metalness: 0.3}),
  alu: new THREE.MeshStandardMaterial({color: 0xcfc9bf, map: brushed, roughness: 0.34, metalness: 1.0}),
  chrome: new THREE.MeshStandardMaterial({color: 0xe6e6e6, roughness: 0.14, metalness: 1.0}),
  satin: new THREE.MeshStandardMaterial({color: 0xbcbcbc, roughness: 0.35, metalness: 1.0, map: brushed}),
  rubber: new THREE.MeshStandardMaterial({color: 0x1d1e21, roughness: 0.78}),
  pad: new THREE.MeshPhysicalMaterial({color: 0x1a1b1e, roughness: 0.68, sheen: 0.4, sheenColor: new THREE.Color(0x3a3a3a)}),
  black: new THREE.MeshStandardMaterial({color: 0x09090b, roughness: 0.5, metalness: 0.2}),
  hole: new THREE.MeshBasicMaterial({color: 0x000000}),
  gloss: new THREE.MeshPhysicalMaterial({color: 0x060607, roughness: 0.1, clearcoat: 1}),
  knob: new THREE.MeshStandardMaterial({color: 0x1b1b1d, roughness: 0.45, metalness: 0.45}),
  white: new THREE.MeshStandardMaterial({color: 0xeeeae2, roughness: 0.4}),
  grille: new THREE.MeshStandardMaterial({color: 0xffffff, map: grille, roughness: 0.75, metalness: 0.35}),
  cable: new THREE.MeshStandardMaterial({color: 0x161616, roughness: 0.55}),
  cableRed: new THREE.MeshStandardMaterial({color: 0x5c1517, roughness: 0.5}),
  braid: new THREE.MeshStandardMaterial({color: 0x2c2c2e, roughness: 0.9}),
  usb: new THREE.MeshStandardMaterial({color: 0x1e64ff, roughness: 0.4, emissive: 0x0a2aff, emissiveIntensity: 0.3}),
  pcb: new THREE.MeshStandardMaterial({map: pcb, roughness: 0.55, metalness: 0.2}),
  chip: new THREE.MeshStandardMaterial({color: 0x111113, roughness: 0.42, metalness: 0.2}),
  gold: new THREE.MeshStandardMaterial({color: 0xd4a640, roughness: 0.28, metalness: 1}),
  copper: new THREE.MeshStandardMaterial({color: 0xb8673a, roughness: 0.35, metalness: 1}),
  cap: new THREE.MeshStandardMaterial({color: 0x1f3d8a, roughness: 0.4, metalness: 0.3}),
  ribbon: new THREE.MeshStandardMaterial({color: 0x9a9da3, roughness: 0.6, side: THREE.DoubleSide}),
  heatsink: new THREE.MeshStandardMaterial({color: 0x3a3c40, roughness: 0.4, metalness: 0.9}),
};
export const led = (hex, i = 2.5) =>
  new THREE.MeshStandardMaterial({color: hex, emissive: hex, emissiveIntensity: i, roughness: 0.3, toneMapped: false});

// ---------- shape helpers ----------
export const rbox = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
export const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = null) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
};

/** A knurled cylinder: radius modulated by |cos| so ridges read crisply. */
export function knurled(r, h, ridges = 32) {
  const g = new THREE.CylinderGeometry(r, r * 1.04, h, ridges * 4, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (Math.hypot(v.x, v.z) < 1e-4) continue;
    const a = Math.atan2(v.z, v.x);
    const k = 1 + 0.045 * Math.abs(Math.cos((a * ridges) / 2)) ** 0.6;
    p.setXYZ(i, v.x * k, v.y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Many copies of one geometry from a list of [x,y,z,(sx,sy,sz),(ry)]. */
export function instances(geo, mat, list) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  list.forEach(([x, y, z, sx = 1, sy = 1, sz = 1, ry = 0], i) => {
    q.setFromEuler(e.set(0, ry, 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    im.setMatrixAt(i, m);
  });
  im.castShadow = im.receiveShadow = true;
  return im;
}
