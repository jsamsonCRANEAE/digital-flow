// Rigid-body vehicle: raycast suspension, load-sensitive tyres with a friction circle,
// engine torque curve + gearbox, AWD/FWD/RWD split, handbrake, aero, body & tree collisions.
// Runs at a fixed 240 Hz sub-step for stability; inputs are smoothed for controller feel.
(function () {
  'use strict';
  const AR = window.AR;
  const V3 = THREE.Vector3;
  const G = 9.81;
  const DT = 1 / 240;

  function torqueCurve(x, ev) {
    if (ev) return x < 0.38 ? 1 : 0.38 / x; // flat torque, then constant power
    if (x < 0.7) {
      const t = 1 - x / 0.7;
      return 0.55 + 0.45 * (1 - t * t);
    }
    const t = (x - 0.7) / 0.3;
    return 1 - 0.2 * t * t;
  }

  class Vehicle {
    constructor(p, stage, settings) {
      this.p = p;
      this.stage = stage;
      this.settings = settings || {};
      this.m = p.mass;
      const L = p.L, W = p.W, Hh = p.H * 0.75;
      const k = 0.9;
      this.Iloc = new V3((this.m / 12) * (Hh * Hh + L * L) * k, (this.m / 12) * (W * W + L * L) * k, (this.m / 12) * (W * W + Hh * Hh) * k);
      this.invI = new V3(1 / this.Iloc.x, 1 / this.Iloc.y, 1 / this.Iloc.z);

      this.restLen = p.restLen + p.heightOffset;
      const staticComp = (this.m * G) / 4 / p.k;
      // lifting lengthens the spring, so the body rides higher above the same wheel position
      this.mountY = p.wheelR + p.restLen - staticComp - p.cgH;
      this.cDamp = (2 * 0.42 * Math.sqrt((p.k * this.m) / 4)) / (p.softness || 1);
      this.wheels = [];
      const xs = [-p.track / 2, p.track / 2, -p.track / 2, p.track / 2];
      const zs = [-p.wb / 2, -p.wb / 2, p.wb / 2, p.wb / 2];
      for (let i = 0; i < 4; i++) {
        this.wheels.push({
          front: i < 2, local: new V3(xs[i], this.mountY, zs[i]),
          comp: 0, prevComp: 0, contact: false, load: 0, surf: 1,
          spin: 0, spinVel: 0, slip: 0, lat: 0, longSlip: 0, susLen: this.restLen,
          cp: new V3(), n: new V3(0, 1, 0), steer: 0,
        });
      }
      // body collision probes (car-local, relative to CG)
      const yb = -p.cgH + 0.25, yt = p.H - p.cgH;
      this.probes = [];
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [yb, yt].forEach((y) => this.probes.push(new V3((sx * W) / 2, y, (sz * L) / 2)))));
      this.probes.push(new V3(0, yt + 0.05, 0));

      this.pos = new V3();
      this.vel = new V3();
      this.q = new THREE.Quaternion();
      this.w = new V3();
      this.gear = 1;
      this.rpm = p.idle || 800;
      this.shiftT = 0;
      this.revT = 0;
      this.steerIn = 0;
      this.steerAngle = 0;
      this.acc = 0;
      this.airT = 0;
      this.events = [];
      this.dmg = { engine: 0, align: 0 };
      this.tm = { speed: 0, fwd: 0, drift: 0, airborne: false, surf: 1, slipAvg: 0, rumble: 0 };
      // scratch
      this._R = new V3(); this._U = new V3(); this._F = new V3();
      this._g = {};
      this._trees = [];
    }

    reset(pos, dir) {
      this.pos.copy(pos);
      this.pos.y += this.p.cgH + 0.25;
      const yaw = Math.atan2(-dir.x, -dir.z);
      this.q.setFromAxisAngle(new V3(0, 1, 0), yaw);
      this.vel.set(0, 0, 0);
      this.w.set(0, 0, 0);
      this.gear = 1;
      this.rpm = this.p.idle || 800;
      this.steerIn = this.steerAngle = 0;
      this.wheels.forEach((w) => { w.comp = w.prevComp = 0; w.spinVel = 0; });
    }

    // world-space inverse inertia applied to v (in-place)
    applyInvI(v) {
      const qi = this._qi || (this._qi = new THREE.Quaternion());
      qi.copy(this.q).invert();
      v.applyQuaternion(qi);
      v.set(v.x * this.invI.x, v.y * this.invI.y, v.z * this.invI.z);
      return v.applyQuaternion(this.q);
    }

    update(frameDt, input) {
      this.acc += Math.min(frameDt, 0.05);
      this.events.length = 0;
      let n = 0;
      while (this.acc >= DT && n < 14) {
        this.step(DT, input);
        this.acc -= DT;
        n++;
      }
      input.shiftUp = input.shiftDown = false;
      this.updateTelemetry();
    }

    step(dt, inp) {
      const p = this.p, st = this.stage, m = this.m;
      const R = this._R.set(1, 0, 0).applyQuaternion(this.q);
      const U = this._U.set(0, 1, 0).applyQuaternion(this.q);
      const F = this._F.set(0, 0, -1).applyQuaternion(this.q);
      const force = new V3(0, -G * m, 0);
      const torque = new V3();
      const speed = this.vel.length();
      const vF = this.vel.dot(F);
      const vR = this.vel.dot(R);

      // ---------- steering (speed-sensitive + optional counter-steer assist) ----------
      const target = inp.steer;
      const rate = Math.abs(target) > Math.abs(this.steerIn) ? 4.2 : 6.5;
      this.steerIn += AR.clamp(target - this.steerIn, -rate * dt, rate * dt);
      const maxSteer = ((p.steer * Math.PI) / 180) / (1 + Math.max(0, Math.abs(vF) - 4) / 26);
      // bent steering arms pull the car to one side
      let steer = this.steerIn * maxSteer + this.dmg.align;
      const beta = Math.abs(vF) > 4 ? Math.atan2(vR, Math.abs(vF)) : 0;
      const assist = this.settings.steerAssist == null ? 0.45 : this.settings.steerAssist;
      if (vF > 4) steer += AR.clamp(beta * assist, -0.35, 0.35);
      const maxLock = (p.steer * Math.PI) / 180;
      this.steerAngle = AR.clamp(steer, -maxLock, maxLock);

      // ---------- drivetrain ----------
      let throttle = inp.throttle, brake = inp.brake;
      // auto reverse: hold brake when stopped
      if (inp.hold) this.revT = 0;
      else if (this.gear > 0 && Math.abs(vF) < 1.2 && brake > 0.3 && throttle < 0.1) {
        this.revT += dt;
        if (this.revT > 0.35) { this.gear = -1; this.revT = 0; }
      } else if (this.gear === -1 && Math.abs(vF) < 1.2 && throttle > 0.3) {
        this.revT += dt;
        if (this.revT > 0.2) { this.gear = 1; this.revT = 0; }
      } else this.revT = 0;
      if (this.gear === -1) { const t = throttle; throttle = brake; brake = t; }

      const nG = p.gears.length;
      if (this.shiftT > 0) this.shiftT -= dt;
      const ratio = this.gear === -1 ? -3.3 * p.final : p.gears[this.gear - 1] * p.final;
      const wheelRpm = (Math.abs(vF) / p.wheelR) * 60 / (Math.PI * 2);
      let rpm = wheelRpm * Math.abs(ratio);
      const idle = p.idle || 0;
      // clutch slip / launch
      const launch = idle + throttle * (p.redline * 0.45 - idle);
      if ((this.gear === 1 || this.gear === -1) && !p.ev) rpm = Math.max(rpm, launch); // clutch slips until the wheels catch up
      rpm = Math.max(rpm, idle);
      if (!p.ev && this.gear > 0) {
        const manual = this.settings.manual;
        if (!manual && this.shiftT <= 0) {
          if (rpm > p.redline * 0.93 && this.gear < nG && throttle > 0.2) { this.gear++; this.shiftT = 0.16; this.events.push({ type: 'shift', up: true }); }
          else if (rpm < p.redline * 0.42 && this.gear > 1) { this.gear--; this.shiftT = 0.12; this.events.push({ type: 'shift', up: false }); }
        }
        if (manual) {
          if (inp.shiftUp && this.gear < nG) { this.gear++; this.shiftT = 0.12; this.events.push({ type: 'shift', up: true }); }
          if (inp.shiftDown && this.gear > 1) { this.gear--; this.shiftT = 0.12; this.events.push({ type: 'shift', up: false }); }
        }
      }
      const x = rpm / p.redline;
      let engT = p.torque * torqueCurve(x, p.ev) * throttle * (1 - 0.55 * this.dmg.engine);
      if (rpm >= p.redline) engT = 0; // limiter
      if (this.gear === -1 && vF > 8.5) engT = 0; // reverse is capped around 30 km/h
      if (this.shiftT > 0) engT *= 0.1;
      if (throttle < 0.05 && Math.abs(vF) > 2 && !p.ev) engT = -p.torque * 0.14 * AR.clamp(x, 0.2, 1); // engine braking
      if (p.ev && throttle < 0.05 && Math.abs(vF) > 2) engT = -p.torque * 0.18; // regen
      const driveTotal = (engT * ratio * 0.88) / p.wheelR;
      this.engRpmTarget = rpm;
      this.throttleNow = throttle;

      // ---------- wheels ----------
      const gripTable = AR.GRIP[p.tires] || AR.GRIP.gravel;
      const tc = this.settings.tc !== false;
      const Fz0 = (m * G) / 4;
      const kRoll = p.k * 0.55;
      let contacts = 0;
      const W = this.wheels;
      const mw = new V3(), rel = new V3(), vc = new V3(), wf = new V3(), wr = new V3(), f = new V3();
      // suspension pass
      for (let i = 0; i < 4; i++) {
        const w = W[i];
        mw.copy(w.local).applyQuaternion(this.q).add(this.pos);
        const g = st.ground(mw.x, mw.z, this._g);
        w.n.copy(g.n);
        w.surf = g.surf;
        // distance along -U from mount to ground plane
        const denom = Math.max(0.2, g.n.dot(U));
        const t = (mw.y - g.h) * g.n.y / denom;
        const sus = t - p.wheelR;
        w.prevComp = w.comp;
        if (sus < this.restLen) {
          w.contact = true;
          w.comp = this.restLen - sus;
          w.susLen = Math.max(0.02, sus);
          w.cp.copy(mw).addScaledVector(U, -t);
        } else {
          w.contact = false;
          w.comp = 0;
          w.susLen = this.restLen;
        }
      }
      for (let i = 0; i < 4; i++) {
        const w = W[i];
        if (!w.contact) { w.load = 0; continue; }
        contacts++;
        const other = W[i ^ 1];
        const vComp = (w.comp - w.prevComp) / dt;
        const cd = vComp > 0 ? this.cDamp : this.cDamp * 1.35;
        let Fs = p.k * w.comp + cd * vComp + kRoll * (w.comp - other.comp);
        if (w.comp > this.restLen * 0.9) Fs += p.k * 10 * (w.comp - this.restLen * 0.9); // bump stop
        Fs = AR.clamp(Fs, 0, m * G * 3);
        w.load = Fs;
        f.copy(U).multiplyScalar(Fs);
        force.add(f);
        rel.copy(w.cp).sub(this.pos);
        torque.add(new V3().crossVectors(rel, f));

        // tyre frame
        const delta = w.front ? this.steerAngle : 0;
        const cs = Math.cos(delta), sn = Math.sin(delta);
        wf.copy(F).multiplyScalar(cs).addScaledVector(R, sn);
        wf.addScaledVector(w.n, -wf.dot(w.n)).normalize();
        wr.crossVectors(wf, w.n).normalize();
        vc.crossVectors(this.w, rel).add(this.vel);
        const vLong = vc.dot(wf), vLat = vc.dot(wr);

        const Fz = Math.min(Fs, Fz0 * 2.6);
        let mu = gripTable[w.surf] || 0.8;
        mu *= 1 - 0.07 * (Fz / Fz0 - 1);
        const Fmax = mu * Fz;
        const loose = w.surf !== AR.SURF.TARMAC;

        // lateral
        const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.6);
        const B = loose ? 7 : 9.5, C = loose ? 1.35 : 1.5;
        let Fy = -Fmax * Math.sin(C * Math.atan(B * alpha));
        const sp = Math.hypot(vLong, vLat);
        const blend = AR.smoothstep(0.4, 3.0, sp);
        const Fstatic = AR.clamp(-vLat * (m / 4) * 9, -Fmax, Fmax);
        Fy = AR.lerp(Fstatic, Fy, blend);

        // longitudinal: drive, brake, handbrake, rolling
        const share = w.front ? p.split / 2 : (1 - p.split) / 2;
        let Fd = driveTotal * share;
        if (tc && Math.abs(Fd) > Fmax * 1.02 && this.gear !== -1) Fd = Math.sign(Fd) * Fmax * 1.02;
        const brakeF = brake * p.brake * (w.front ? 0.62 : 0.38);
        let Fb = 0;
        let locked = false;
        if (brakeF > 0) Fb += brakeF;
        if (!w.front && inp.handbrake > 0.1) { Fb += inp.handbrake * Fmax * 1.6; locked = inp.handbrake > 0.5; }
        Fb += 0.012 * Fz;
        let Fbx = Math.abs(vLong) > 0.6 ? -Math.sign(vLong) * Fb : AR.clamp(-vLong * (m / 4) * 10, -Fb, Fb);
        if (locked) Fd = 0;
        const absOn = this.settings.abs !== false;
        if (!locked && absOn && Math.abs(Fbx) > Fmax * 0.98) Fbx = Math.sign(Fbx) * Fmax * 0.98;
        let Fx = Fd + Fbx;
        // longitudinal slip (wheelspin / lock) collapses lateral grip
        const demand = Math.abs(Fx) / Math.max(1, Fmax);
        let spinning = 0;
        if (demand > 1) {
          spinning = demand - 1;
          Fy *= 1 / Math.pow(demand, loose ? 1.1 : 1.5);
        }
        if (locked && Math.abs(vLong) > 1) Fy *= 0.55;
        const tot = Math.hypot(Fx, Fy);
        if (tot > Fmax) { Fx *= Fmax / tot; Fy *= Fmax / tot; }

        f.copy(wf).multiplyScalar(Fx).addScaledVector(wr, Fy);
        force.add(f);
        // apply tyre forces part-way up toward the CG: smoother roll/pitch response
        const app = rel.clone().addScaledVector(U, p.cgH * 0.45);
        torque.add(new V3().crossVectors(app, f));

        // visual/audio data
        const roll = vLong / p.wheelR;
        if (locked) w.spinVel = AR.lerp(w.spinVel, 0, 0.3);
        else w.spinVel = roll + Math.sign(Fd || 1) * spinning * 25 * (Math.abs(Fd) > 1 ? 1 : 0);
        w.lat = vLat;
        w.longSlip = locked ? Math.abs(vLong) : spinning * 8;
        w.slip = Math.abs(vLat) * blend + w.longSlip;
      }
      for (let i = 0; i < 4; i++) W[i].spin += W[i].spinVel * dt;

      // ---------- aero ----------
      const cda = 0.5 * 1.2 * (p.H > 1.6 ? 0.95 : 0.72);
      force.addScaledVector(this.vel, -cda * speed);
      force.addScaledVector(U, -0.5 * 1.2 * 0.35 * vF * vF);

      // ---------- body vs ground (flips, landings) ----------
      const pw = new V3();
      for (let i = 0; i < this.probes.length; i++) {
        pw.copy(this.probes[i]).applyQuaternion(this.q).add(this.pos);
        const g = st.ground(pw.x, pw.z, this._g);
        const d = g.h - pw.y;
        if (d > 0) {
          rel.copy(pw).sub(this.pos);
          vc.crossVectors(this.w, rel).add(this.vel);
          const vn = vc.dot(g.n);
          const fn = Math.max(0, m * 300 * d - m * 18 * vn);
          f.copy(g.n).multiplyScalar(fn);
          // sliding friction
          const vt = vc.clone().addScaledVector(g.n, -vn);
          const vtl = vt.length();
          if (vtl > 0.01) f.addScaledVector(vt, (-0.6 * fn) / vtl);
          force.add(f);
          torque.add(new V3().crossVectors(rel, f));
          if (vn < -3) this.events.push({ type: 'scrape', v: -vn, at: pw.clone(), n: g.n.clone() });
        }
      }

      // ---------- integrate ----------
      this.vel.addScaledVector(force, dt / m);
      const angAcc = this.applyInvI(torque.clone());
      this.w.addScaledVector(angAcc, dt);
      // gentle stability damping (keeps the car smooth on a pad)
      const yawRate = this.w.dot(U);
      this.w.addScaledVector(U, -yawRate * (contacts > 0 ? 0.45 : 0.05) * dt);
      this.w.multiplyScalar(1 - (contacts > 0 ? 0.6 : 0.15) * dt);
      this.pos.addScaledVector(this.vel, dt);
      const wq = new THREE.Quaternion(this.w.x, this.w.y, this.w.z, 0).multiply(this.q);
      this.q.x += 0.5 * wq.x * dt; this.q.y += 0.5 * wq.y * dt; this.q.z += 0.5 * wq.z * dt; this.q.w += 0.5 * wq.w * dt;
      this.q.normalize();

      this.collideObstacles();
      this.contacts = contacts;
      if (contacts === 0) this.airT += dt;
      else {
        if (this.airT > 0.6) this.events.push({ type: 'land', t: this.airT });
        this.airT = 0;
      }
    }

    // Trees and rocks are rigid; signposts snap off. Impacts land at bumper height, so a big hit
    // can spin, pitch or roll the car instead of just stopping it.
    collideObstacles() {
      const p = this.p;
      const F = this._F.set(0, 0, -1).applyQuaternion(this.q);
      const U = this._U.set(0, 1, 0).applyQuaternion(this.q);
      const obs = this.stage.treesNear(this.pos.x, this.pos.z, this._trees);
      if (!obs.length) return;
      const r = p.W * 0.5;
      const n = new V3(), c = new V3(), rel = new V3(), vp = new V3(), cp = new V3();
      const bumperY = -p.cgH + 0.5;
      for (let k = -1; k <= 1; k++) {
        c.copy(this.pos).addScaledVector(F, (k * p.L) / 3);
        for (let i = 0; i < obs.length; i++) {
          const t = obs[i];
          if (t.broken) continue;
          const dx = c.x - t.x, dz = c.z - t.z;
          const d = Math.hypot(dx, dz);
          const min = r + t.r;
          if (d >= min || d < 1e-4) continue;
          n.set(dx / d, 0, dz / d);
          if (t.kind === 'prop') {
            t.broken = true;
            const sp = this.vel.length();
            this.vel.multiplyScalar(0.97);
            this.events.push({ type: 'prop', obj: t.obj, v: sp, n: n.clone().negate() });
            continue;
          }
          this.pos.addScaledVector(n, (min - d) * 0.9);
          // contact on the car's skin, at bumper height
          cp.copy(c).addScaledVector(n, -r).addScaledVector(U, bumperY);
          rel.copy(cp).sub(this.pos);
          vp.crossVectors(this.w, rel).add(this.vel);
          const vn = vp.dot(n);
          if (vn < 0) {
            const rn = new V3().crossVectors(rel, n);
            const k2 = 1 / this.m + this.applyInvI(rn.clone()).cross(rel).dot(n);
            const j = (-(1 + 0.2) * vn) / k2;
            this.vel.addScaledVector(n, j / this.m);
            this.w.add(this.applyInvI(rn.multiplyScalar(j)));
            // friction along the obstacle face
            const vt = vp.clone().addScaledVector(n, -vn);
            this.vel.addScaledVector(vt, -0.25);
            this.events.push({ type: 'crash', v: -vn, at: cp.clone(), n: n.clone(), kind: t.kind });
          }
        }
      }
    }

    updateTelemetry() {
      const F = new V3(0, 0, -1).applyQuaternion(this.q);
      const R = new V3(1, 0, 0).applyQuaternion(this.q);
      const tm = this.tm;
      tm.speed = this.vel.length();
      tm.fwd = this.vel.dot(F);
      const lat = this.vel.dot(R);
      tm.drift = tm.speed > 6 ? Math.atan2(lat, Math.abs(tm.fwd)) : 0;
      tm.airborne = this.contacts === 0;
      tm.airT = this.airT;
      let s = 0, surf = 1;
      this.wheels.forEach((w, i) => { s += w.slip; if (i >= 2 && w.contact) surf = w.surf; });
      tm.slipAvg = s / 4;
      tm.surf = surf;
      tm.gear = this.gear;
      // smooth tach
      const target = Math.min(this.engRpmTarget || 0, this.p.redline * 1.01);
      const spin = Math.max(0, ...this.wheels.map((w) => w.longSlip));
      this.rpm = AR.lerp(this.rpm, Math.min(this.p.redline, target + spin * 250), 0.25);
      tm.rpm = this.rpm;
      tm.throttle = this.throttleNow || 0;
      let rough = 0;
      this.wheels.forEach((w) => { rough += Math.abs(w.comp - w.prevComp); });
      tm.rumble = AR.clamp(rough * 60, 0, 1);
    }
  }

  AR.Vehicle = Vehicle;
})();
