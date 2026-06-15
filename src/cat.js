/**
 * cat.js — Desktop Cat behavior state machine
 * All state transitions, timers, interaction hooks
 */

'use strict';

// ── Constants ──────────────────────────────────────────────
const POSES = [
  'idle','walk','typing','scroll','hungry','eating',
  'overfed','sleeping','playing','angry','startled','sunbathing'
];

const SPEECH_LINES = [
  "I see you.",
  "pet me.",
  "what are you building 👀",
  "this tab is a mistake.",
  "10/10 posture. (not really)",
  "u ok bestie",
  "have u tried turning it off",
  "meow",
  "I have been watching you.",
  "productivity: detected. stopping it.",
  "where snack",
  "are u ok",
  "hire me tbh",
  "*judges you silently*",
  "be perceived.",
];

const OVERFED_LINES = [
  "ugh too full 💤",
  "send help 🍔",
  "I am baby now 😵",
  "no more... ever...",
];

const PET_REACTIONS = [
  "nyaa~", "purrrr", "*purrs loudly*", "...oi.", "😾 (but secretly likes it)", "*head bumps*"
];

const HUNGRY_THRESHOLD   = 4 * 60 * 60 * 1000;  // 4 hours
const SLEEP_AFTER_IDLE   = 10 * 60 * 1000;       // 10 min
const ANGRY_AFTER_IDLE   = 5 * 60 * 1000;        // 5 min
const SUNBATHE_THRESHOLD = 10 * 60 * 1000;       // 10 min same pos
const PLAY_MIN           = 15 * 60 * 1000;       // 15 min
const PLAY_MAX           = 30 * 60 * 1000;       // 30 min
const YAWN_MIN           = 8  * 60 * 1000;
const YAWN_MAX           = 12 * 60 * 1000;
const TYPING_RATE        = 2;                    // keys/sec threshold
const OVERFED_WINDOW     = 5000;                 // ms
const XP_MILESTONES = [
  { days: 7,  accessory: 'bow' },
  { days: 14, accessory: 'bandana' },
  { days: 30, accessory: 'crown' },
];

// ── State ──────────────────────────────────────────────────
const cat = {
  pose: 'idle',
  prevPose: 'idle',
  config: null,

  // Timers (kept so we can clear them)
  blinkTimer:          null,
  yawnTimer:           null,
  playTimer:           null,
  idleTimer:           null,
  sunbatheInterval:    null,
  speechTimer:         null,
  hungryInterval:      null,
  hourlyTimer:         null,
  sneezeInterval:      null,
  moonInterval:        null,
  lickTimer:           null,

  // Interaction tracking
  lastActivity:   Date.now(),
  lastPosition:   { x: 0, y: 0 },
  positionSince:  Date.now(),
  keyTimes:       [],
  recentClicks:   [],

  // Typing debounce
  typingTimeout:  null,

  // Scroll debounce
  scrollTimeout:  null,

  // Drag
  isDragging:     false,
  dragMoved:      false,
  dragVelocity:   { x: 0, y: 0 },
  lastDragPos:    { x: 0, y: 0 },
  lastDragTime:   0,

  // Flags
  suspended:      false,
  isMirrorStaring: false,
};

// ── DOM refs ───────────────────────────────────────────────
let container, bubbleSvg, bubbleText;

// ── Helpers ────────────────────────────────────────────────
function svgEl()   { return document.getElementById('cat-svg'); }
function poseEl(p) { return document.getElementById(`pose-${p}`); }
function getEl(id) { return document.getElementById(id); }

// ── Init ───────────────────────────────────────────────────
async function init() {
  container  = document.getElementById('cat-container');
  bubbleSvg  = document.getElementById('bubble-svg');
  bubbleText = document.getElementById('bubble-text');

  // Load config from main process
  cat.config = await window.catAPI.getConfig();
  cat.config.xp          = cat.config.xp          || 0;
  cat.config.accessories = cat.config.accessories || [];

  // Wait for SVG to be injected, then boot
  await waitForSVG();

  applySize(cat.config.size || 48);
  applyAccessories(cat.config.accessories);
  checkMoonlight();

  // IPC callbacks from main / tray
  window.catAPI.onFeed(    ()   => feed());
  window.catAPI.onWake(    ()   => wakeUp());
  window.catAPI.onSetSize( (sz) => applySize(sz));
  window.catAPI.onSuspend( ()   => onSuspend());
  window.catAPI.onResume(  ()   => onResume());

  setupDrag();
  setupInputDetection();
  startTimers();
  checkXPMilestones();

  setPose('idle');
  scheduleBlinking();
  scheduleYawn();
  schedulePlay();
  scheduleHourlyEvents();
  reportCatRect();
}

function waitForSVG(timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function check() {
      if (document.getElementById('cat-svg')) { resolve(); return; }
      if (Date.now() - start > timeout)        { resolve(); return; }
      requestAnimationFrame(check);
    }
    check();
  });
}

// ── Pose management ────────────────────────────────────────
function setPose(name) {
  if (!POSES.includes(name)) return;
  cat.prevPose = cat.pose;
  cat.pose     = name;

  // Toggle active class on all pose groups
  POSES.forEach(p => {
    const el = poseEl(p);
    if (el) el.classList.toggle('active', p === name);
  });

  // Overlay side-effects
  const zBubbles    = getEl('z-bubbles');
  const steamClouds = getEl('steam-clouds');
  const heartBubble = getEl('heart-bubble');

  if (zBubbles)    zBubbles.style.display    = (name === 'sleeping') ? 'block' : 'none';
  if (steamClouds) steamClouds.style.display  = (name === 'angry')    ? 'block' : 'none';
  if (heartBubble) heartBubble.style.display  = (name === 'hungry')   ? 'block' : 'none';
}

// ── Cat rect reporting ─────────────────────────────────────
function reportCatRect() {
  const svg = svgEl();
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  window.catAPI.setCatRect({
    x: Math.floor(r.left),
    y: Math.floor(r.top),
    w: Math.ceil(r.width),
    h: Math.ceil(r.height)
  });
}

// ── Blinking ───────────────────────────────────────────────
function scheduleBlinking() {
  const delay = 3000 + Math.random() * 2000;
  cat.blinkTimer = setTimeout(() => {
    if (cat.pose === 'idle') {
      const open  = getEl('idle-eyes-open');
      const blink = getEl('idle-eyes-blink');
      if (open && blink) {
        open.style.display  = 'none';
        blink.style.display = 'block';
        setTimeout(() => {
          open.style.display  = 'block';
          blink.style.display = 'none';
        }, 130);
      }
    }
    scheduleBlinking();
  }, delay);
}

// ── Yawn ───────────────────────────────────────────────────
function scheduleYawn() {
  const delay = YAWN_MIN + Math.random() * (YAWN_MAX - YAWN_MIN);
  cat.yawnTimer = setTimeout(() => {
    if (cat.pose === 'idle' && !cat.suspended) {
      showSpeech('*yawn* 🎵', 2500);
      const svg = svgEl();
      if (svg) {
        const idlePose = getEl('pose-idle');
        if (idlePose) {
          const nosePath = idlePose.querySelector('path[fill="#c97a7a"]');
          if (nosePath) {
            const original = nosePath.getAttribute('d');
            nosePath.setAttribute('d', 'M36,37 L40,33 L44,37 Q40,44 36,37Z');
            setTimeout(() => nosePath.setAttribute('d', original), 1800);
          }
        }
      }
    }
    scheduleYawn();
  }, delay);
}

// ── Sneeze ─────────────────────────────────────────────────
function maybeSneeze() {
  if (cat.pose !== 'idle' || cat.suspended) return;
  if (Math.random() > 0.01) return;

  const particles = getEl('sneeze-particles');
  if (!particles) return;

  particles.style.display = 'block';
  particles.classList.add('active');
  showSpeech('achoo!! 🤧', 1500);

  setTimeout(() => {
    particles.classList.remove('active');
    setTimeout(() => { particles.style.display = 'none'; }, 100);
  }, 900);
}


// ── Lick ───────────────────────────────────────────────────
function doLick() {
  if (['sleeping','eating','overfed'].includes(cat.pose)) return;
  if (cat.suspended) return;
  const prev = cat.pose;
  // Show lick as speech bubble + brief playing pose
  showSpeech('*lick lick* 🐾', 1800);
  setPose('playing');
  setTimeout(() => {
    if (cat.pose === 'playing') setPose(prev === 'playing' ? 'idle' : prev);
  }, 1800);
}

function scheduleLick() {
  cat.lickTimer = setTimeout(() => {
    doLick();
    scheduleLick();
  }, 30000); // every 30 seconds
}

// ── Speech bubbles ─────────────────────────────────────────
function showSpeech(text, duration = 3500) {
  if (!bubbleSvg || !bubbleText) return;
  clearTimeout(cat.speechTimer);

  bubbleText.textContent = text;

  bubbleSvg.style.display = 'block';
  bubbleSvg.style.animation = 'none';
  void bubbleSvg.offsetWidth;
  bubbleSvg.style.animation = `bubble-appear ${(duration / 1000).toFixed(1)}s ease-in-out forwards`;

  cat.speechTimer = setTimeout(() => {
    bubbleSvg.style.display = 'none';
    bubbleSvg.style.animation = 'none';
  }, duration + 400);
}

function triggerRandomSpeech() {
  if (['sleeping','angry','eating','overfed'].includes(cat.pose)) return;
  const line = SPEECH_LINES[Math.floor(Math.random() * SPEECH_LINES.length)];
  showSpeech(line);
}

// ── Hunger system ──────────────────────────────────────────
function checkHunger() {
  if (cat.suspended) return;
  if (['sleeping','overfed'].includes(cat.pose)) return;

  const elapsed = Date.now() - (cat.config.lastFed || 0);
  if (elapsed >= HUNGRY_THRESHOLD && cat.pose !== 'hungry') {
    setPose('hungry');
  }
}

function feed() {
  if (cat.pose === 'sleeping') {
    showSpeech('shhh 🤫');
    return;
  }
  if (cat.pose === 'overfed') {
    showSpeech('no more... ever...');
    return;
  }

  const now = Date.now();
  cat.recentClicks.push(now);
  cat.recentClicks = cat.recentClicks.filter(t => now - t < OVERFED_WINDOW);

  if (cat.recentClicks.length >= 3) {
    cat.recentClicks = [];
    setPose('overfed');
    const line = OVERFED_LINES[Math.floor(Math.random() * OVERFED_LINES.length)];
    showSpeech(line, 4000);
    setTimeout(() => { if (cat.pose === 'overfed') setPose('sleeping'); }, 30 * 60 * 1000);
    return;
  }

  cat.config.lastFed = now;
  window.catAPI.saveState({ lastFed: cat.config.lastFed });
  incrementXP(10);
  setPose('eating');
  cat.lastActivity = now;

  setTimeout(() => { if (cat.pose === 'eating') setPose('idle'); }, 2800);
}

function wakeUp() {
  if (['sleeping','overfed'].includes(cat.pose)) {
    setPose('idle');
    showSpeech('hmph 😾');
    cat.lastActivity = Date.now();
    resetIdleTimer();
  }
}

// ── Play session ───────────────────────────────────────────
function schedulePlay() {
  const delay = PLAY_MIN + Math.random() * (PLAY_MAX - PLAY_MIN);
  cat.playTimer = setTimeout(() => {
    triggerPlay();
    schedulePlay();
  }, delay);
}

function triggerPlay() {
  if (['sleeping','hungry','overfed','angry'].includes(cat.pose)) return;
  if (cat.suspended) return;

  setPose('playing');
  const duration = 8000 + Math.random() * 4000;
  setTimeout(() => { if (cat.pose === 'playing') setPose('idle'); }, duration);
}

// ── Idle → anger → sleep ───────────────────────────────────
function resetIdleTimer() {
  cat.lastActivity = Date.now();
  clearTimeout(cat.idleTimer);
  cat.idleTimer = setTimeout(onLongIdle, ANGRY_AFTER_IDLE);

  if (cat.pose === 'angry') {
    setPose('idle');
    showSpeech('hmmph.', 1500);
  }
  if (cat.pose === 'sunbathing') {
    setPose('idle');
  }
}

function onLongIdle() {
  if (cat.suspended) return;
  if (['sleeping','overfed'].includes(cat.pose)) return;

  const idleMs = Date.now() - cat.lastActivity;
  if (idleMs >= SLEEP_AFTER_IDLE) {
    setPose('sleeping');
  } else if (idleMs >= ANGRY_AFTER_IDLE) {
    setPose('angry');
    cat.idleTimer = setTimeout(onLongIdle, SLEEP_AFTER_IDLE - ANGRY_AFTER_IDLE);
  }
}

// ── Sunbathing ─────────────────────────────────────────────
function checkSunbathe() {
  if (cat.suspended) return;
  if (!['idle'].includes(cat.pose)) return;

  const x = parseFloat(container.style.left) || 0;
  const y = parseFloat(container.style.top)  || 0;
  const dx = x - cat.lastPosition.x;
  const dy = y - cat.lastPosition.y;
  const moved = Math.sqrt(dx*dx + dy*dy) > 10;

  if (moved) {
    cat.lastPosition  = { x, y };
    cat.positionSince = Date.now();
  } else if (Date.now() - cat.positionSince >= SUNBATHE_THRESHOLD) {
    if (cat.pose === 'idle') setPose('sunbathing');
  }
}

// ── Moonlight mode ─────────────────────────────────────────
function checkMoonlight() {
  const hour = new Date().getHours();
  const moonTime = hour >= 23 || hour < 6;
  document.body.classList.toggle('moonlight', moonTime);
  const moonEl = getEl('moon-accessory');
  if (moonEl) moonEl.style.display = moonTime ? 'block' : 'none';
}

// ── Mirror stare ───────────────────────────────────────────
function triggerMirrorStare() {
  if (cat.pose !== 'idle' || cat.suspended) return;
  cat.isMirrorStaring = true;
  showSpeech('I see you.', 5000);
  setTimeout(() => { cat.isMirrorStaring = false; }, 5500);
}

// ── Hourly events ──────────────────────────────────────────
function scheduleHourlyEvents() {
  const delay = 45 * 60 * 1000 + Math.random() * 30 * 60 * 1000;
  cat.hourlyTimer = setTimeout(() => {
    triggerMirrorStare();
    scheduleHourlyEvents();
  }, delay);
}

// ── Startled ───────────────────────────────────────────────
function triggerStartled() {
  if (['sleeping','overfed'].includes(cat.pose)) return;
  const prev = cat.pose;
  setPose('startled');
  setTimeout(() => { if (cat.pose === 'startled') setPose(prev === 'startled' ? 'idle' : prev); }, 1200);
}

// ── Input detection ────────────────────────────────────────
function setupInputDetection() {
  window.addEventListener('keydown', (e) => {
    if (cat.suspended) return;
    resetIdleTimer();
    maybeSneeze();

    const now = Date.now();
    cat.keyTimes.push(now);
    cat.keyTimes = cat.keyTimes.filter(t => now - t <= 1000);

    if (cat.keyTimes.length >= TYPING_RATE) {
      if (!['typing','sleeping','overfed','hungry'].includes(cat.pose)) {
        setPose('typing');
      }
    }

    clearTimeout(cat.typingTimeout);
    cat.typingTimeout = setTimeout(() => {
      if (cat.pose === 'typing') setPose('idle');
    }, 2000);
  });

  window.addEventListener('wheel', () => {
    if (cat.suspended) return;
    resetIdleTimer();
    if (!['scroll','sleeping','overfed'].includes(cat.pose)) {
      setPose('scroll');
    }
    clearTimeout(cat.scrollTimeout);
    cat.scrollTimeout = setTimeout(() => {
      if (cat.pose === 'scroll') setPose('idle');
    }, 1000);
  }, { passive: true });

  window.addEventListener('mousemove', () => {
    if (!cat.suspended) resetIdleTimer();
  });
}

// ── Click handler (called by drag system when no movement) ─
function handleCatClick() {
  if (['sleeping', 'overfed'].includes(cat.pose)) {
    showSpeech('shhh 🤫');
    return;
  }

  const elapsed = Date.now() - (cat.config.lastFed || 0);
  if (cat.pose === 'hungry' || elapsed >= HUNGRY_THRESHOLD) {
    feed();
    return;
  }

  const reaction = PET_REACTIONS[Math.floor(Math.random() * PET_REACTIONS.length)];
  showSpeech(reaction, 2000);
  incrementXP(1);
}

// ── Drag system ────────────────────────────────────────────
function setupDrag() {
  container.addEventListener('mousedown',  startDrag);
  container.addEventListener('touchstart', startDrag, { passive: false });
  document.addEventListener('mousemove',   doDrag);
  document.addEventListener('touchmove',   doDrag, { passive: false });
  document.addEventListener('mouseup',     endDrag);
  document.addEventListener('touchend',    endDrag);
}

function eventPos(e) {
  return e.touches
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX,            y: e.clientY };
}

function startDrag(e) {
  if (cat.pose === 'sleeping') { showSpeech('shhh 🤫'); return; }
  e.preventDefault();
  cat.isDragging   = true;
  cat.dragMoved    = false;                   // haven't moved yet
  cat.lastDragPos  = eventPos(e);
  cat.lastDragTime = Date.now();
  cat.dragVelocity = { x: 0, y: 0 };
  // Do NOT change pose here — wait to see if they drag or just click
}

function doDrag(e) {
  if (!cat.isDragging) return;
  e.preventDefault();

  const pos = eventPos(e);
  const dx  = pos.x - cat.lastDragPos.x;
  const dy  = pos.y - cat.lastDragPos.y;

  // Only commit to a drag once cursor moves more than 4px
  if (!cat.dragMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;

  if (!cat.dragMoved) {
    cat.dragMoved = true;
    setPose('walk');
  }

  // Smooth velocity with a tiny lerp so inertia feels natural
  cat.dragVelocity = {
    x: dx * 0.6 + cat.dragVelocity.x * 0.4,
    y: dy * 0.6 + cat.dragVelocity.y * 0.4,
  };
  cat.lastDragPos = pos;

  // Ask main process to snap window centre to cursor — zero lag, no delta math
  window.catAPI.moveToCursor();
}

function endDrag() {
  if (!cat.isDragging) return;
  cat.isDragging = false;

  if (!cat.dragMoved) {
    // Finger/mouse never moved — treat as a click
    handleCatClick();
    return;
  }

  applyInertia(cat.dragVelocity.x, cat.dragVelocity.y);
  cat.positionSince = Date.now();
  setTimeout(() => { if (cat.pose === 'walk') setPose('idle'); }, 400);
}

function applyInertia(vx, vy) {
  function step() {
    vx *= 0.82; vy *= 0.82;
    if (Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5) {
      window.catAPI.moveWindow({ dx: Math.round(vx), dy: Math.round(vy) });
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

// ── Size ───────────────────────────────────────────────────
function applySize(px) {
  const svg = svgEl();
  if (svg) {
    svg.setAttribute('width',  px);
    svg.setAttribute('height', px);
  }
  const padded = px + 40;
  container.style.width  = padded + 'px';
  container.style.height = padded + 'px';
  cat.config.size = px;
  reportCatRect();
}

// ── Accessories ────────────────────────────────────────────
function applyAccessories(list = []) {
  ['bow','bandana','crown'].forEach(a => {
    const el = getEl(`accessory-${a}`);
    if (el) el.style.display = list.includes(a) ? 'block' : 'none';
  });
}

// ── XP & milestones ────────────────────────────────────────
function incrementXP(amount) {
  cat.config.xp += amount;
  window.catAPI.saveState({ xp: cat.config.xp });
  checkXPMilestones();
}

function checkXPMilestones() {
  const days   = Math.floor(cat.config.xp / 100);
  const earned = [...(cat.config.accessories || [])];
  let changed  = false;

  XP_MILESTONES.forEach(m => {
    if (days >= m.days && !earned.includes(m.accessory)) {
      earned.push(m.accessory);
      showSpeech(`new accessory: ${m.accessory}! 🎉`, 4000);
      changed = true;
    }
  });

  if (changed) {
    cat.config.accessories = earned;
    window.catAPI.saveState({ accessories: earned });
    applyAccessories(earned);
  }
}

// ── Timers ─────────────────────────────────────────────────
function startTimers() {
  checkHunger();
  cat.hungryInterval = setInterval(checkHunger, 5 * 60 * 1000);

  cat.sunbatheInterval = setInterval(checkSunbathe, 2 * 60 * 1000);

  cat.moonInterval = setInterval(checkMoonlight, 30 * 60 * 1000);

  (function scheduleSpeech() {
    const delay = (8 + Math.random() * 7) * 60 * 1000;
    setTimeout(() => { triggerRandomSpeech(); scheduleSpeech(); }, delay);
  })();

  cat.sneezeInterval = setInterval(maybeSneeze, 60 * 1000);
  scheduleLick();

  cat.idleTimer = setTimeout(onLongIdle, ANGRY_AFTER_IDLE);
}

// ── Power events ───────────────────────────────────────────
function onSuspend() {
  cat.suspended = true;
  document.body.classList.add('suspended');
}

function onResume() {
  cat.suspended = false;
  document.body.classList.remove('suspended');
  resetIdleTimer();
  checkHunger();
  checkMoonlight();
  setTimeout(triggerStartled, 500);
}

// ── Public API ─────────────────────────────────────────────
window.cat = { init, triggerStartled, feed, wakeUp, showSpeech, setPose };

// Boot when DOM + SVG are ready
document.addEventListener('DOMContentLoaded', init);