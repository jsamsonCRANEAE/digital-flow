// Corporate Pager queue, Memory/Anchor system, Breakroom reflections and Endings.
// The writing degrades with Anchor: names glitch to hex, warmth becomes telemetry. Pure module.

export const MEMORIES = [
  { icon: 'watch', title: "Dad's Timex", text: 'Dad\'s Timex. He wound it every morning at 5:40 and was never once late.' },
  { icon: 'key', title: '41 Alder Street', text: '41 Alder Street. The porch light {WIFE} leaves on. The door you have to lift a little in winter.' },
  { icon: 'photo', title: "{WIFE}'s laugh", text: '{WIFE} laughing in the kitchen the morning the coffee maker finally died.' },
  { icon: 'photo', title: '{KID}, nine', text: '{KID}, nine, wobbling down Alder without training wheels. "Don\'t let go, Dad."' },
  { icon: 'photo', title: 'Their names', text: 'Their names. I used to know their names.' },
];

/** Memory i is lost once Anchor falls to (80 − 20·i) or below. */
export function memoriesLost(anchor) {
  let n = 0;
  for (let i = 0; i < MEMORIES.length; i++) if (anchor <= 80 - 20 * i) n++;
  return n;
}

export function tier(anchor) {
  if (anchor >= 70) return 'whole';
  if (anchor >= 40) return 'fraying';
  if (anchor > 0) return 'glitch';
  return 'hollow';
}

const toHex = (s) => [...s].map((c) => '0x' + c.charCodeAt(0).toString(16).toUpperCase()).join(' ');

/** A name as Cole can currently recall it. */
export function recall(name, anchor, rand = Math.random) {
  if (anchor > 40) return name;
  if (anchor > 20) return [...name].map((c, i) => (i > 0 && rand() < 0.45 ? '█' : c)).join('');
  if (anchor > 0) return toHex(name.slice(0, 2)) + ' ??';
  return '[NULL]';
}

export function fill(text, anchor, rand) {
  return text.replace(/\{WIFE\}/g, recall('Mara', anchor, rand)).replace(/\{KID\}/g, recall('Tess', anchor, rand));
}

const FLOOR_LINES = {
  whole: [
    'Hour eleven. Five more and I\'m home before {KID} wakes up. Promised I\'d fix her bike chain.',
    '{WIFE}\'s gonna smell the ozone on me. She always does.',
    'Lock it, tag it, try it. Dad said no job\'s so urgent you can\'t do it safe.',
    'Third gear sticks on that bike. Five-millimetre hex and ten quiet minutes. That\'s all I need.',
  ],
  fraying: [
    'The bike. The chain — or the brakes? I wrote it on my hand. My hand isn\'t there.',
    'Somebody leaves a porch light on for me. I know that. I know that.',
    'The pager\'s getting louder than my own thoughts.',
    'Keep your feet out of the water. Keep your head out of the grid. Keep... what was the third one.',
  ],
  glitch: [
    'SUBJECT: COLE. HOME_ADDR: 41 ALDER [CHECKSUM FAIL]. REASON FOR RETURN: [NULL]',
    'There\'s a girl in the photo. {KID}. I can\'t parse her name.',
    'LOAD 97%. BODY NOMINAL. DESIRE TO GO HOME: VALUE NOT FOUND.',
    '> photo.jpg :: 2 faces detected :: identity unknown',
  ],
  hollow: [
    'ASSET 4471 PROCEEDING TO NEXT SECTOR. EFFICIENCY NOMINAL.',
    'photo.jpg: 2 faces detected. identity: unknown. discard? [Y/n]',
    'THE BUSBARS ARE HOT. THE BUSBARS ARE HOT. THE BUSBARS ARE HOT.',
  ],
};

const BREAKROOM_LINES = {
  whole: [
    'The vending machine buzzes a flat B. {KID} would hear that. She hears everything.',
    'Cole turns the brass key over in his good hand. 41 Alder. The lock sticks in winter; you have to lift the door a little.',
    'He props the Timex against the microwave clock. They disagree by two minutes. He trusts the watch.',
    'He eats half a granola bar and saves the other half. Habit. {KID} always asks what he brought back.',
  ],
  fraying: [
    'The microwave plate turns. Cole tries to remember the sound of {WIFE}\'s laugh. He gets the shape of it. Not the sound.',
    'The photo is creased down the middle. One side is a woman. The other side is static.',
    'He checks the Timex. Then checks it again. The hands mean something. He\'s sure they mean something.',
  ],
  glitch: [
    '> BREAKROOM.LOC  TEMP 19C  OCCUPANT: 1 (PARTIAL)',
    '> pocket[1]: brass_key — function: opens door — which door: ???',
    'Cole presses his thumb to the photo until the gloss cracks. {KID}. {WIFE}. Nothing comes back.',
  ],
  hollow: [
    '> MEAL BREAK SKIPPED. EFFICIENCY +3%.',
    'There is a photograph in the jacket pocket. It is of no operational value.',
    'The vending machine hums. The asset waits for the next work order.',
  ],
};

const PAGER = {
  floorStart: [
    'DISPATCH: Sector {D} work order active. Clock is running. Keep the busbars hot.',
    'DISPATCH: Reminder — overtime is voluntary and mandatory.',
    'DISPATCH: Customer-minutes lost this quarter: 41,212. Let\'s not add yours.',
    'DISPATCH: Depth {D}. Corporate thanks you for your continued availability.',
  ],
  loto: [
    'REMINDER: Unscheduled LOTO downtime reduces shift efficiency bonus by 14%. Keep the busbars hot.',
    'NOTICE: Breaker {L} locked out. Downtime has been logged against your badge.',
    'DISPATCH: Was that lock strictly necessary? A supervisor will review.',
  ],
  lotoAudit: ['SAFETY AUDIT: LOTO compliance observed on {L}. No penalty this sector.'],
  reclose: [
    'SCADA: Auto-reclose restored service on {L}. Uptime is everyone\'s job.',
    'SCADA: {L} re-energized automatically. Locks prevent this. Locks also cost money.',
  ],
  overclock: [
    'PERFORMANCE: Output spike detected. Efficiency +10%. Whatever you\'re doing, keep doing it.',
    'HR: Your commitment has been noted. Personal effects are not covered under policy.',
    'PERFORMANCE: Excellent throughput. Sentiment is a non-billable expense.',
  ],
  downed: ['SAFETY: Incident pre-report auto-filed. Root cause: operator error (pending).'],
  meltdownWarn: ['GRID OPS: Load spike forecast in 30 seconds. Expedite.'],
  meltdown: ['GRID OPS: Thermal limits exceeded. Production continues.'],
  imbalance: ['SCADA: Phase imbalance on bus {P}. Harmonics are a field problem.', 'SCADA: Neutral current rising on bus {P}. Do not let this become a ticket.'],
  idle: [
    'BENEFITS: Open enrollment closes Friday. Life policy excludes "arc-flash incidents".',
    'FACILITIES: The breakroom microwave is for company use only.',
    'DISPATCH: Weather service reports rain at dawn. Not your concern.',
    'PAYROLL: Your weekend differential has been recalculated. Downward.',
    'SAFETY: 0 days without incident. Let\'s keep that number honest.',
    'DISPATCH: Please stop asking about the arc flash. There was no arc flash.',
    'IT: Unregistered device detected on the SCADA network. Is that you, Cole?',
    'HR: Reminder that grief counselling is available Mon–Fri, 9–5.',
  ],
  cipher: [
    '????: WHO IS READING THIS',
    '????: the grid remembers everything you feed it.',
    '????: four floors. four keys. you are not the first one down here.',
    '????: 0x47 0x48 0x4F 0x53 0x54',
  ],
  bossStart: ['EXECUTIVE: The Main Tie must not trip. Revenue at risk: $4.1M/hr. You are replaceable. It is not.'],
  bossPhase2: ['EXECUTIVE: Back-feed is within tolerance. Return to work.'],
  bossPhase3: ['EXECUTIVE: DO NOT OPEN THE MAIN DISCONNECT. That is a direct order.'],
  burnAll: ['EXECUTIVE: Outstanding. Promote this asset.'],
  hotWork: ['DISPATCH: Hot-work authorised. Grid stays live. Double pay. Sign nothing.'],
  cleanWork: ['DISPATCH: Clean maintenance window approved. Reduced pay. Don\'t get comfortable.'],
  memory: ['????: you dropped something.'],
};

export const ENDINGS = {
  union: {
    title: 'THE UNION ENDING',
    sub: 'Lock it. Tag it. Try it. Go home.',
    lines: [
      '06:12. The Main Tie hangs dead and grounded behind brass locks with Cole\'s name on every tag.',
      'The pager buzzes once in his pocket. He doesn\'t read it.',
      'Outside, the rain has come in off the river. It runs down his face — both sides of it.',
      'He drives home with the window down. The porch light at 41 Alder is still on.',
      '{KID} is asleep. The bike leans in the garage, chain hanging. Cole finds the 5mm hex on the first try.',
      'Third gear doesn\'t stick anymore.',
    ],
  },
  company: {
    title: 'THE COMPANY MAN ENDING',
    sub: 'Exceeds expectations.',
    lines: [
      '06:02. Ahead of schedule. Every board in the control room reads green.',
      'The body that walks out of Substation Zero has Cole\'s gait, Cole\'s boots, Cole\'s badge.',
      'Its face resolves at sixty-four by sixty-four. The rain falls through the left half without touching anything.',
      'In the lot it stands beside a truck it recognises as an asset. It does not remember the drive home.',
      'The porch light at 41 Alder burns until noon. Then someone turns it off.',
      'PERFORMANCE REVIEW: EXCEEDS EXPECTATIONS. REASSIGNED: PERMANENT NIGHT SHIFT.',
    ],
  },
  overtime: {
    title: 'THE OVERTIME ENDING',
    sub: 'Some things you relearn by hand.',
    lines: [
      '06:20. The core is safe. Cole is... most of Cole.',
      'He drives home on muscle memory, the way you drive a road you\'ve driven a thousand times.',
      'The key fits. He knows that it fits. He stands in the kitchen and doesn\'t know which mug is his.',
      'A girl in pajamas says "Dad?" and he says "Hey, kiddo" — and it\'s true, and it isn\'t enough, and it\'s a start.',
      'Some things you lock out. Some things you have to relearn by hand.',
    ],
  },
  ghost: {
    title: 'THE GHOST IN THE MACHINE',
    sub: 'Secret ending — every cipher solved.',
    lines: [
      'The four ciphers were never corporate. They were left in the schematics by every tech this grid has eaten.',
      '0x47 0x48 0x4F 0x53 0x54.  G · H · O · S · T.',
      'Cole\'s body walks out into the morning rain, whole. His face is his own.',
      'But a part of him stays in the copper — the part that learned the grid\'s language.',
      'Since that night, at Substation Zero, breakers that should auto-reclose... don\'t. Locks appear that nobody hung.',
      'No one on the night shift has been hurt since. The pager logs an unregistered device. No one can remove it.',
    ],
  },
  terminated: {
    title: 'SHIFT TERMINATED',
    sub: 'Root cause: operator error.',
    lines: [
      'Incident report auto-filed at 04:51. Root cause: operator error.',
      'A creased polaroid is recovered from the jacket and logged as personal effects, box 12 of 40.',
      'The busbars stay hot. The grid does not notice.',
    ],
  },
};

export const INTRO = [
  'SUBSTATION ZERO — 03:47 — HOUR 11 OF A 16-HOUR WEEKEND SHIFT',
  'Cole has kept this grid alive for nineteen years. He knows every breaker by the sound it makes.',
  'Tonight someone upstairs ran an unlogged load transfer so Monday\'s numbers would look good.',
  'Forty thousand degrees for a quarter of a second.',
  'Cole doesn\'t die. That\'s the problem.',
  'His left side is coming apart into light — arm, cheek, eye — bleeding pixels into the SCADA network.',
  'Part of him is still standing in the flood water. Part of him is running through the copper.',
  'In his jacket: a creased polaroid, a brass house key, his father\'s analog watch.',
  'Get the body home. Keep the mind whole. You won\'t always manage both.',
];

export const MEMORY_SHARDS = [
  'Tucked behind a cable tray: a corner of the polaroid. {KID}\'s gap-toothed grin.',
  'Scratched into the breaker panel in Cole\'s own hand: "41 ALDER — LIFT THE DOOR."',
  'A sticky note inside his hard hat: "{WIFE}: 2 sugars. Chipped blue mug."',
  'The Timex ticks louder for a moment. 5:40. Wind it.',
];

export function determineEnding(run) {
  if (run.ciphers >= 4 && run.anchor > 0) return 'ghost';
  if (run.anchor <= 0 || run.burnedAll) return 'company';
  if (run.anchor >= 60 && run.lotoCount >= run.shortcuts) return 'union';
  return 'overtime';
}

export class Narrative {
  constructor(rand = Math.random) {
    this.rand = rand;
    this.queue = [];
    this.current = null;
    this.idleT = 35;
    this.used = new Map();
  }

  pick(pool, key) {
    const n = this.used.get(key) || 0;
    this.used.set(key, n + 1);
    return pool[n % pool.length];
  }

  /** Enqueue a pager message. priority messages jump the queue. */
  page(text, { priority = false, from = 'corp', duration = 6 } = {}) {
    const msg = { text, from, duration, t: 0 };
    if (priority) this.queue.unshift(msg); else this.queue.push(msg);
    if (this.queue.length > 5) this.queue.length = 5;
  }

  event(type, vars = {}, anchor = 100) {
    const pool = PAGER[type];
    if (!pool) return;
    let text = this.pick(pool, type)
      .replace('{D}', vars.depth ?? '')
      .replace('{L}', vars.label ?? '')
      .replace('{P}', vars.phase ?? '');
    if (anchor <= 30 && type !== 'cipher') text = text.replace(/Cole/g, 'ASSET #4471');
    this.page(text, { priority: !!vars.priority, from: type === 'cipher' || type === 'memory' ? 'unknown' : 'corp' });
  }

  /** Returns a message object when a new one begins displaying (for buzz SFX), else null. */
  update(dt, anchor) {
    let started = null;
    if (this.current) {
      this.current.t += dt;
      if (this.current.t > this.current.duration) this.current = null;
    }
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift();
      started = this.current;
    }
    this.idleT -= dt;
    if (this.idleT <= 0) {
      this.idleT = 45 + this.rand() * 40;
      this.event('idle', {}, anchor);
    }
    return started;
  }

  clear() { this.queue.length = 0; this.current = null; }

  floorLine(depth, anchor) {
    const pool = FLOOR_LINES[tier(anchor)];
    return fill(pool[(depth - 1) % pool.length], anchor, this.rand);
  }

  breakroom(depth, anchor) {
    const pool = BREAKROOM_LINES[tier(anchor)];
    const a = pool[(depth - 1) % pool.length];
    const b = pool[depth % pool.length];
    return [fill(a, anchor, this.rand), fill(b, anchor, this.rand)];
  }

  memoryText(i, anchor) { return fill(MEMORIES[i].text, Math.max(anchor, 41), this.rand); }
  memoryTitle(i, anchor) { return fill(MEMORIES[i].title, anchor, this.rand); }
  shard(i, anchor) { return fill(MEMORY_SHARDS[i % MEMORY_SHARDS.length], anchor, this.rand); }

  ending(id, anchor) {
    const e = ENDINGS[id];
    return { ...e, lines: e.lines.map((l) => fill(l, id === 'union' || id === 'ghost' ? 100 : anchor, this.rand)) };
  }
}
