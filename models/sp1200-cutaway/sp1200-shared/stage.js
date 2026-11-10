// The studio: a worn wooden desk, warm window key light, props from the reference, bloom.
// frame(cam) draws one frame from a camera given as {az, el, dist, fov, target:[x,y,z], sx, sy}.
import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {M, R, canvasTex, instances, mesh, rbox} from './parts.js';

export function createStage({canvas}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance'});
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15110e);
  scene.fog = new THREE.Fog(0x15110e, 78, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 260);

  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x2a1d14, 0.2));
  const key = new THREE.DirectionalLight(0xffe2c0, 1.35);
  key.position.set(-5, 10, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30});
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa9c8ff, 0.7);
  rim.position.set(8, 5, -6);
  scene.add(rim);

  buildDesk(scene);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.3, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const size = {w: 1600, h: 900};
  const resize = (w, h, pr) => {
    size.w = w;
    size.h = h;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const tgt = new THREE.Vector3();
  const place = (c) => {
    const az = c.az, el = c.el;
    tgt.set(...c.target);
    camera.fov = c.fov;
    camera.position.set(tgt.x + c.dist * Math.sin(az) * Math.cos(el), tgt.y + c.dist * Math.sin(el), tgt.z + c.dist * Math.cos(az) * Math.cos(el));
    camera.up.set(0, 1, 0);
    camera.lookAt(tgt);
    // screen shift (fractions of the frame) without changing perspective
    camera.setViewOffset(size.w, size.h, -(c.sx ?? 0) * size.w, -(c.sy ?? 0) * size.h, size.w, size.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  const v = new THREE.Vector3();
  const project = (p) => {
    v.copy(p).project(camera);
    return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h];
  };
  return {renderer, scene, camera, composer, bloom, resize, place, project, frame: (c) => (place(c), composer.render())};
}

function buildDesk(scene) {
  const wood = canvasTex(2048, 1024, (g, w, h) => {
    const planks = 5, ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const y0 = p * ph;
      g.fillStyle = `hsl(${22 + R() * 6},48%,${17 + R() * 7}%)`;
      g.fillRect(0, y0, w, ph);
      for (let i = 0; i < 260; i++) {
        const y = y0 + R() * ph, a = 0.04 + R() * 0.1, amp = 2 + R() * 8, f = 0.002 + R() * 0.006, p0 = R() * 6;
        g.strokeStyle = R() > 0.5 ? `rgba(20,10,4,${a})` : `rgba(255,210,160,${a * 0.6})`;
        g.lineWidth = 0.6 + R() * 1.8;
        g.beginPath();
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * f + p0) * amp);
        g.stroke();
      }
      for (let k = 0; k < 2; k++) {
        const kx = R() * w, ky = y0 + ph * (0.3 + R() * 0.4);
        for (let r = 26; r > 2; r -= 3) {
          g.strokeStyle = 'rgba(30,14,5,0.12)';
          g.beginPath();
          g.ellipse(kx, ky, r * 2.4, r * 0.7, 0, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.fillStyle = 'rgba(8,4,2,0.85)';
      g.fillRect(0, y0, w, 3);
      g.fillRect(R() * w, y0, 3, ph);
    }
  });
  const desk = mesh(new THREE.BoxGeometry(18, 0.4, 12), new THREE.MeshStandardMaterial({map: wood, roughness: 0.62}), 0, -0.2, 0, scene);
  desk.castShadow = false;
  mesh(new THREE.PlaneGeometry(40, 16), new THREE.MeshStandardMaterial({color: 0x211915, roughness: 0.95}), 0, 5, -9, scene);

  // notebook + coffee (front-right in the reference)
  const nbTex = canvasTex(700, 900, (g, w, h) => {
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a9c0d8';
    g.lineWidth = 2;
    for (let y = 120; y < h; y += 46) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.fillStyle = '#2b2b33';
    g.font = 'italic 34px "Segoe Print", "Bradley Hand", cursive';
    ['Music Producer', 'Chop on hats / 12-bit', '— swing 58%', '— filter: HPF ~80Hz', '— resample kick', '— bounce stems → SD', 'ready 2 track?'].forEach((s, i) => g.fillText(s, 90, 110 + i * 92));
  });
  const nb = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({color: 0x9a968e, roughness: 0.9});
  mesh(new THREE.BoxGeometry(2.4, 0.06, 3.0), [paper, paper, new THREE.MeshStandardMaterial({map: nbTex, color: 0xa29d94, roughness: 0.92}), paper, paper, paper], 0, 0.03, 0, nb);
  const rings = [];
  for (let i = 0; i < 22; i++) rings.push([-1.18, 0.06, -1.35 + i * 0.13]);
  nb.add(instances(new THREE.TorusGeometry(0.06, 0.008, 6, 16).rotateY(Math.PI / 2), M.chrome, rings));
  nb.position.set(4.3, 0, 2.0);
  nb.rotation.y = 0.35;
  scene.add(nb);
  const cup = new THREE.Group();
  const cupMat = new THREE.MeshPhysicalMaterial({color: 0xd8d4cc, roughness: 0.2, clearcoat: 1});
  const prof = [[0, 0], [0.34, 0], [0.38, 0.03], [0.42, 0.55], [0.44, 0.62], [0.41, 0.62], [0.39, 0.06], [0, 0.06]].map(([x, y]) => new THREE.Vector2(x, y));
  mesh(new THREE.LatheGeometry(prof, 64), cupMat, 0, 0, 0, cup);
  const handle = mesh(new THREE.TorusGeometry(0.15, 0.035, 12, 32, Math.PI * 1.2), cupMat, 0.47, 0.32, 0, cup);
  handle.rotation.z = -Math.PI * 0.6;
  const coffee = canvasTex(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#6b3f1d');
    gr.addColorStop(0.75, '#8b5a2e');
    gr.addColorStop(1, '#c79868');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  });
  mesh(new THREE.CircleGeometry(0.4, 48), new THREE.MeshStandardMaterial({map: coffee, roughness: 0.25}), 0, 0.52, 0, cup).rotation.x = -Math.PI / 2;
  cup.position.set(4.6, 0.06, 2.5);
  scene.add(cup);

  // keyboard synth (back-left)
  const kb = new THREE.Group();
  mesh(rbox(5.2, 0.35, 1.9, 0.05), M.dark, 0, 0.175, 0, kb);
  const woodSide = new THREE.MeshStandardMaterial({color: 0x6b3a1e, roughness: 0.5});
  for (const s of [-1, 1]) mesh(rbox(0.14, 0.45, 1.95, 0.04), woodSide, s * 2.67, 0.225, 0, kb);
  const wk = [], bk = [];
  for (let i = 0; i < 29; i++) {
    const x = -2.3 + i * 0.163;
    wk.push([x, 0.38, 0.42]);
    if ([0, 1, 3, 4, 5].includes(i % 7) && i < 28) bk.push([x + 0.082, 0.42, 0.24]);
  }
  kb.add(instances(new THREE.BoxGeometry(0.155, 0.1, 0.95), new THREE.MeshStandardMaterial({color: 0xb9b5ad, roughness: 0.45}), wk));
  kb.add(instances(new THREE.BoxGeometry(0.09, 0.12, 0.58), new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.3}), bk));
  kb.position.set(-5.6, 0, -1.4);
  kb.rotation.y = 0.62;
  scene.add(kb);

  // studio monitor (behind, left of centre)
  const mon = new THREE.Group();
  mesh(rbox(1.7, 2.4, 1.6, 0.08), M.dark, 0, 1.2, 0, mon);
  mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.12, 48), M.black, 0, 0.8, 0.82, mon).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.58, 0.05, 12, 48), M.rubber, 0, 0.8, 0.82, mon);
  mon.position.set(-3.6, 0, -3.9);
  mon.rotation.y = 0.5;
  scene.add(mon);

  // headphones + patch cables (left)
  const hp = new THREE.Group();
  mesh(new THREE.TorusGeometry(0.75, 0.06, 12, 48, Math.PI), M.rubber, 0, 0.1, 0, hp).rotation.x = -Math.PI / 2;
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 36), M.knob, s * 0.75, 0.2, 0.05, hp);
    mesh(new THREE.TorusGeometry(0.28, 0.08, 12, 32), M.rubber, s * 0.75, 0.33, 0.05, hp).rotation.x = Math.PI / 2;
  }
  hp.position.set(-3.5, 0, 2.9);
  hp.rotation.y = 1.0;
  scene.add(hp);
  const patch = (col, pts) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    mesh(new THREE.TubeGeometry(curve, 80, 0.022, 8), new THREE.MeshStandardMaterial({color: col, roughness: 0.45}), 0, 0, 0, scene);
    for (const e of [0, 1]) {
      const pt = curve.getPoint(e), tan = curve.getTangent(e).multiplyScalar(e ? 1 : -1);
      const j = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 16), M.chrome, 0, 0, 0, scene);
      j.position.copy(pt).addScaledVector(tan, 0.1);
      j.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      const tip = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 12), M.gold, 0, 0, 0, scene);
      tip.position.copy(pt).addScaledVector(tan, 0.28);
      tip.quaternion.copy(j.quaternion);
    }
  };
  patch(0xe0b23a, [[-3.9, 0.03, 0.2], [-3.2, 0.03, 0.7], [-3.5, 0.03, 1.3], [-2.9, 0.03, 1.8], [-3.3, 0.03, 2.3]]);
  patch(0x3456c8, [[-3.0, 0.03, 0.0], [-3.5, 0.03, 0.8], [-2.9, 0.03, 1.4], [-3.2, 0.03, 2.0], [-4.0, 0.03, 2.2]]);

  // a coiled braided cable and a small box at the right edge
  const coil = [];
  for (let i = 0; i <= 400; i++) {
    const a = (i / 400) * Math.PI * 2 * 4;
    const rr = 0.7 + 0.05 * Math.sin(i * 0.4);
    coil.push(new THREE.Vector3(4.4 + Math.cos(a) * rr, 0.05 + (i / 400) * 0.2, -0.9 + Math.sin(a) * rr * 0.8));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 600, 0.045, 8), M.braid, 0, 0, 0, scene);
  mesh(rbox(1.2, 0.8, 1.4, 0.05), M.dark, 3.6, 0.4, -3.0, scene);
}
