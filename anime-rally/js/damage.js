// Crash damage: crumples the body mesh where you hit, cracks glass, smashes lamps, knocks parts
// off as tumbling debris, bends steering and hurts the engine (in "full" mode), and sends
// knocked-over signposts flying.
(function () {
  'use strict';
  const AR = window.AR;
  const V3 = THREE.Vector3;

  let crackTex = null;
  function crackedGlass() {
    if (crackTex) return crackTex;
    const c = AR.canvas(256, 256), g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#46618c');
    grd.addColorStop(1, '#1a2740');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    const r = AR.rng(99);
    // spider-web crack
    const cx = 110, cy = 120;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + r() * 0.3;
      g.lineWidth = 1.5 + r() * 1.5;
      g.beginPath();
      g.moveTo(cx, cy);
      let x = cx, y = cy;
      for (let k = 0; k < 5; k++) {
        x += Math.cos(a + (r() - 0.5) * 0.5) * (25 + r() * 25);
        y += Math.sin(a + (r() - 0.5) * 0.5) * (25 + r() * 25);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let ring = 1; ring <= 3; ring++) {
      g.lineWidth = 1.2;
      g.beginPath();
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const rr = ring * 28 + r() * 10;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    return (crackTex = AR.canvasTex(c));
  }

  class Damage {
    constructor(model, carRoot, vehicle, scene, stage, dust, mode) {
      this.model = model;
      this.carRoot = carRoot;
      this.v = vehicle;
      this.scene = scene;
      this.stage = stage;
      this.dust = dust;
      this.mode = mode || 'full'; // off | visual | full
      this.zones = { front: 0, rear: 0, left: 0, right: 0 };
      this.total = 0;
      this.debris = [];
      this.smokeAcc = 0;
      this.cool = 0;
      this.lastV = 0;
      this.brokenLamp = AR.toonMat(0x2a2b30, { hatch: false });
      this.crackMat = AR.toonMat(0xffffff, { map: crackedGlass(), rim: 0.3, spec: 0.5, side: THREE.DoubleSide, hatch: false });
      // keep pristine vertex positions so a restart can repair
      this.orig = model.deformables.map((m) => m.geometry.attributes.position.array.slice());
    }

    // world point/normal → model space. Normal n points from the obstacle toward the car.
    impact(worldPt, n, speed, kind) {
      if (this.mode === 'off' || speed < 3.5) return 0;
      const root = this.model.root;
      root.updateMatrixWorld(true);
      const local = root.worldToLocal(worldPt.clone());
      const qi = this.carRoot.quaternion.clone().invert();
      const dirIn = n.clone().applyQuaternion(qi).normalize(); // into the car body
      const s = Math.min(0.5, (speed - 3.5) * 0.032);
      this.deform(local, dirIn, s, 0.6 + speed * 0.04);

      // zone bookkeeping (car forward is −z)
      const L = this.model.meta.zMax - this.model.meta.zMin;
      const amt = Math.min(1, (speed - 3.5) / 25);
      if (local.z < -L * 0.22) this.zones.front = Math.min(1, this.zones.front + amt);
      else if (local.z > L * 0.22) this.zones.rear = Math.min(1, this.zones.rear + amt);
      else if (local.x < 0) this.zones.left = Math.min(1, this.zones.left + amt);
      else this.zones.right = Math.min(1, this.zones.right + amt);
      this.total = Math.min(1, (this.zones.front + this.zones.rear + this.zones.left + this.zones.right) / 2.6);

      // mechanical damage
      if (this.mode === 'full') {
        const d = this.v.dmg;
        if (local.z < -L * 0.22) d.engine = Math.min(1, d.engine + amt * 0.8);
        if (Math.abs(local.z - (-this.v.p.wb / 2)) < 0.9 && speed > 8) {
          d.align = AR.clamp(d.align + (local.x < 0 ? -1 : 1) * amt * 0.06, -0.09, 0.09);
          const wi = local.x < 0 ? 0 : 1;
          this.model.wheels[wi].camber = AR.clamp((this.model.wheels[wi].camber || 0) + (local.x < 0 ? -1 : 1) * amt * 0.18, -0.25, 0.25);
        }
      }

      // glass
      if (speed > 10) {
        this.model.glass.forEach((gm) => {
          const c = this.center(gm);
          if (c.distanceTo(local) < 1.5 + speed * 0.035) gm.material = this.crackMat;
        });
      }
      // lamps
      if (speed > 6) {
        this.model.lamps.forEach((lm) => {
          if (lm.userData.broken) return;
          const c = this.center(lm);
          if (c.distanceTo(local) < 0.7 + speed * 0.015) {
            lm.userData.broken = true;
            lm.material = this.brokenLamp;
            this.shards(lm, 0xe8f2ff, 6);
          }
        });
      }
      // parts flying off
      this.model.breakables.slice().forEach((part) => {
        if (!part.parent || part.parent !== root) return;
        const c = this.center(part);
        const reach = 0.7 + speed * 0.03;
        if (speed > part.userData.breakable && c.distanceTo(local) < reach) this.detach(part, n, speed);
      });
      return amt;
    }

    center(obj) {
      if (!obj.userData._c) {
        const b = new THREE.Box3().setFromObject(obj);
        const root = this.model.root;
        // the box is in world space; bring it back to model space once
        const c = b.getCenter(new V3());
        obj.userData._c = root.worldToLocal(c);
      }
      return obj.userData._c;
    }

    deform(p, dirIn, s, R) {
      this.model.deformables.forEach((mesh, mi) => {
        const pos = mesh.geometry.attributes.position;
        const arr = pos.array;
        const orig = this.orig[mi];
        let touched = false;
        const R2 = R * R;
        for (let i = 0; i < pos.count; i++) {
          const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
          const dx = x - p.x, dy = y - p.y, dz = z - p.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R2) continue;
          const f = 1 - Math.sqrt(d2) / R;
          // jagged crumple: deterministic jitter per vertex position
          const j = 0.75 + 0.5 * (((Math.sin(orig[i * 3] * 91.7 + orig[i * 3 + 1] * 47.3 + orig[i * 3 + 2] * 13.1) * 43758.5) % 1 + 1) % 1);
          const k = s * f * f * j;
          let nx = x + dirIn.x * k, ny = y + dirIn.y * k * 0.5 - k * 0.15, nz = z + dirIn.z * k;
          // never push more than 55 cm from the factory shape
          const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
          const ddx = nx - ox, ddy = ny - oy, ddz = nz - oz;
          const dl = Math.hypot(ddx, ddy, ddz);
          if (dl > 0.55) { nx = ox + (ddx * 0.55) / dl; ny = oy + (ddy * 0.55) / dl; nz = oz + (ddz * 0.55) / dl; }
          arr[i * 3] = nx; arr[i * 3 + 1] = ny; arr[i * 3 + 2] = nz;
          touched = true;
        }
        if (touched) {
          pos.needsUpdate = true;
          // faceted normals on the crumpled area read as dents under cel shading
          this.facetNormals(mesh.geometry, p, R * 1.1);
          mesh.geometry.computeBoundingSphere();
        }
      });
    }

    facetNormals(geo, p, R) {
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      if (geo.index) return; // extrusions are non-indexed
      const a = new V3(), b = new V3(), c = new V3(), e1 = new V3(), e2 = new V3();
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i);
        if (a.distanceTo(p) > R) continue;
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        e1.cross(e2).normalize();
        for (let k = 0; k < 3; k++) nor.setXYZ(i + k, e1.x, e1.y, e1.z);
      }
      nor.needsUpdate = true;
    }

    detach(part, n, speed) {
      if (this.debris.length > 45) this.removeDebris(this.debris[0]);
      part.updateMatrixWorld(true);
      const m = part.matrixWorld.clone();
      part.parent.remove(part);
      m.decompose(part.position, part.quaternion, part.scale);
      this.scene.add(part);
      const vel = this.v.vel.clone().multiplyScalar(0.55)
        .addScaledVector(n, speed * 0.25)
        .add(new V3((Math.random() - 0.5) * 4, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 4));
      const ang = new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
      this.debris.push({ obj: part, vel, ang, life: 25, own: true });
      this.shards(part, 0xcfd6e0, 3);
    }

    // a roadside prop knocked over by the car
    knock(obj, carVel) {
      const vel = carVel.clone().multiplyScalar(0.75).add(new V3(0, 3 + Math.random() * 2, 0));
      const ang = new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(10);
      this.debris.push({ obj, vel, ang, life: 1e9, own: false });
    }

    shards(obj, color, n) {
      if (!this.dust) return;
      const p = new V3();
      obj.getWorldPosition(p);
      const col = new THREE.Color(color);
      for (let i = 0; i < n; i++) {
        this.dust.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 6 + this.v.vel.x * 0.3, 1 + Math.random() * 3, (Math.random() - 0.5) * 6 + this.v.vel.z * 0.3, 0.25 + Math.random() * 0.25, 0.8, col, 0.95);
      }
    }

    removeDebris(d) {
      const i = this.debris.indexOf(d);
      if (i >= 0) this.debris.splice(i, 1);
      if (d.own && d.obj.parent) {
        d.obj.parent.remove(d.obj);
        d.obj.traverse((o) => { if (o.geometry && !o.userData.isOutline) o.geometry.dispose(); });
      }
    }

    update(dt) {
      this.cool = Math.max(0, this.cool - dt);
      if (this.cool <= 0) this.lastV = 0;
      const q = new THREE.Quaternion();
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const d = this.debris[i];
        d.life -= dt;
        if (d.life <= 0) { this.removeDebris(d); continue; }
        if (d.rest) continue;
        d.vel.y -= 9.81 * dt;
        const o = d.obj;
        o.position.addScaledVector(d.vel, dt);
        const al = d.ang.length();
        if (al > 0.01) {
          q.setFromAxisAngle(d.ang.clone().divideScalar(al), al * dt);
          o.quaternion.premultiply(q);
        }
        const gh = this.stage.groundRaw(o.position.x, o.position.z).h + 0.05;
        if (o.position.y < gh) {
          o.position.y = gh;
          if (d.vel.y < 0) d.vel.y *= -0.3;
          d.vel.x *= 0.6; d.vel.z *= 0.6;
          d.ang.multiplyScalar(0.6);
          if (d.vel.lengthSq() < 0.2 && d.ang.lengthSq() < 0.2) d.rest = true;
        }
      }
      // engine smoke when the front end is hurt
      const e = this.v.dmg.engine;
      if (this.mode === 'full' && e > 0.3 && this.dust) {
        this.smokeAcc += dt * (4 + e * 18);
        const meta = this.model.meta;
        const hood = new V3(0, meta.hoodY + 0.15, meta.zMin * 0.6);
        this.model.root.localToWorld(hood);
        const col = new THREE.Color(e > 0.7 ? 0x55545a : 0xb9bcc6);
        while (this.smokeAcc >= 1) {
          this.smokeAcc -= 1;
          this.dust.emit(hood.x, hood.y, hood.z, (Math.random() - 0.5) * 0.8, 1.5 + Math.random(), (Math.random() - 0.5) * 0.8, 0.8 + e, 1.6, col, 0.6);
        }
      }
      // bent wheels
      this.model.wheels.forEach((w) => { if (w.camber) w.pivot.rotation.z = w.camber; });
    }

    dispose() {
      this.debris.slice().forEach((d) => this.removeDebris(d));
    }
  }

  AR.Damage = Damage;
})();
