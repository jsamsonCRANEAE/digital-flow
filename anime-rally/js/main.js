// Game flow: renderer, garage, menus, race loop, camera, FX hookup, ghosts, scoring.
(function () {
  'use strict';
  const AR = window.AR;
  const $ = (id) => document.getElementById(id);
  const Input = AR.Input, Menu = AR.Menu, HUD = AR.HUD, Audio = AR.Audio, FX = AR.FX;

  // ---------- settings ----------
  const DEFAULTS = {
    units: 'mph', manual: false, assist: 'medium', tc: true, abs: true, speedLines: true, hatch: true,
    shadows: true, res: 'balanced', volume: 0.7, vibration: true, voice: true, ghost: true, shake: true,
    curve: 1.35, deadzone: 0.1,
  };
  AR.settings = Object.assign({}, DEFAULTS, AR.store.get('settings', {}));
  const S = AR.settings;
  const ASSIST = { off: 0, low: 0.25, medium: 0.45, high: 0.7 };
  function saveSettings() { AR.store.set('settings', S); applySettings(); }

  // ---------- renderer ----------
  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (race && race.dust) race.dust.setScale(h);
  }
  function applySettings() {
    const pr = { performance: 0.75, balanced: 1, sharp: 1.5 }[S.res] || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * pr);
    AR.styleUniforms.uHatch.value = S.hatch ? 1 : 0;
    Input.settings.curve = S.curve;
    Input.settings.deadzone = S.deadzone;
    Audio.setVolume(S.volume);
    if (race) {
      race.sun.castShadow = S.shadows;
      race.vehicle.settings = physSettings();
    }
    resize();
  }
  function physSettings() {
    return { steerAssist: ASSIST[S.assist], tc: S.tc, abs: S.abs, manual: S.manual };
  }
  window.addEventListener('resize', resize);
  FX.SpeedLines.init($('speedlines'));
  HUD.init();

  // ---------- garage scene ----------
  const garage = { scene: new THREE.Scene(), car: null, angle: 0.6, spin: true, drag: null };
  {
    const g = garage.scene;
    const c = AR.canvas(1024, 576), x = c.getContext('2d');
    const grd = x.createRadialGradient(512, 300, 40, 512, 300, 700);
    grd.addColorStop(0, '#ffe6f2');
    grd.addColorStop(0.45, '#ff9cc4');
    grd.addColorStop(1, '#5a3cb8');
    x.fillStyle = grd;
    x.fillRect(0, 0, 1024, 576);
    x.save(); x.translate(512, 300);
    for (let i = 0; i < 72; i++) {
      x.rotate((Math.PI * 2) / 72);
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.16)' : 'rgba(90,60,184,0.08)';
      x.beginPath(); x.moveTo(0, 0); x.lineTo(900, -30); x.lineTo(900, 30); x.fill();
    }
    x.restore();
    for (let yy = 0; yy < 576; yy += 14) for (let xx = (yy / 14) % 2 * 7; xx < 1024; xx += 14) {
      const d = Math.hypot(xx - 512, yy - 300) / 600;
      x.fillStyle = 'rgba(27,21,48,' + 0.12 * d + ')';
      x.beginPath(); x.arc(xx, yy, 2.4 * d, 0, Math.PI * 2); x.fill();
    }
    const bg = AR.canvasTex(c);
    g.background = bg;
    const floor = AR.inked(new THREE.CylinderGeometry(5.2, 5.4, 0.3, 48), AR.toonMat(0xf4f0ff, { rim: 0.2 }), 0.05, g);
    floor.position.y = -0.15;
    floor.castShadow = false;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.06, 6, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5d8f }));
    ring.position.y = 0.01;
    g.add(ring);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9a86c8, 0.5);
    g.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.72);
    sun.position.set(4, 8, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6; sun.shadow.camera.right = 6; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
    sun.shadow.bias = -0.0008;
    g.add(sun);
  }
  canvas.addEventListener('pointerdown', (e) => { garage.drag = e.clientX; garage.spin = false; });
  window.addEventListener('pointerup', () => { garage.drag = null; });
  window.addEventListener('pointermove', (e) => {
    if (garage.drag != null && state !== 'race') { garage.angle += (e.clientX - garage.drag) * 0.01; garage.drag = e.clientX; }
  });

  function disposeObj(o) {
    o.traverse((m) => {
      if (m.geometry) m.geometry.dispose();
      if (m.material && !m.userData.isOutline) {
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => mt.dispose());
      }
    });
  }

  // ---------- player car config ----------
  let carIdx = Math.max(0, AR.CARS.findIndex((c) => c.id === AR.store.get('car', 'raijin')));
  const configs = {};
  function cfgFor(def) {
    if (!configs[def.id]) configs[def.id] = Object.assign(AR.defaultConfig(def), AR.store.get('cfg.' + def.id, {}));
    return configs[def.id];
  }
  function saveCfg(def) { AR.store.set('cfg.' + def.id, cfgFor(def)); AR.store.set('car', def.id); }
  let rebuildTimer = 0;
  function rebuildGarageCar() {
    const def = AR.CARS[carIdx];
    if (garage.car) { garage.scene.remove(garage.car.root); disposeObj(garage.car.root); }
    garage.car = AR.buildCarModel(def, cfgFor(def));
    garage.scene.add(garage.car.root);
    showCarSide();
  }
  function showCarSide() {
    const def = AR.CARS[carIdx], cfg = cfgFor(def), p = AR.carPhysics(def, cfg);
    const bar = (label, v) => '<div class="stat"><span>' + label + '</span><div class="b"><i style="width:' + Math.round(AR.clamp(v, 0.05, 1) * 100) + '%"></i></div></div>';
    const hp = Math.round((p.torque * (p.ev ? p.redline * 0.38 : p.redline * 0.75) * 2 * Math.PI) / 60 / 745.7 * (p.ev ? 1 : 0.92));
    AR.side(
      '<h2>' + def.name + '</h2><div class="jp">' + def.jp + ' · ' + def.year + '</div>' +
      '<div class="cls">' + def.cls + ' · ' + p.drive + '</div>' +
      '<p>' + def.desc + '</p>' +
      bar('Power', hp / 450) + bar('Lightness', 1 - (p.mass - 800) / 1400) +
      bar('Grip', (AR.GRIP[p.tires][1] - 0.4) / 0.6) + bar('Stability', 1 - (p.cgH - 0.4) / 0.5) +
      bar('Off-road', (p.restLen + p.heightOffset - 0.15) / 0.25) +
      '<p><b>~' + hp + ' hp</b> · ' + p.mass + ' kg · ' + (p.ev ? 'single-speed EV' : p.gears.length + '-speed') + '</p>' +
      '<p class="ins">Fictional homage inspired by the ' + def.inspired + '.</p>'
    );
  }

  // ---------- state ----------
  let state = 'title';
  let race = null;
  let stageIdx = AR.store.get('stage', 0);
  let lastT = performance.now();

  // ---------- menus ----------
  function titleScreen() {
    state = 'title';
    Menu.close();
    $('title').classList.remove('hidden');
    HUD.show(false);
    if (!garage.car) rebuildGarageCar();
    AR.side(null);
    updatePadStatus();
  }
  function updatePadStatus() {
    const pads = Input.pads();
    $('padstatus').textContent = pads.length ? '🎮 ' + pads[0].id.replace(/\(.*?\)/g, '').trim().slice(0, 50) + ' connected' : '🎮 No controller yet: pair it in Windows Bluetooth settings, then press any button';
  }
  AR.onPad = (on, id) => {
    updatePadStatus();
    FX.popup(on ? 'CONTROLLER READY!' : 'CONTROLLER LOST', { cls: 'small', y: 85, sub: id.replace(/\(.*?\)/g, '').slice(0, 40), color: on ? '#5ff0d6' : '#ff5d8f' });
    if (!on && state === 'race' && race && race.phase === 'running') pauseMenu();
  };

  function mainMenu(sel) {
    state = 'menu';
    if (!garage.car) rebuildGarageCar();
    AR.side(null);
    Menu.open('HAYATE RALLY', '疾風ラリー', [
      { label: 'RACE', action: stageSelect },
      { label: 'GARAGE', action: garageMenu },
      { label: 'CONTROLS', action: controlsMenu },
      { label: 'SETTINGS', action: settingsMenu },
      { label: 'HOW TO PLAY', action: howTo },
      { label: 'FULLSCREEN', action: () => { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {}); else if (document.exitFullscreen) document.exitFullscreen(); } },
    ], { sel, onBack: titleScreen });
  }

  function howTo() {
    AR.side(
      '<h2>HOW TO PLAY</h2><div class="jp">あそびかた</div>' +
      '<p><b>Controller</b> (Xbox / PlayStation / Switch Pro / most Bluetooth pads)</p>' +
      '<p>Left stick: steer · RT/R2: throttle · LT/L2: brake (hold when stopped = reverse)<br>A/✕: handbrake · RB/LB: shift (manual) · Y/△: camera · B/○: look back<br>View/Share: reset to road · Menu/Options: pause</p>' +
      '<p><b>Keyboard</b>: arrows/WASD, Space handbrake, Q/E shift, C camera, R reset, Esc pause.</p>' +
      '<p><b>Goal</b>: clear all 20 gates as fast as you can. Your co-driver calls the corners: 6 = flat out, 1 = very tight. Banked corners let you carry more speed.</p>' +
      '<p>Hold drift angle for <b>DRIFT</b> points. Beat your <b>ghost</b> (cyan car).</p>'
    );
    Menu.open('HOW TO PLAY', 'あそびかた', [{ label: 'BACK', action: () => mainMenu(4) }], { onBack: () => mainMenu(4) });
  }

  function stageSelect() {
    state = 'menu';
    const items = AR.STAGES.map((st, i) => ({
      label: st.name.toUpperCase(),
      display: () => AR.fmtTime(AR.store.get('best.' + st.id, null)),
      action: () => { stageIdx = i; AR.store.set('stage', i); startRace(); },
      onFocus: () => {
        const best = AR.store.get('best.' + st.id, null);
        const bc = AR.store.get('bestcar.' + st.id, null);
        AR.side('<h2>' + st.name + '</h2><div class="jp">' + st.jp + '</div><div class="cls">' + AR.SURF_NAMES[st.road].toUpperCase() + ' · 20 GATES</div><p>' + st.desc + '</p>' +
          '<div class="res-row"><span>Best</span><span>' + AR.fmtTime(best) + '</span></div>' +
          (bc ? '<div class="res-row"><span>Set with</span><span>' + bc + '</span></div>' : '') +
          '<p class="ins">Tip: ' + (st.road === AR.SURF.SNOW ? 'snow tyres help a lot here.' : st.road === AR.SURF.TARMAC ? 'street tyres grip best on tarmac.' : 'gravel tyres + handbrake for the hairpins.') + '</p>');
      },
    }));
    items.unshift({
      label: 'CAR', values: () => AR.CARS.map((c, i) => i), get: () => carIdx,
      set: (v) => { carIdx = v; AR.store.set('car', AR.CARS[v].id); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildGarageCar, 60); },
      display: (v) => AR.CARS[v].name, onFocus: showCarSide,
    });
    items.push({ label: 'BACK', action: () => mainMenu(0) });
    Menu.open('SELECT STAGE', 'ステージ', items, { sel: stageIdx + 1, onBack: () => mainMenu(0) });
  }

  function garageMenu(sel) {
    state = 'garage';
    const def = () => AR.CARS[carIdx];
    const C = () => cfgFor(def());
    const changed = () => { saveCfg(def()); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildGarageCar, 80); };
    const opt = (label, key, vals, disp) => ({ label, values: vals, get: () => C()[key], set: (v) => { C()[key] = v; changed(); }, display: disp || ((v) => String(v).toUpperCase()) });
    const nums = []; for (let i = 1; i <= 99; i++) nums.push(i);
    const items = [
      { label: 'CAR', values: AR.CARS.map((c, i) => i), get: () => carIdx, set: (v) => { carIdx = v; AR.store.set('car', AR.CARS[v].id); clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildGarageCar, 60); }, display: (v) => AR.CARS[v].name + " '" + String(AR.CARS[v].year).slice(2) },
      Object.assign(opt('PAINT', 'paint', AR.PAINTS.map((p) => p.c).concat(AR.CARS.map((c) => c.paint)).filter((v, i, a) => a.indexOf(v) === i), (v) => { const p = AR.PAINTS.find((x) => x.c === v); return p ? p.n.toUpperCase() : 'FACTORY'; }), { swatch: true }),
      Object.assign(opt('ACCENT', 'accent', AR.ACCENTS.concat([C().accent]).filter((v, i, a) => a.indexOf(v) === i), () => ''), { swatch: true }),
      opt('ROOF', 'roof', AR.OPTIONS.roof, (v) => (v === 'accent' ? 'TWO-TONE' : 'BODY')),
      opt('LIVERY', 'livery', AR.OPTIONS.livery),
      opt('NUMBER', 'number', nums),
      { label: 'PLATE', text: true, get: () => C().plate, set: (v) => { C().plate = v; changed(); } },
      opt('RIMS', 'rims', AR.OPTIONS.rims),
      Object.assign(opt('RIM COLOR', 'rimColor', AR.RIM_COLORS, () => ''), { swatch: true }),
      opt('SPOILER', 'spoiler', AR.OPTIONS.spoiler),
      opt('RALLY LIGHTS', 'lights', AR.OPTIONS.lights),
      opt('MUDFLAPS', 'mudflaps', [false, true], (v) => (v ? 'ON' : 'OFF')),
      opt('RIDE HEIGHT', 'height', AR.OPTIONS.height),
      opt('WINDOW TINT', 'tint', AR.OPTIONS.tint),
      opt('TYRES', 'tires', AR.OPTIONS.tires),
      opt('ENGINE TUNE', 'tune', AR.OPTIONS.tune),
      opt('SUSPENSION', 'susp', AR.OPTIONS.susp),
      opt('DRIVETRAIN', 'drive', AR.OPTIONS.drive),
      { label: 'RANDOMIZE STYLE', action: () => {
        const r = Math.random, pick = (a) => a[Math.floor(r() * a.length)];
        Object.assign(C(), { paint: pick(AR.PAINTS).c, accent: pick(AR.ACCENTS), livery: pick(AR.OPTIONS.livery), rims: pick(AR.OPTIONS.rims), rimColor: pick(AR.RIM_COLORS), spoiler: pick(AR.OPTIONS.spoiler), lights: pick(AR.OPTIONS.lights), roof: pick(AR.OPTIONS.roof), number: 1 + Math.floor(r() * 99), mudflaps: r() > 0.5 });
        changed(); garageMenu(Menu.sel);
      } },
      { label: 'RESET TO FACTORY', action: () => { configs[def().id] = AR.defaultConfig(def()); changed(); garageMenu(Menu.sel); } },
      { label: 'RACE!', action: stageSelect },
      { label: 'BACK', action: () => mainMenu(1) },
    ];
    Menu.open('GARAGE', 'ガレージ', items, { sel: sel || 0, onBack: () => mainMenu(1), foot: 'Ⓐ select · Ⓑ back · ◀ ▶ change · right stick / drag to spin' });
    showCarSide();
  }

  function settingsMenu() {
    state = 'menu';
    AR.side(null);
    const opt = (label, key, vals, disp) => ({ label, values: vals, get: () => S[key], set: (v) => { S[key] = v; saveSettings(); }, display: disp || ((v) => (v === true ? 'ON' : v === false ? 'OFF' : String(v).toUpperCase())) });
    Menu.open('SETTINGS', 'せってい', [
      opt('UNITS', 'units', ['mph', 'km/h']),
      opt('GEARBOX', 'manual', [false, true], (v) => (v ? 'MANUAL' : 'AUTO')),
      opt('STEERING ASSIST', 'assist', ['off', 'low', 'medium', 'high']),
      opt('TRACTION CONTROL', 'tc', [true, false]),
      opt('ABS', 'abs', [true, false]),
      opt('SPEED LINES', 'speedLines', [true, false]),
      opt('INK HATCHING', 'hatch', [true, false]),
      opt('SHADOWS', 'shadows', [true, false]),
      opt('RESOLUTION', 'res', ['performance', 'balanced', 'sharp']),
      opt('VOLUME', 'volume', [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], (v) => Math.round(v * 100) + '%'),
      opt('VIBRATION', 'vibration', [true, false]),
      opt('CO-DRIVER VOICE', 'voice', [true, false]),
      opt('GHOST CAR', 'ghost', [true, false]),
      opt('CAMERA SHAKE', 'shake', [true, false]),
      { label: 'BACK', action: () => (race ? pauseMenu() : mainMenu(3)) },
    ], { onBack: () => (race ? pauseMenu() : mainMenu(3)) });
  }

  let capturing = null;
  function controlsMenu(sel) {
    state = 'controls';
    const items = Object.keys(AR.BIND_LABELS).map((k) => ({
      label: capturing === k ? '▶ PRESS INPUT FOR ' + AR.BIND_LABELS[k].toUpperCase() + '…' : AR.BIND_LABELS[k].toUpperCase(),
      display: () => (Input.binds ? Input.bindName(Input.binds[k]) : '—'),
      action: () => {
        if (!Input.activePad()) { FX.popup('NO CONTROLLER', { cls: 'small', y: 80, color: '#ff5d8f' }); return; }
        capturing = k;
        const at = Menu.sel;
        controlsMenu(at);
        // wait for the A/Enter press that triggered this to be released
        setTimeout(() => Input.startCapture(k, () => { capturing = null; controlsMenu(at); }), 350);
      },
    }));
    items.push(
      { label: 'STEERING CURVE', values: [1.0, 1.35, 1.7], get: () => S.curve, set: (v) => { S.curve = v; saveSettings(); }, display: (v) => (v === 1 ? 'LINEAR' : v < 1.5 ? 'SMOOTH' : 'EXTRA SMOOTH') },
      { label: 'STICK DEADZONE', values: [0.05, 0.1, 0.15, 0.2], get: () => S.deadzone, set: (v) => { S.deadzone = v; saveSettings(); }, display: (v) => Math.round(v * 100) + '%' },
      { label: 'TEST RUMBLE', action: () => Input.rumble(1, 0.6, 400) },
      { label: 'RESET TO DEFAULTS', action: () => { Input.resetBinds(); controlsMenu(Menu.sel); } },
      { label: 'BACK', action: () => mainMenu(2) }
    );
    Menu.open('CONTROLS', 'そうさ', items, { sel: sel || 0, onBack: () => { capturing = null; Input.capture = null; mainMenu(2); }, foot: 'Ⓐ rebind · Esc cancels a rebind · bindings are saved per controller' });
  }
  function controlsLive() {
    const p = Input.rawPad();
    if (!p) {
      AR.side('<h2>NO CONTROLLER</h2><div class="jp">コントローラー</div><p>1. On Windows open <b>Settings → Bluetooth &amp; devices → Add device</b>.<br>2. Put your pad in pairing mode (Xbox: hold the pair button; DualSense: hold Create + PS; Switch Pro: hold the sync button).<br>3. Come back here and <b>press any button</b>: browsers only reveal a controller after a button press.</p><p class="ins">Chrome or Edge recommended. Xbox, DualShock 4, DualSense and Switch Pro use the standard layout automatically; for other pads, rebind each action here.</p>');
      return;
    }
    const ax = p.axes.map((a, i) => 'A' + i + ' ' + (a >= 0 ? ' ' : '') + a.toFixed(2)).join('  ');
    const bt = p.buttons.map((b, i) => (b.value > 0.1 ? i + ':' + b.value.toFixed(1) : null)).filter(Boolean).join(' ');
    const s = Input.state;
    AR.side('<h2>CONTROLLER</h2><div class="jp">' + (p.mapping === 'standard' ? 'standard layout ✓' : 'custom layout: rebind if needed') + '</div>' +
      '<p class="ins">' + p.id.slice(0, 80) + '</p>' +
      '<div class="stat"><span>Steer</span><div class="b"><i style="width:' + ((s.steer + 1) * 50).toFixed(0) + '%"></i></div></div>' +
      '<div class="stat"><span>Throttle</span><div class="b"><i style="width:' + (s.throttle * 100).toFixed(0) + '%"></i></div></div>' +
      '<div class="stat"><span>Brake</span><div class="b"><i style="width:' + (s.brake * 100).toFixed(0) + '%"></i></div></div>' +
      '<div class="stat"><span>Handbrake</span><div class="b"><i style="width:' + (s.handbrake * 100).toFixed(0) + '%"></i></div></div>' +
      '<div class="live">' + ax + '\nbuttons: ' + (bt || '—') + '</div>');
  }

  function pauseMenu() {
    if (!race) return;
    state = 'paused';
    race.paused = true;
    HUD.msg('');
    Menu.open('PAUSED', 'ポーズ', [
      { label: 'RESUME', action: resume },
      { label: 'RESTART', action: () => { Menu.close(); startRace(); } },
      { label: 'SETTINGS', action: settingsMenu },
      { label: 'QUIT TO GARAGE', action: () => { endRace(); garageMenu(); } },
      { label: 'MAIN MENU', action: () => { endRace(); mainMenu(0); } },
    ], { onBack: resume });
  }
  function resume() {
    Menu.close();
    state = 'race';
    race.paused = false;
  }

  // ---------- race ----------
  function startRace() {
    if (race) endRace();
    Menu.close();
    $('title').classList.add('hidden');
    $('loading').classList.remove('hidden');
    setTimeout(buildRace, 30);
  }
  function buildRace() {
    const st = AR.STAGES[stageIdx];
    const def = AR.CARS[carIdx], cfg = cfgFor(def);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(st.fog, st.fogNear, st.fogFar);
    scene.background = new THREE.Color(st.fog);
    const hemi = new THREE.HemisphereLight(st.hemi[0], st.hemi[1], st.hemiI);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(st.sun, st.sunI);
    sun.castShadow = S.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    const sunDir = new THREE.Vector3(0.4, 0.55, -0.7).normalize();

    const stage = AR.buildStage(st, scene);
    const p = AR.carPhysics(def, cfg);
    const vehicle = new AR.Vehicle(p, stage, physSettings());
    const sp = stage.startPose(10);
    vehicle.reset(sp.pos, sp.dir);
    const car = AR.buildCarModel(def, cfg);
    const carRoot = new THREE.Group();
    carRoot.add(car.root);
    car.root.position.y = -p.cgH;
    scene.add(carRoot);

    // ghost
    let ghost = null;
    const gdata = S.ghost ? AR.store.get('ghost.' + st.id, null) : null;
    if (gdata && gdata.f && gdata.f.length > 14) {
      const gdef = AR.CARS.find((c) => c.id === gdata.car) || def;
      const gm = AR.buildCarModel(gdef, Object.assign(AR.defaultConfig(gdef), gdata.cfg || {}), { ghost: true });
      const groot = new THREE.Group();
      groot.add(gm.root);
      gm.root.position.y = -gdef.phys.cgH;
      scene.add(groot);
      ghost = { data: gdata, root: groot, pos: new THREE.Vector3() };
    }

    const dust = new FX.Dust(scene, 700);
    dust.setScale(window.innerHeight);
    const skids = new FX.Skids(scene, 3500);
    const snow = st.snowFall ? new FX.Snow(scene, 1800) : null;

    race = {
      st, def, cfg, p, scene, stage, vehicle, car, carRoot, sun, sunDir, ghost, dust, skids, snow,
      phase: 'countdown', cd: 3.6, cdShown: 4, time: 0, paused: false,
      progress: -10, lastS: null, gate: 0, gateS: stage.gates.map((g) => g.s), splits: [],
      bestSplits: AR.store.get('splits.' + st.id, null),
      drift: { on: false, pts: 0, t: 0, off: 0, mult: 1, total: 0 },
      resets: 0, topSpeed: 0, wrongT: 0, flipT: 0, stuckT: 0, rumbleT: 0, finishT: 0,
      rec: [], recT: 0, camMode: AR.store.get('cam', 0), camPos: null, camLook: new THREE.Vector3(), fov: 62, shake: 0,
      emit: [0, 0, 0, 0],
    };
    resize();
    Audio.init();
    Audio.startCar(def.sound);
    AR.CoDriver.reset();
    AR.CoDriver.say('READY? ' + st.name.toUpperCase(), 'いくよ！ ' + st.jp, null);
    highlightGate();
    $('loading').classList.add('hidden');
    HUD.show(true);
    HUD.msg('');
    HUD.hint(Input.lastDevice === 'pad' ? 'Hold RT to rev · go on GO!' : 'Hold ↑ to rev · go on GO!');
    state = 'race';
  }
  function endRace() {
    if (!race) return;
    Audio.stopCar();
    race.stage.dispose();
    disposeObj(race.carRoot);
    race.dust.dispose(race.scene);
    race.skids.dispose(race.scene);
    if (race.snow) race.snow.dispose(race.scene);
    if (race.ghost) disposeObj(race.ghost.root);
    race = null;
    HUD.show(false);
    FX.SpeedLines.draw(0, 0.5, 0.5);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }
  function highlightGate() {
    race.stage.gates.forEach((g, i) => {
      g.obj.userData.glow.visible = i === race.gate;
    });
  }

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
  const surfDust = {};
  surfDust[AR.SURF.GRAVEL] = new THREE.Color(0xd2b48c);
  surfDust[AR.SURF.SNOW] = new THREE.Color(0xf4f8ff);
  surfDust[AR.SURF.SAND] = new THREE.Color(0xe8d2a6);
  surfDust[AR.SURF.GRASS] = new THREE.Color(0xa8a070);
  surfDust[AR.SURF.TARMAC] = new THREE.Color(0xe8e8ee);
  const skidCol = {};
  skidCol[AR.SURF.GRAVEL] = [0.36, 0.27, 0.19];
  skidCol[AR.SURF.SNOW] = [0.55, 0.64, 0.8];
  skidCol[AR.SURF.SAND] = [0.55, 0.43, 0.3];
  skidCol[AR.SURF.GRASS] = [0.3, 0.32, 0.18];
  skidCol[AR.SURF.TARMAC] = [0.08, 0.08, 0.1];

  function updateRace(dt, inp) {
    const R = race, v = R.vehicle, stage = R.stage, tm = v.tm;
    if (R.paused) return;
    let simDt = dt;
    const vin = { steer: inp.steer, throttle: inp.throttle, brake: inp.brake, handbrake: inp.handbrake, shiftUp: inp.shiftUp, shiftDown: inp.shiftDown };
    inp.shiftUp = inp.shiftDown = false;

    if (R.phase === 'countdown') {
      R.cd -= dt;
      const n = Math.ceil(R.cd - 0.6);
      if (n < R.cdShown && n >= 1 && n <= 3) { R.cdShown = n; HUD.countdown(String(n)); Audio.tone(520, 0.18, 0.08, 'square'); Input.rumble(0.2, 0.1, 80); }
      if (R.cd <= 0.6) {
        R.phase = 'running';
        HUD.countdown('GO!', true);
        HUD.hint('');
        Audio.tone(1040, 0.4, 0.09, 'square');
        Input.rumble(0.5, 0.3, 160);
        FX.popup('GO!!', { jp: 'いけっ！', y: 40, cls: 'burst', ms: 900 });
      }
      vin.brake = 1; vin.handbrake = 1; vin.throttle = 0; vin.hold = true;
      v.update(dt, vin);
      v.rpm = AR.lerp(v.rpm, (v.p.idle || 0) + inp.throttle * v.p.redline * 0.75, 0.15);
      v.tm.rpm = v.rpm;
      v.tm.throttle = inp.throttle;
    } else if (R.phase === 'running') {
      R.time += dt;
      v.update(dt, vin);
    } else if (R.phase === 'finished') {
      simDt = dt * 0.45;
      vin.throttle = 0; vin.brake = 0.35; vin.handbrake = 0;
      v.update(simDt, vin);
      R.finishT += dt;
      if (R.finishT > 3.2 && state === 'race') resultsScreen();
    }

    // ---- events ----
    v.events.forEach((e) => {
      if (e.type === 'shift') Audio.shift();
      else if (e.type === 'crash') {
        if (e.v > 2) { Audio.crash(e.v); Input.rumble(Math.min(1, e.v / 10), Math.min(1, e.v / 8), 220); R.shake = Math.max(R.shake, Math.min(1, e.v / 12)); }
        if (e.v > 7 && R.phase === 'running') {
          FX.flash('crash');
          FX.popup('CRASH!', { jp: 'ドカーン！', color: '#ff5d8f', y: 38 });
          if (R.drift.on) { R.drift.on = false; R.drift.pts = 0; HUD.drift(false); FX.popup('DRIFT LOST', { cls: 'small', y: 55, color: '#999' }); }
        }
      } else if (e.type === 'land') {
        Audio.land(e.t);
        Input.rumble(Math.min(1, e.t), 0.4, 200);
        R.shake = Math.max(R.shake, Math.min(0.8, e.t * 0.5));
        if (e.t > 0.9 && R.phase === 'running') FX.popup('BIG AIR!', { jp: 'ジャンプ！', sub: e.t.toFixed(1) + 's', y: 34, color: '#5ff0d6' });
        for (let k = 0; k < 24; k++) {
          const a = Math.random() * Math.PI * 2;
          R.dust.emit(v.pos.x + Math.cos(a) * 1.5, v.pos.y - v.p.cgH + 0.3, v.pos.z + Math.sin(a) * 1.5, Math.cos(a) * 5, 1.5, Math.sin(a) * 5, 2.2, 1.6, surfDust[tm.surf] || surfDust[1], 0.8);
        }
      }
    });

    // ---- progress & gates ----
    const pr = stage.project(v.pos.x, v.pos.z);
    if (pr) {
      if (R.lastS == null) R.lastS = pr.s;
      let d = pr.s - R.lastS;
      const L = stage.length;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      if (Math.abs(d) < 40) R.progress += d;
      R.lastS = pr.s;
      R.progIdx = pr.i;
      if (R.phase === 'running') {
        while (R.gate < R.gateS.length && R.progress >= R.gateS[R.gate]) passGate();
        // wrong way
        const t = stage.T[pr.i];
        const along = v.vel.x * t.x + v.vel.z * t.z;
        R.wrongT = along < -4 ? R.wrongT + dt : Math.max(0, R.wrongT - dt * 2);
        const far = Math.abs(pr.lat) > stage.halfRoad + 25;
        HUD.msg(R.wrongT > 1.5 ? 'WRONG WAY!<br><span style="font-size:28px">逆走</span>' : '');
        const up = _v.set(0, 1, 0).applyQuaternion(v.q).y;
        R.flipT = up < 0.25 ? R.flipT + dt : 0;
        R.stuckT = tm.speed < 1 && inp.throttle > 0.5 ? R.stuckT + dt : 0;
        if (R.flipT > 2.0) resetCar();
        const resetKey = Input.lastDevice === 'pad' ? Input.bindName(Input.binds && Input.binds.reset) : 'R';
        HUD.hint(far || R.stuckT > 3 || R.wrongT > 3 ? 'Press <b>' + resetKey + '</b> to reset to the road' : '');
        AR.CoDriver.update(dt, stage, pr.i, tm.speed, R.time);
      }
    }
    if (inp.reset && R.phase === 'running') resetCar();

    // ---- drift scoring ----
    const ang = Math.abs(tm.drift) * (180 / Math.PI);
    const D = R.drift;
    if (R.phase === 'running' && !tm.airborne && tm.speed > 11 && ang > 12 && ang < 110 && tm.fwd > 0) {
      if (!D.on) { D.on = true; D.pts = 0; D.t = 0; }
      D.t += dt;
      D.off = 0;
      D.mult = Math.min(5, 1 + Math.floor(D.t / 1.8));
      D.pts += ang * tm.speed * dt * 0.6 * D.mult;
      HUD.drift(true, D.pts, D.mult);
    } else if (D.on) {
      D.off += dt;
      if (D.off > 0.7) {
        D.on = false;
        HUD.drift(false);
        if (D.pts > 250) {
          D.total += D.pts;
          FX.popup(D.pts > 3000 ? 'MEGA DRIFT!!' : 'DRIFT!', { jp: 'ドリフト', sub: '+' + Math.round(D.pts).toLocaleString(), y: 30, x: 70, cls: D.pts > 3000 ? 'burst' : '', color: '#ffd83a' });
        }
      }
    }

    // ---- ghost ----
    if (R.phase === 'running') {
      R.recT += dt;
      while (R.recT >= 0.05) {
        R.recT -= 0.05;
        const r3 = (x) => Math.round(x * 1000) / 1000;
        R.rec.push(r3(v.pos.x), r3(v.pos.y), r3(v.pos.z), r3(v.q.x), r3(v.q.y), r3(v.q.z), r3(v.q.w));
      }
    }
    if (R.ghost) {
      const f = R.ghost.data.f, n = f.length / 7;
      const t = R.time / 0.05;
      const i = Math.min(n - 2, Math.floor(t)), a = AR.clamp(t - i, 0, 1);
      if (i >= 0) {
        const o = i * 7, o2 = (i + 1) * 7;
        R.ghost.root.position.set(AR.lerp(f[o], f[o2], a), AR.lerp(f[o + 1], f[o2 + 1], a), AR.lerp(f[o + 2], f[o2 + 2], a));
        _q.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
        R.ghost.root.quaternion.set(f[o2 + 3], f[o2 + 4], f[o2 + 5], f[o2 + 6]);
        R.ghost.root.quaternion.copy(_q.slerp(R.ghost.root.quaternion, a));
        // fade the ghost when it overlaps the player
        R.ghost.root.visible = R.ghost.root.position.distanceTo(v.pos) > 2.5;
      }
    }

    // ---- car visual ----
    R.carRoot.position.copy(v.pos);
    R.carRoot.quaternion.copy(v.q);
    v.wheels.forEach((w, i) => {
      const vw = R.car.wheels[i];
      vw.pivot.position.y = v.mountY - w.susLen + v.p.cgH;
      vw.pivot.rotation.y = w.front ? -v.steerAngle : 0;
      vw.spin.rotation.x = -w.spin;
    });
    const braking = (v.gear === -1 ? inp.throttle : inp.brake) > 0.1 || inp.handbrake > 0.3;
    R.car.tailMat.emissiveIntensity = braking ? 1.4 : 0.25;
    R.topSpeed = Math.max(R.topSpeed, tm.speed);

    // ---- fx: dust, tracks ----
    v.wheels.forEach((w, i) => {
      if (!w.contact) { R.skids.cut(i); return; }
      const loose = w.surf !== AR.SURF.TARMAC;
      let alpha = 0;
      if (loose) alpha = AR.clamp(0.16 + w.slip * 0.06, 0, 0.55);
      else if (w.slip > 2.5) alpha = AR.clamp((w.slip - 2.5) * 0.15, 0, 0.6);
      _v.copy(w.cp);
      _v.y = stage.groundRaw(_v.x, _v.z).h + 0.045;
      R.skids.add(i, _v, 0, 0, v.p.tireW || 0.24, alpha, skidCol[w.surf] || skidCol[1]);
      const rate = loose ? (i >= 2 || w.slip > 2 ? tm.speed * 0.45 + w.slip * 5 : tm.speed * 0.1) : w.slip > 4 ? w.slip * 4 : 0;
      R.emit[i] += rate * simDt;
      const col = surfDust[w.surf] || surfDust[1];
      while (R.emit[i] >= 1) {
        R.emit[i] -= 1;
        const sp = 1.2 + Math.random() * 1.6;
        R.dust.emit(
          w.cp.x + (Math.random() - 0.5) * 0.4, w.cp.y + 0.25, w.cp.z + (Math.random() - 0.5) * 0.4,
          -v.vel.x * 0.18 + (Math.random() - 0.5) * sp, 0.6 + Math.random() * 1.4, -v.vel.z * 0.18 + (Math.random() - 0.5) * sp,
          (loose ? 0.9 : 0.7) + Math.random() * 0.8 + Math.min(1.0, tm.speed / 40), 0.9 + Math.random() * 0.9, col, loose ? 0.6 : 0.45
        );
      }
    });
    R.dust.update(simDt);
    if (R.snow) R.snow.update(dt, camera);

    // ---- rumble ----
    R.rumbleT -= dt;
    if (R.rumbleT <= 0 && R.phase !== 'countdown') {
      R.rumbleT = 0.1;
      const loose = tm.surf !== AR.SURF.TARMAC;
      const strong = tm.rumble * 0.55 + (loose && !tm.airborne ? Math.min(tm.speed / 60, 1) * 0.12 : 0);
      const weak = Math.min(0.5, tm.slipAvg * 0.05) + (tm.rpm > v.p.redline * 0.97 ? 0.15 : 0);
      if (strong > 0.04 || weak > 0.04) Input.rumble(strong, weak, 120);
    }

    // ---- audio ----
    Audio.updateCar(tm, v.p, tm.surf, dt);
  }

  function resetCar() {
    const R = race, v = R.vehicle, stage = R.stage;
    const pr = stage.project(v.pos.x, v.pos.z);
    const i = pr ? pr.i : stage.N - 5;
    const pose = stage.poseAt(i);
    v.reset(pose.pos, pose.dir);
    R.resets++;
    R.flipT = R.stuckT = 0;
    v.wheels.forEach((w, k) => R.skids.cut(k));
    FX.popup('RESET', { cls: 'small', y: 60, color: '#fff' });
  }

  function passGate() {
    const R = race;
    const g = R.gate;
    R.splits[g] = R.time;
    R.gate++;
    highlightGate();
    const best = R.bestSplits && R.bestSplits[g];
    Input.rumble(0.25, 0.4, 90);
    if (R.gate >= R.gateS.length) { finish(); return; }
    FX.flash('gate');
    Audio.gate(best == null || R.time <= best);
    if (best != null) {
      const d = R.time - best;
      HUD.split((d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2), d <= 0);
    } else HUD.split(AR.fmtTime(R.time), null);
  }

  function finish() {
    const R = race, st = R.st;
    R.phase = 'finished';
    R.drift.on = false;
    HUD.drift(false);
    const best = AR.store.get('best.' + st.id, null);
    const isBest = best == null || R.time < best;
    R.isBest = isBest;
    R.prevBest = best;
    if (isBest) {
      AR.store.set('best.' + st.id, R.time);
      AR.store.set('bestcar.' + st.id, R.def.name);
      AR.store.set('splits.' + st.id, R.splits);
      AR.store.set('ghost.' + st.id, { car: R.def.id, cfg: R.cfg, f: R.rec });
    }
    FX.flash();
    FX.popup(isBest ? 'NEW RECORD!!' : 'FINISH!', { jp: isBest ? '新記録！' : 'ゴール！', sub: AR.fmtTime(R.time), y: 36, cls: 'burst', ms: 2600 });
    AR.CoDriver.say(isBest ? 'NEW RECORD! SUGOI!' : 'STAGE CLEAR!', isBest ? 'すごい！新記録だよ！' : 'おつかれさま！', isBest ? 'New record! Amazing!' : 'Stage clear!');
    Audio.tone(784, 0.2, 0.08, 'triangle');
    setTimeout(() => Audio.tone(1046, 0.4, 0.08, 'triangle'), 180);
    Input.rumble(0.6, 0.6, 300);
  }

  function resultsScreen() {
    const R = race;
    state = 'results';
    R.paused = true;
    HUD.show(false);
    FX.SpeedLines.draw(0, 0.5, 0.5);
    const mph = S.units === 'mph';
    const ts = R.topSpeed * (mph ? 2.23694 : 3.6);
    AR.side(
      '<h2>' + (R.isBest ? 'NEW RECORD!' : 'STAGE CLEAR') + '</h2><div class="jp">' + R.st.name + ' · ' + R.def.name + '</div>' +
      '<div class="res-big">' + AR.fmtTime(R.time) + '</div>' +
      '<div class="res-row"><span>Previous best</span><span>' + AR.fmtTime(R.prevBest) + '</span></div>' +
      '<div class="res-row"><span>Top speed</span><span>' + Math.round(ts) + (mph ? ' mph' : ' km/h') + '</span></div>' +
      '<div class="res-row"><span>Drift score</span><span>' + Math.round(R.drift.total).toLocaleString() + '</span></div>' +
      '<div class="res-row"><span>Resets</span><span>' + R.resets + '</span></div>'
    );
    Menu.open('RESULTS', 'けっか', [
      { label: 'RETRY', action: () => startRace() },
      { label: 'NEXT STAGE', action: () => { stageIdx = (stageIdx + 1) % AR.STAGES.length; AR.store.set('stage', stageIdx); startRace(); } },
      { label: 'GARAGE', action: () => { endRace(); garageMenu(); } },
      { label: 'MAIN MENU', action: () => { endRace(); mainMenu(0); } },
    ], { onBack: () => { endRace(); mainMenu(0); } });
  }

  // ---------- camera ----------
  const CAMS = ['CHASE', 'FAR CHASE', 'HOOD', 'BUMPER'];
  function updateCamera(dt, inp) {
    const R = race, v = R.vehicle, tm = v.tm;
    if (inp.camera) {
      R.camMode = (R.camMode + 1) % CAMS.length;
      AR.store.set('cam', R.camMode);
      FX.popup(CAMS[R.camMode], { cls: 'small', y: 75, color: '#fff', ms: 800 });
      R.camOff = null;
    }
    const F = _v.set(0, 0, -1).applyQuaternion(v.q);
    const speed = tm.speed;
    const mode = R.camMode;
    let fovTarget = 62 + AR.clamp((speed - 8) / 45, 0, 1) * 16;
    if (mode <= 1 && R.phase !== 'finished') {
      // blend heading with travel direction so slides read clearly (like the reference)
      const hd = _v2.set(F.x, 0, F.z).normalize();
      if (speed > 4) {
        const vd = new THREE.Vector3(v.vel.x, 0, v.vel.z).normalize();
        hd.lerp(vd, 0.45).normalize();
      }
      if (inp.lookBack) hd.multiplyScalar(-1);
      const dist = mode === 0 ? 5.3 : 8.0;
      const h = mode === 0 ? 1.95 : 3.0;
      const target = new THREE.Vector3().copy(v.pos).addScaledVector(hd, -dist);
      target.y += h;
      // smooth the offset from the car (not the absolute position) so the camera never lags at speed
      const off = target.sub(v.pos);
      if (!R.camOff || inp.lookBack !== R.lastLookBack) R.camOff = off.clone();
      R.lastLookBack = inp.lookBack;
      R.camOff.x = AR.damp(R.camOff.x, off.x, 5, dt);
      R.camOff.z = AR.damp(R.camOff.z, off.z, 5, dt);
      R.camOff.y = AR.damp(R.camOff.y, off.y, 3, dt);
      R.camPos = (R.camPos || new THREE.Vector3()).copy(v.pos).add(R.camOff);
      const gh = R.stage.groundRaw(R.camPos.x, R.camPos.z).h + 0.9;
      if (R.camPos.y < gh) R.camPos.y = gh;
      camera.position.copy(R.camPos);
      const look = new THREE.Vector3().copy(v.pos).addScaledVector(hd, 3.5);
      look.y += 0.9;
      R.camLook.lerp(look, 1 - Math.exp(-14 * dt));
      if (R.camLook.lengthSq() === 0) R.camLook.copy(look);
      camera.lookAt(R.camLook);
    } else if (R.phase === 'finished') {
      // slow cinematic orbit at the finish
      const a = R.finishT * 0.6;
      camera.position.set(v.pos.x + Math.cos(a) * 7, v.pos.y + 2.2, v.pos.z + Math.sin(a) * 7);
      camera.lookAt(v.pos.x, v.pos.y + 0.4, v.pos.z);
      fovTarget = 50;
    } else {
      const m = R.car.meta, p = v.p;
      const local = mode === 2 ? new THREE.Vector3(0, m.hoodY - p.cgH + 0.32, m.bf - 0.25) : new THREE.Vector3(0, 0.62 - p.cgH, m.zMin - 0.15);
      if (inp.lookBack) local.z = m.zMax + 0.3;
      camera.position.copy(local.applyQuaternion(v.q).add(v.pos));
      const fwd = new THREE.Vector3(0, -0.04, inp.lookBack ? 1 : -1).applyQuaternion(v.q);
      camera.lookAt(camera.position.clone().add(fwd));
      fovTarget += 6;
    }
    R.fov = AR.damp(R.fov, fovTarget, 3, dt);
    camera.fov = R.fov;
    camera.updateProjectionMatrix();
    // shake (rough roads, landings, crashes)
    if (S.shake) {
      const rough = (tm.surf !== AR.SURF.TARMAC ? Math.min(speed / 50, 1) * 0.012 : 0) + tm.rumble * 0.03 + R.shake * 0.12;
      camera.position.x += (Math.random() - 0.5) * rough;
      camera.position.y += (Math.random() - 0.5) * rough;
    }
    R.shake = Math.max(0, R.shake - dt * 2.5);
    // sun & shadows follow the car
    R.sun.position.copy(v.pos).addScaledVector(R.sunDir, 120);
    R.sun.target.position.copy(v.pos);
    // speed lines
    const sl = S.speedLines && mode <= 1 ? AR.clamp((speed - 22) / 30, 0, 1) : 0;
    FX.SpeedLines.draw(sl, 0.5, 0.42);
  }

  // ---------- main loop ----------
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const inp = Input.poll(dt);
    const mn = Input.menu;
    if (mn.any || inp.throttle > 0.3) Audio.init();

    if (state === 'title') {
      if (mn.ok || inp.pause) { Audio.init(); Audio.select(); mainMenu(0); }
    } else if (state === 'race') {
      if (inp.pause && race.phase !== 'finished') pauseMenu();
    } else if (state !== 'race') {
      Menu.handle(mn);
    }
    if (state === 'controls') controlsLive();

    if (race && (state === 'race' || state === 'results' || state === 'paused')) {
      if (state === 'race') updateRace(dt, inp);
      updateCamera(state === 'race' ? dt : 0, state === 'race' ? inp : { camera: false, lookBack: false });
      if (state === 'race') {
        const v = race.vehicle;
        HUD.update({
          time: race.time, gate: race.gate, gates: race.gateS.length, speed: v.tm.speed, gear: v.gear, ev: v.p.ev,
          rpm: v.tm.rpm, redline: v.p.redline, input: inp,
        });
        const F = _v.set(0, 0, -1).applyQuaternion(v.q);
        HUD.minimap(race.stage, v.pos, Math.PI / 2 + Math.atan2(F.z, F.x), race.ghost && race.ghost.root.parent ? race.ghost.root.position : null);
      }
      renderer.render(race.scene, camera);
    } else {
      // garage / menus
      const pad = Input.rawPad();
      if (pad && pad.axes.length > 2 && Math.abs(pad.axes[2]) > 0.2) { garage.angle += pad.axes[2] * dt * 2.5; garage.spin = false; }
      if (garage.spin) garage.angle += dt * 0.35;
      if (garage.car) {
        garage.car.root.rotation.y = garage.angle;
        garage.car.wheels.forEach((w, i) => { w.pivot.rotation.y = i < 2 ? Math.sin(now / 1400) * 0.25 : 0; });
      }
      const wide = window.innerWidth > 900;
      camera.fov = 40;
      // keep the car in the gap between the menu (left) and the info card (right)
      camera.position.set(wide ? -1.5 : 0, 3.4, 11.5);
      camera.lookAt(wide ? -1.5 : 0, 2.1, 0);
      camera.updateProjectionMatrix();
      renderer.render(garage.scene, camera);
    }
  }

  applySettings();
  rebuildGarageCar();
  titleScreen();
  requestAnimationFrame(frame);
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => Audio.init(), { once: false }));

  // debug / test hooks
  AR._debug = {
    get race() { return race; }, get state() { return state; },
    setCar(i, angle) { carIdx = i; rebuildGarageCar(); if (angle != null) { garage.angle = angle; garage.spin = false; } },
    setCfg(o) { Object.assign(cfgFor(AR.CARS[carIdx]), o); rebuildGarageCar(); },
    // headless test helper: advance the race without rendering
    tick(n, dt, inp) {
      const base = { steer: 0, throttle: 0, brake: 0, handbrake: 0, shiftUp: false, shiftDown: false, camera: false, lookBack: false, reset: false, pause: false };
      for (let i = 0; i < n; i++) { updateRace(dt, Object.assign({}, base, inp)); updateCamera(dt, Object.assign({}, base, inp)); }
    }, startRace: (s, c) => { if (s != null) stageIdx = s; if (c != null) carIdx = c; startRace(); }, mainMenu, garageMenu };
})();
