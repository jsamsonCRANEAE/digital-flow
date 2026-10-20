// Core helpers: namespace, math, seeded noise, storage, and the anime toon/ink material system.
(function () {
  'use strict';
  const AR = (window.AR = window.AR || {});

  // ---------- math ----------
  AR.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  AR.lerp = (a, b, t) => a + (b - a) * t;
  AR.smoothstep = (a, b, x) => {
    const t = AR.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  AR.damp = (a, b, lambda, dt) => AR.lerp(a, b, 1 - Math.exp(-lambda * dt));
  AR.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };

  // Mulberry32 seeded RNG
  AR.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // 2D value noise + fbm (seeded)
  AR.makeNoise = function (seed) {
    const r = AR.rng(seed);
    const perm = new Uint16Array(512);
    const vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      perm[i] = i;
      vals[i] = r() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const h = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
    function noise(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    noise.fbm = function (x, y, oct) {
      let s = 0, amp = 1, f = 1, norm = 0;
      for (let i = 0; i < (oct || 4); i++) {
        s += noise(x * f, y * f) * amp;
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
      }
      return s / norm;
    };
    return noise;
  };

  // ---------- storage ----------
  AR.store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('hayate.' + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem('hayate.' + key, JSON.stringify(val));
      } catch (e) { /* storage unavailable: settings just won't persist */ }
    },
  };

  // ---------- canvas helpers ----------
  AR.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  AR.canvasTex = function (canvas, opts) {
    const t = new THREE.CanvasTexture(canvas);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    if (opts && opts.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
    }
    return t;
  };

  // ---------- toon gradient (3 hard bands = anime cel shading) ----------
  function gradient(steps) {
    const data = new Uint8Array(steps.length * 4);
    steps.forEach((v, i) => {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    });
    const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
  AR.gradients = {
    three: gradient([95, 175, 255]),
    two: gradient([140, 255]),
    soft: gradient([120, 160, 210, 255]),
  };

  // Global stylistic uniforms shared by every toon material (tweaked from settings).
  AR.styleUniforms = {
    uHatch: { value: 1.0 }, // manga screen-tone hatching in shadow
    uHatchSpacing: { value: 7.0 },
    uInk: { value: new THREE.Color(0x1b1530) },
  };

  /**
   * Anime toon material.
   * opts: map, vertexColors, rim (0..1 anime rim light), spec (cel highlight), hatch (bool),
   *       emissive, transparent, opacity, side, gradient ('three'|'two'|'soft')
   */
  AR.toonMat = function (color, opts) {
    opts = opts || {};
    const m = new THREE.MeshToonMaterial({
      color: color == null ? 0xffffff : color,
      gradientMap: AR.gradients[opts.gradient || 'three'],
      map: opts.map || null,
      vertexColors: !!opts.vertexColors,
      transparent: !!opts.transparent,
      opacity: opts.opacity == null ? 1 : opts.opacity,
      side: opts.side || THREE.FrontSide,
      emissive: opts.emissive || 0x000000,
    });
    const rim = opts.rim || 0;
    const spec = opts.spec || 0;
    const hatch = opts.hatch !== false;
    m.userData.toon = { rim, spec, hatch };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uHatch = AR.styleUniforms.uHatch;
      sh.uniforms.uHatchSpacing = AR.styleUniforms.uHatchSpacing;
      sh.uniforms.uRim = { value: rim };
      sh.uniforms.uSpec = { value: spec };
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uHatch;\nuniform float uHatchSpacing;\nuniform float uRim;\nuniform float uSpec;'
        )
        .replace(
          '#include <output_fragment>',
          [
            'vec3 vdir = normalize( vViewPosition );',
            'float ndv = clamp( dot( normal, vdir ), 0.0, 1.0 );',
            // anime rim light: a crisp band on silhouettes
            'float rimBand = smoothstep( 0.60, 0.66, 1.0 - ndv );',
            'outgoingLight += diffuseColor.rgb * rimBand * uRim * 0.9 + vec3(rimBand * uRim * 0.25);',
            '#if NUM_DIR_LIGHTS > 0',
            '  vec3 hdir = normalize( directionalLights[0].direction + vdir );',
            '  float sp = smoothstep( 0.955, 0.965, dot( normal, hdir ) );',
            '  outgoingLight += vec3( sp * uSpec );',
            '#endif',
            hatch
              ? [
                  // screen-tone hatching only in the darkest cel band
                  'float lumO = dot( outgoingLight, vec3(0.299,0.587,0.114) );',
                  'float lumB = max( dot( diffuseColor.rgb, vec3(0.299,0.587,0.114) ), 0.03 );',
                  'float shade = lumO / lumB;',
                  'float hl = abs( fract( ( gl_FragCoord.x + gl_FragCoord.y ) / uHatchSpacing ) - 0.5 );',
                  'float line = 1.0 - smoothstep( 0.10, 0.18, hl );',
                  'float inShadow = 1.0 - smoothstep( 0.55, 0.62, shade );',
                  'outgoingLight *= 1.0 - line * inShadow * 0.22 * uHatch;',
                ].join('\n')
              : '',
            '#include <output_fragment>',
          ].join('\n')
        );
    };
    m.customProgramCacheKey = () => 'toon_' + (hatch ? 1 : 0);
    return m;
  };

  // ---------- inverted-hull ink outlines ----------
  const _outlineMats = {};
  AR.outlineMat = function (thickness, color) {
    const key = thickness + '_' + (color || 'ink');
    if (_outlineMats[key]) return _outlineMats[key];
    const m = new THREE.MeshBasicMaterial({ color: color || AR.styleUniforms.uInk.value, side: THREE.BackSide });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uOutline = { value: thickness };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 outlineNormal;\nuniform float uOutline;')
        .replace('#include <begin_vertex>', 'vec3 transformed = position + outlineNormal * uOutline;');
    };
    m.customProgramCacheKey = () => 'outline';
    _outlineMats[key] = m;
    return m;
  };

  // Averaged normals so hard-edged geometry still gets a closed outline.
  AR.ensureOutlineNormals = function (geo) {
    if (geo.attributes.outlineNormal) return geo;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const map = new Map();
    const key = (i) =>
      Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) + ',' + Math.round(pos.getZ(i) * 1000);
    for (let i = 0; i < pos.count; i++) {
      const k = key(i);
      let a = map.get(k);
      if (!a) map.set(k, (a = [0, 0, 0]));
      a[0] += nor.getX(i);
      a[1] += nor.getY(i);
      a[2] += nor.getZ(i);
    }
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = map.get(key(i));
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      out[i * 3] = a[0] / l;
      out[i * 3 + 1] = a[1] / l;
      out[i * 3 + 2] = a[2] / l;
    }
    geo.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
    return geo;
  };

  // Mesh + its ink hull as a group-friendly pair.
  AR.inked = function (geo, mat, thickness, parent) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (thickness > 0) {
      AR.ensureOutlineNormals(geo);
      const hull = new THREE.Mesh(geo, AR.outlineMat(thickness));
      hull.userData.isOutline = true;
      mesh.add(hull);
    }
    if (parent) parent.add(mesh);
    return mesh;
  };

  // Sutherland–Hodgman polygon clip against half-plane a*x + b*y <= c
  AR.clipPoly = function (pts, a, b, c) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
      if (dp <= 0) out.push(p);
      if ((dp <= 0) !== (dq <= 0)) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  };

  // Chaikin corner cutting for soft, car-like silhouettes.
  AR.chaikin = function (pts, iters, ratio) {
    ratio = ratio || 0.22;
    let p = pts;
    for (let k = 0; k < iters; k++) {
      const o = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if (a[2] || 0) { o.push(a); } // sharp-flagged point kept as-is
        else o.push([a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]);
        o.push([a[0] + (b[0] - a[0]) * (1 - ratio), a[1] + (b[1] - a[1]) * (1 - ratio)]);
      }
      p = o;
    }
    return p;
  };

  // Polygon inset (convex-ish polygons, CCW or CW handled by sign test)
  AR.insetPoly = function (pts, d) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    const s = area > 0 ? 1 : -1;
    const lines = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      const nx = -dy * s, ny = dx * s; // inward normal
      lines.push([p[0] + nx * d, p[1] + ny * d, dx, dy]);
    }
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const A = lines[(i + lines.length - 1) % lines.length], B = lines[i];
      const den = A[2] * B[3] - A[3] * B[2];
      if (Math.abs(den) < 1e-6) { out.push([B[0], B[1]]); continue; }
      const t = ((B[0] - A[0]) * B[3] - (B[1] - A[1]) * B[2]) / den;
      out.push([A[0] + A[2] * t, A[1] + A[3] * t]);
    }
    return out;
  };

  AR.fmtTime = function (t) {
    if (t == null || !isFinite(t)) return '--:--.---';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  };
})();
