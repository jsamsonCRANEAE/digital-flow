// Visual effects: cel-shaded dust puffs, tyre tracks, falling snow, manga speed lines,
// anime impact popups and screen flashes.
(function () {
  'use strict';
  const AR = window.AR;

  // ---------- cel dust particles ----------
  class Dust {
    constructor(scene, max) {
      this.max = max || 700;
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(this.max * 3);
      this.size = new Float32Array(this.max);
      this.alpha = new Float32Array(this.max);
      this.col = new Float32Array(this.max * 3);
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
      g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
      g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uScale: { value: 600 }, uInk: AR.styleUniforms.uInk },
        vertexShader: [
          'attribute float size; attribute float alpha; attribute vec3 pcolor;',
          'varying float vA; varying vec3 vC;',
          'uniform float uScale;',
          'void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);',
          // fade puffs that get right in front of the lens
          ' vA = alpha * smoothstep(2.5, 7.0, -mv.z);',
          ' gl_PointSize = size * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }',
        ].join('\n'),
        fragmentShader: [
          'varying float vA; varying vec3 vC; uniform vec3 uInk;',
          'void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);',
          ' if (d > 0.5 || vA <= 0.0) discard;',
          // two cel tones + ink rim, lit from top-left
          ' float lit = step(0.0, dot(normalize(c + vec2(0.0001)), vec2(-0.6, -0.8)) * 0.5 + 0.18 - d*0.2);',
          ' vec3 col = mix(vC * 0.78, vC * 1.05, lit);',
          ' col = mix(col, uInk * 0.35 + vC * 0.65, smoothstep(0.44, 0.48, d));',
          ' gl_FragColor = vec4(col, vA * (1.0 - d * 0.5));',
          ' #include <encodings_fragment>',
          '}',
        ].join('\n'),
      });
      this.points = new THREE.Points(g, m);
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.p = [];
      for (let i = 0; i < this.max; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a: 1, r: 1, g: 1, b: 1 });
      this.cursor = 0;
    }
    emit(x, y, z, vx, vy, vz, size, life, color, alpha) {
      const p = this.p[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.s0 = size * 0.5; p.s1 = size * 1.6; p.life = life; p.max = life;
      p.r = color.r; p.g = color.g; p.b = color.b; p.a = alpha == null ? 0.85 : alpha;
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        const p = this.p[i];
        if (p.life > 0) {
          p.life -= dt;
          p.vx *= 1 - 1.6 * dt; p.vz *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.2 * dt) + 0.4 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const t = 1 - p.life / p.max;
          this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
          this.size[i] = AR.lerp(p.s0, p.s1, Math.sqrt(t));
          this.alpha[i] = p.a * (1 - t * t);
          this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
        } else this.alpha[i] = 0;
      }
      const a = this.points.geometry.attributes;
      a.position.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = a.pcolor.needsUpdate = true;
    }
    setScale(h) {
      this.points.material.uniforms.uScale.value = h * 0.32;
    }
    dispose(scene) {
      scene.remove(this.points);
      this.points.geometry.dispose();
    }
  }

  // ---------- tyre tracks ----------
  class Skids {
    constructor(scene, max) {
      this.max = max || 3000;
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(this.max * 4 * 3);
      this.col = new Float32Array(this.max * 4 * 4);
      const idx = new Uint32Array(this.max * 6);
      for (let i = 0; i < this.max; i++) {
        const v = i * 4;
        idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      this.mesh = new THREE.Mesh(g, m);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 1;
      scene.add(this.mesh);
      this.cursor = 0;
      this.last = [null, null, null, null];
    }
    add(i, p, dirX, dirZ, width, alpha, rgb) {
      const last = this.last[i];
      if (!last || alpha <= 0.02) { this.last[i] = { x: p.x, y: p.y, z: p.z, a: alpha }; return; }
      const dx = p.x - last.x, dz = p.z - last.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) return;
      if (d > 3) { this.last[i] = { x: p.x, y: p.y, z: p.z, a: alpha }; return; }
      const nx = (-dz / d) * width * 0.5, nz = (dx / d) * width * 0.5;
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const v = [last.x - nx, last.y, last.z - nz, last.x + nx, last.y, last.z + nz, p.x - nx, p.y, p.z - nz, p.x + nx, p.y, p.z + nz];
      this.pos.set(v, k * 12);
      for (let j = 0; j < 4; j++) this.col.set([rgb[0], rgb[1], rgb[2], j < 2 ? last.a : alpha], (k * 4 + j) * 4);
      this.last[i] = { x: p.x, y: p.y, z: p.z, a: alpha };
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.mesh.geometry.attributes.color.needsUpdate = true;
    }
    cut(i) { this.last[i] = null; }
    dispose(scene) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
  }

  // ---------- falling snow around the camera ----------
  class Snow {
    constructor(scene, n) {
      this.n = n || 1800;
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(this.n * 3);
      for (let i = 0; i < this.n; i++) {
        this.pos[i * 3] = (Math.random() - 0.5) * 80;
        this.pos[i * 3 + 1] = Math.random() * 40;
        this.pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.t = 0;
    }
    update(dt, cam) {
      this.t += dt;
      const p = this.pos;
      for (let i = 0; i < this.n; i++) {
        p[i * 3 + 1] -= (2.2 + (i % 7) * 0.2) * dt;
        p[i * 3] += Math.sin(this.t + i) * 0.4 * dt;
        if (p[i * 3 + 1] < -5) p[i * 3 + 1] += 40;
      }
      this.points.position.set(cam.position.x, cam.position.y - 15, cam.position.z);
      this.points.geometry.attributes.position.needsUpdate = true;
    }
    dispose(scene) { scene.remove(this.points); this.points.geometry.dispose(); }
  }

  // ---------- manga speed lines overlay ----------
  const SpeedLines = {
    canvas: null, ctx: null, lines: [], frame: 0,
    init(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },
    resize() {
      if (!this.canvas) return;
      const s = Math.min(window.devicePixelRatio || 1, 1.5);
      this.canvas.width = window.innerWidth * s;
      this.canvas.height = window.innerHeight * s;
    },
    draw(intensity, cx, cy) {
      const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
      c.clearRect(0, 0, W, H);
      if (intensity <= 0.01) return;
      this.frame++;
      if (this.frame % 2 === 0 || !this.lines.length) {
        this.lines = [];
        const n = Math.floor(30 + intensity * 70);
        for (let i = 0; i < n; i++) this.lines.push([Math.random() * Math.PI * 2, 0.55 + Math.random() * 0.4, 1 + Math.random() * 3.5, Math.random()]);
      }
      const ox = cx * W, oy = cy * H;
      const R = Math.hypot(W, H) * 0.6;
      this.lines.forEach((l) => {
        const a = l[0];
        const r0 = R * (l[1] + (1 - intensity) * 0.35);
        const x0 = ox + Math.cos(a) * r0, y0 = oy + Math.sin(a) * r0;
        const x1 = ox + Math.cos(a) * R * 1.4, y1 = oy + Math.sin(a) * R * 1.4;
        const w = l[2] * (W / 1280);
        const px = -Math.sin(a) * w, py = Math.cos(a) * w;
        c.fillStyle = l[3] < 0.18 ? 'rgba(27,21,48,' + 0.35 * intensity + ')' : 'rgba(255,255,255,' + 0.55 * intensity + ')';
        c.beginPath();
        c.moveTo(x0, y0);
        c.lineTo(x1 + px, y1 + py);
        c.lineTo(x1 - px, y1 - py);
        c.closePath();
        c.fill();
      });
    },
  };

  // ---------- anime popups ----------
  const FX = {
    popup(text, opts) {
      opts = opts || {};
      const host = document.getElementById('popups');
      if (!host) return;
      const d = document.createElement('div');
      d.className = 'pop ' + (opts.cls || '');
      d.innerHTML = (opts.jp ? '<span class="jp">' + opts.jp + '</span>' : '') + '<span class="main">' + text + '</span>' + (opts.sub ? '<span class="sub">' + opts.sub + '</span>' : '');
      if (opts.color) d.style.setProperty('--pc', opts.color);
      if (opts.x != null) d.style.left = opts.x + '%';
      if (opts.y != null) d.style.top = opts.y + '%';
      host.appendChild(d);
      setTimeout(() => d.remove(), opts.ms || 1400);
    },
    flash(kind) {
      const f = document.getElementById('flash');
      if (!f) return;
      f.className = '';
      void f.offsetWidth;
      f.className = 'on ' + (kind || '');
    },
    Dust, Skids, Snow, SpeedLines,
  };
  AR.FX = FX;
})();
