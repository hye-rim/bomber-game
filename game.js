'use strict';

// 봄버 미로: 화면·입력·흐름. 판 규칙은 logic.js (LOGIC) 에 있다.
(() => {
const L = LOGIC;
const { DIRS, EMPTY, HARD, SOFT, key } = L;

// ---------- 모양 ----------
const W = 400, H = 664;
const GX = 12, GW = 376, GY = 78;                  // 판이 그려지는 자리
const INK = '#2b1d52';
const FONT = '"Jua", "Apple SD Gothic Neo", sans-serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

const PLAYER_SPEED = 5.4;                          // 칸/초
const FLAME_T = 0.5, INV_T = 2.2, DEAD_T = 0.45;
const START_LIVES = 3, MAX_RANGE = 6;
const SAVE_BEST = 'bomberBest';

// 아래 조작판 (논리 좌표)
const PAD = [
  { dir: 0, x: 71, y: 481 }, { dir: 1, x: 129, y: 539 }, { dir: 2, x: 71, y: 597 }, { dir: 3, x: 13, y: 539 },
].map((b) => ({ ...b, w: 54, h: 54 }));
const BOMB_BTN = { x: 306, y: 572, r: 52 };
const RESTART_BTN = { x: 312, y: 466, w: 76, h: 32 };

// ---------- 캔버스 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const hudH = 62;
  const scale = Math.min((innerWidth - 24) / W, (innerHeight - 28 - hudH) / H);
  const cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = Math.max(cssW, Math.min(innerWidth - 20, 340)) + 'px';
  $('wrap').style.width = cssW + 'px';
  $('wrap').style.margin = '0 auto';
}
addEventListener('resize', fit);

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// ---------- 저장·소리 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let muted = store.get('bomberMuted') === '1';
let audio = null;
function tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const sfx = {
  put: () => tone(180, 0.08, 'triangle', 0.09, -60),
  boom: () => { tone(90, 0.35, 'sawtooth', 0.12, -50); tone(200, 0.2, 'square', 0.05, -120); },
  break: () => tone(320, 0.06, 'square', 0.04, -100),
  item: () => [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, 0.08, 'sine', 0.09), i * 55)),
  kill: () => tone(500, 0.16, 'triangle', 0.1, 300),
  hurt: () => { tone(300, 0.3, 'sawtooth', 0.1, -220); },
  open: () => [523, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.1), i * 90)),
  nope: () => tone(160, 0.08, 'square', 0.05, -30),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.1), i * 100)),
  over: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.1), i * 180)),
};

// ---------- 상태 ----------
let state = 'menu';            // menu | play | paused | won | over
let level = 1, score = 0, lives = START_LIVES, best = Number(store.get(SAVE_BEST)) || 0;
let first = null;              // 이 판의 처음 모습 (다시 하기용)
let n = 9, cell = GW / 9;
let g = [], items = {}, exit = { x: 1, y: 1 };
let spec = L.levelSpec(1);
let stock = 0, range = 2, kills = 0, time = 0;
let player = null, enemies = [], bombs = [], flames = [];
let particles = [], texts = [], banner = null;
let shake = 0, stuckT = 0, clock = 0, winTimer = null;
let held = [];                 // 누르고 있는 방향 [{ src, dir }] — 마지막에 누른 것이 우선

const mover = (x, y, dir = 1) => ({ x, y, fx: x, fy: y, p: 1, dir });
const at = (m) => (m.p >= 0.5 ? [m.x, m.y] : [m.fx, m.fy]);            // 지금 가장 가까운 칸
const at2 = (m) => ({ x: m.fx + (m.x - m.fx) * m.p, y: m.fy + (m.y - m.fy) * m.p });

function newLevel(lv, same = false) {
  level = lv;
  clearTimeout(winTimer);
  if (!same) first = L.generate(lv);
  spec = first.spec; n = first.n; cell = GW / n;
  g = first.g.slice();
  items = { ...first.items };
  exit = { ...first.exit };
  stock = first.supply; range = spec.range; kills = 0; time = 0; stuckT = 0; wasOpen = false;
  player = { ...mover(L.START[0], L.START[1]), inv: 1.2 };
  enemies = first.enemies.map((e) => ({ ...mover(e.x, e.y, Math.floor(Math.random() * 4)), type: e.type, alive: true, dead: 0 }));
  bombs = []; flames = []; particles = []; texts = [];
  banner = { text: `STAGE ${lv}`, t: 0 };
  state = 'play';
  hideOverlay();
  updateHud();
}

function startRun() { score = 0; lives = START_LIVES; newLevel(1); }

function updateHud() {
  if (score > best) { best = score; store.set(SAVE_BEST, String(best)); }
  $('score').textContent = score.toLocaleString();
  $('best').textContent = best.toLocaleString();
}

// ---------- 움직임 ----------
// 한 칸씩 부드럽게 걷는다. 도착하면 곧바로 다음 걸음을 이어서 (남은 시간 그대로)
function advance(m, dt, speed, pickDir) {
  let left = dt;
  while (left > 0) {
    if (m.p < 1) {
      const need = (1 - m.p) / speed;
      if (need > left) { m.p += left * speed; return; }
      left -= need; m.p = 1;
    }
    const d = pickDir(m);
    if (d < 0) return;
    m.fx = m.x; m.fy = m.y;
    m.x += DIRS[d][0]; m.y += DIRS[d][1];
    m.dir = d; m.p = 0;
  }
}

const bombAt = (x, y) => bombs.find((b) => b.x === x && b.y === y);
const wallAt = (x, y) => g[key(n, x, y)] !== EMPTY;
const enemyAim = (e) => [e.x, e.y];

function playerCanEnter(x, y) {
  if (x < 0 || y < 0 || x >= n || y >= n || wallAt(x, y)) return false;
  const b = bombAt(x, y);
  return !b || !b.solid;
}
function enemyBlocked(self) {
  return (x, y) => wallAt(x, y) || !!bombAt(x, y) || enemies.some((o) => o !== self && o.alive && ((o.x === x && o.y === y) || (o.p < 1 && o.fx === x && o.fy === y)));
}

function pickPlayerDir(m) {
  for (let i = held.length - 1; i >= 0; i--) {
    const d = held[i].dir;
    if (playerCanEnter(m.x + DIRS[d][0], m.y + DIRS[d][1])) return d;
  }
  return -1;
}

const enemySpeed = (e) => (e.type === 'chaser' ? Math.min(2.8 + level * 0.1, 4) : Math.min(2.1 + level * 0.08, 3.2));

// ---------- 폭탄·폭발 ----------
function placeBomb() {
  if (state !== 'play') return;
  const [x, y] = at(player);
  if (bombAt(x, y)) return;
  if (stock <= 0 || bombs.length >= spec.maxBombs) { sfx.nope(); return; }
  stock--;
  bombs.push({ x, y, t: spec.fuse, range, solid: false });
  sfx.put();
  updateHud();
}

function explode(b) {
  if (!bombs.includes(b)) return;
  const r = L.blast(n, g, bombs, b);
  bombs = bombs.filter((o) => !r.chain.includes(o));
  for (const [x, y] of r.broken) {
    g[key(n, x, y)] = EMPTY;
    debris(x, y);
    if (x === exit.x && y === exit.y) { texts.push({ x: gx(x + 0.5), y: gy(y + 0.5), text: '출구 발견!', t: 0, big: true }); }
  }
  for (const [x, y] of r.flames) flames.push({ x, y, t: FLAME_T });
  shake = 0.22;
  sfx.boom();
  if (r.broken.length) sfx.break();
  checkExitOpen();
}

const gx = (cx) => GX + cx * cell;
const gy = (cy) => GY + cy * cell;

function debris(x, y) {
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 110;
    particles.push({ x: gx(x + 0.5), y: gy(y + 0.5), vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5, col: i % 2 ? '#e8945f' : '#b8613a', size: 4 });
  }
}
function puff(x, y, col, cnt = 10) {
  for (let i = 0; i < cnt; i++) {
    const a = Math.random() * Math.PI * 2, s = 50 + Math.random() * 130;
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 50, life: 0.55, col, size: 4.5 });
  }
}

// ---------- 피해·클리어 ----------
function hitPlayer() {
  if (player.inv > 0 || state !== 'play') return;
  const p = at2(player);
  puff(gx(p.x + 0.5), gy(p.y + 0.5), '#ff5fa2', 14);
  lives--;
  sfx.hurt();
  shake = 0.35;
  updateHud();
  if (lives <= 0) return gameOver();
  // 시작 자리로 돌아가 잠깐 안전
  Object.assign(player, mover(L.START[0], L.START[1]), { inv: INV_T });
  texts.push({ x: gx(L.START[0] + 0.5), y: gy(L.START[1] + 0.5), text: `목숨 ${lives}`, t: 0, big: true });
}

function killEnemy(e) {
  e.alive = false; e.dead = DEAD_T; kills++;
  const p = at2(e);
  puff(gx(p.x + 0.5), gy(p.y + 0.5), e.type === 'chaser' ? '#a58bea' : '#7fd18b');
  texts.push({ x: gx(p.x + 0.5), y: gy(p.y + 0.5), text: '+100', t: 0 });
  sfx.kill();
  checkExitOpen();
}

const aliveCount = () => enemies.filter((e) => e.alive).length;
const exitRevealed = () => g[key(n, exit.x, exit.y)] !== SOFT;
const exitOpen = () => exitRevealed() && aliveCount() === 0;
let wasOpen = false;
function checkExitOpen() {
  const open = exitOpen();
  if (open && !wasOpen) { sfx.open(); texts.push({ x: gx(exit.x + 0.5), y: gy(exit.y + 0.5) - 8, text: '출구 열림!', t: 0, big: true }); }
  wasOpen = open;
}

function win() {
  if (state !== 'play') return;
  state = 'won';
  const parts = L.clearScore(level, { time, par: L.parTime(spec), lives, bombsLeft: stock, kills });
  score += parts.total;
  updateHud();
  sfx.win();
  const sec = time.toFixed(1);
  winTimer = setTimeout(() => showOverlay(`
    <h2 class="inked">STAGE ${level} 클리어!</h2>
    <div class="big inked">${parts.total.toLocaleString()}</div>
    <div class="card"><dl class="stats">
      <dt>클리어</dt><dd>+${parts.base}</dd>
      <dt>속도 (${sec}초)</dt><dd>+${parts.speed}</dd>
      <dt>남은 목숨 ${lives}</dt><dd>+${parts.lives}</dd>
      <dt>아낀 폭탄 ${stock}</dt><dd>+${parts.bombs}</dd>
      <dt>잡은 적 ${kills}</dt><dd>+${parts.kills}</dd>
    </dl></div>
    <button data-act="next">다음 스테이지</button>`), 700);
}

function gameOver() {
  state = 'over';
  sfx.over();
  const isBest = score > 0 && score >= best;
  winTimer = setTimeout(() => showOverlay(`
    <h2 class="inked">GAME OVER</h2>
    <div class="big inked">${score.toLocaleString()}</div>
    <span class="tag">STAGE ${level}까지 갔어요</span>
    ${isBest ? '<p>🏆 최고 기록!</p>' : ''}
    <button data-act="again">다시 하기</button>
    <button class="sub" data-act="menu">← 처음으로</button>`), 900);
}

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (state === 'play' || state === 'won') tickWorld(dt);
  shake = Math.max(0, shake - dt);
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const t of texts) { t.t += dt; t.y -= 26 * dt; }
  texts = texts.filter((t) => t.t < 1.1);
  if (banner) { banner.t += dt; if (banner.t > 1.3) banner = null; }
  for (const e of enemies) if (!e.alive && e.dead > 0) e.dead -= dt;
}

function tickWorld(dt) {
  const playing = state === 'play';
  if (playing) time += dt;
  if (player.inv > 0) player.inv -= dt;

  // 플레이어
  if (playing) {
    advance(player, dt, PLAYER_SPEED, pickPlayerDir);
    const [px, py] = at(player);
    const k = key(n, px, py);
    if (items[k] && !wallAt(px, py)) pickUp(k);
  }
  // 적
  for (const e of enemies) {
    if (!e.alive) continue;
    if (playing) {
      advance(e, dt, enemySpeed(e), (m) => L.enemyChoose(n, enemyBlocked(e), m, enemyAim(player), Math.random, e.type === 'chaser'));
    }
  }
  // 폭탄
  for (const b of bombs) {
    b.t -= dt;
    if (!b.solid && !(player.x === b.x && player.y === b.y) && !(player.p < 1 && player.fx === b.x && player.fy === b.y)) b.solid = true;
  }
  for (const b of bombs.slice()) if (b.t <= 0) explode(b);
  // 불길
  for (const f of flames) f.t -= dt;
  flames = flames.filter((f) => f.t > 0);
  if (flames.length) {
    const fs = new Set(flames.map((f) => key(n, f.x, f.y)));
    if (playing) {
      const [px, py] = at(player);
      if (fs.has(key(n, px, py))) hitPlayer();
    }
    for (const e of enemies) {
      if (!e.alive) continue;
      const [ex, ey] = at(e);
      if (fs.has(key(n, ex, ey))) killEnemy(e);
    }
  }
  if (!playing) return;
  // 적과 부딪힘
  if (player.inv <= 0) {
    const pp = at2(player);
    for (const e of enemies) {
      if (!e.alive) continue;
      const ep = at2(e);
      if (Math.hypot(pp.x - ep.x, pp.y - ep.y) < 0.62) { hitPlayer(); break; }
    }
  }
  if (state !== 'play') return;
  // 출구
  const [px, py] = at(player);
  if (px === exit.x && py === exit.y && exitOpen()) return win();
  // 폭탄이 바닥나 더는 못 푸는 판
  const spare = Object.entries(items).some(([k, t]) => t === 'bomb' && g[k] !== SOFT);
  if (stock <= 0 && !bombs.length && !flames.length && !spare && !exitOpen()) {
    stuckT += dt;
    if (stuckT > 1.4) outOfBombs();
  } else stuckT = 0;
}

function outOfBombs() {
  stuckT = 0;
  lives--;
  updateHud();
  sfx.hurt();
  if (lives <= 0) return gameOver();
  newLevel(level, true);
  banner = { text: '폭탄이 떨어졌어요 · 목숨 −1', t: 0, small: true };
}

function pickUp(k) {
  const t = items[k];
  delete items[k];
  const p = at2(player);
  const px = gx(p.x + 0.5), py = gy(p.y + 0.5);
  if (t === 'bomb') { stock++; texts.push({ x: px, y: py, text: '폭탄 +1', t: 0, big: true }); }
  else if (t === 'range') { range = Math.min(MAX_RANGE, range + 1); texts.push({ x: px, y: py, text: '불길 +1', t: 0, big: true }); }
  else { lives = Math.min(L.MAX_LIVES, lives + 1); texts.push({ x: px, y: py, text: '목숨 +1', t: 0, big: true }); }
  sfx.item();
  puff(px, py, '#ffd23f', 8);
  updateHud();
}

// ---------- 그리기 ----------
function label(text, x, y, size, fill = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.2); ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function panel(x, y, w, h, r, fill, lift = 4) {
  ctx.fillStyle = INK; roundRect(ctx, x, y + lift, w, h, r); ctx.fill();
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; roundRect(ctx, x, y, w, h, r); ctx.stroke();
}

function drawFloor() {
  ctx.fillStyle = INK; roundRect(ctx, GX - 4, GY - 4, GW + 8, GW + 8, 12); ctx.fill();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#ece2c6' : '#e6dbbb';
      ctx.fillRect(gx(x), gy(y), cell + 0.5, cell + 0.5);
    }
  }
}

function drawWall(x, y) {
  const c = g[key(n, x, y)], lift = cell * 0.1, m = 1;
  const px = gx(x) + m, py = gy(y) + m, s = cell - m * 2;
  const soft = c === SOFT;
  ctx.fillStyle = soft ? '#a2532f' : '#4a5170';
  roundRect(ctx, px, py + lift, s, s - lift, 5); ctx.fill();
  ctx.fillStyle = soft ? '#e8945f' : '#7c85a8';
  roundRect(ctx, px, py, s, s - lift, 5); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK; roundRect(ctx, px, py, s, s, 5); ctx.stroke();
  if (soft) {
    // 나무 상자: 널빤지 줄 두 개
    ctx.strokeStyle = 'rgba(120,50,20,.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 4, py + s * 0.36); ctx.lineTo(px + s - 4, py + s * 0.36);
    ctx.moveTo(px + 4, py + s * 0.64 - lift / 2); ctx.lineTo(px + s - 4, py + s * 0.64 - lift / 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    roundRect(ctx, px + 4, py + 4, s - 8, 4, 2); ctx.fill();
  }
}

function drawItem(k, t) {
  const x = k % n, y = Math.floor(k / n);
  const cx = gx(x + 0.5), cy = gy(y + 0.5) + Math.sin(clock * 4 + k) * 2;
  ctx.fillStyle = 'rgba(43,29,82,.25)'; ctx.beginPath(); ctx.ellipse(cx, gy(y + 0.5) + cell * 0.3, cell * 0.24, cell * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, cell * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = `${cell * 0.36}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  ctx.fillText(t === 'bomb' ? '💣' : t === 'range' ? '🔥' : '❤️', cx, cy + 1);
}

function drawExit() {
  const cx = gx(exit.x + 0.5), cy = gy(exit.y + 0.5), r = cell * 0.36, open = exitOpen();
  ctx.fillStyle = open ? '#ffd23f' : '#3b3358';
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (open) {
    const k = 0.5 + Math.sin(clock * 6) * 0.5;
    ctx.fillStyle = `rgba(255,247,194,${0.55 + k * 0.35})`;
    ctx.beginPath(); ctx.arc(cx, cy, r * (0.55 + k * 0.15), 0, Math.PI * 2); ctx.fill();
    ctx.font = `${cell * 0.4}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText('⭐', cx, cy + 1);
  } else {
    ctx.font = `${cell * 0.34}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
    ctx.fillText('🔒', cx, cy + 1);
  }
}

function drawBomb(b) {
  const cx = gx(b.x + 0.5), cy = gy(b.y + 0.5) + cell * 0.04;
  const hurry = b.t < 0.8;
  const s = 1 + Math.sin(clock * (hurry ? 24 : 8)) * (hurry ? 0.1 : 0.05);
  const r = cell * 0.33 * s;
  ctx.fillStyle = 'rgba(43,29,82,.3)'; ctx.beginPath(); ctx.ellipse(cx, gy(b.y + 0.5) + cell * 0.33, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = hurry && Math.floor(clock * 12) % 2 ? '#ff5a5a' : '#2f2748';
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy - r * 0.4, r * 0.22, r * 0.14, -0.6, 0, Math.PI * 2); ctx.fill();
  // 심지 + 불꽃
  ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx + r * 0.3, cy - r * 0.85); ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 0.9, cy - r * 1.25); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = Math.floor(clock * 14) % 2 ? '#ffd23f' : '#ff8a3d';
  ctx.beginPath(); ctx.arc(cx + r * 0.95, cy - r * 1.28, 3.5 + Math.sin(clock * 30), 0, Math.PI * 2); ctx.fill();
}

function drawFlame(f) {
  const k = Math.min(1, f.t / (FLAME_T * 0.6)), m = cell * 0.06;
  ctx.globalAlpha = k;
  ctx.fillStyle = '#ff9f1c'; roundRect(ctx, gx(f.x) + m, gy(f.y) + m, cell - m * 2, cell - m * 2, 8); ctx.fill();
  ctx.fillStyle = '#ffe27a'; roundRect(ctx, gx(f.x) + cell * 0.22, gy(f.y) + cell * 0.22, cell * 0.56, cell * 0.56, 6); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const p = at2(player), cx = gx(p.x + 0.5), moving = player.p < 1;
  const bob = moving ? Math.abs(Math.sin(clock * 16)) * 2.2 : 0;
  const cy = gy(p.y + 0.5) - bob, r = cell * 0.36;
  if (player.inv > 0 && Math.floor(clock * 14) % 2) return;
  ctx.fillStyle = 'rgba(43,29,82,.3)'; ctx.beginPath(); ctx.ellipse(cx, gy(p.y + 0.5) + cell * 0.32, r * 0.85, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
  ctx.fillStyle = '#fff8ea'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 파란 헬멧
  ctx.fillStyle = '#5aa9ff';
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI * 1.08, Math.PI * 1.92); ctx.lineTo(cx + r * 0.9, cy - r * 0.42); ctx.lineTo(cx - r * 0.9, cy - r * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff5fa2'; ctx.beginPath(); ctx.arc(cx, cy - r * 1.08, r * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 눈은 가는 쪽을 봄
  const [dx, dy] = DIRS[player.dir];
  ctx.fillStyle = INK;
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * r * 0.36 + dx * r * 0.14, cy + r * 0.18 + dy * r * 0.12, r * 0.11, r * 0.15, 0, 0, Math.PI * 2); ctx.fill(); }
}

function drawEnemy(e) {
  const p = at2(e), cx = gx(p.x + 0.5), base = gy(p.y + 0.5);
  if (!e.alive) {
    if (e.dead <= 0) return;
    ctx.globalAlpha = e.dead / DEAD_T;
  }
  const t = clock * 6 + p.x * 3, r = cell * 0.36;
  const squish = 1 + Math.sin(t) * 0.07;
  ctx.fillStyle = 'rgba(43,29,82,.28)'; ctx.beginPath(); ctx.ellipse(cx, base + cell * 0.32, r * 0.9, r * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = INK;
  if (e.type === 'chaser') {
    const cy = base - cell * 0.04 + Math.sin(t * 0.8) * 2;
    ctx.fillStyle = '#a58bea';
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.lineTo(cx + r, cy + r * 0.85);
    for (let i = 3; i >= 0; i--) {
      const wx = cx - r + (r * 2) * (i / 3), wob = Math.sin(t * 2 + i) * 2;
      ctx.lineTo(wx + (i === 3 ? 0 : r / 3), cy + r * (i % 2 ? 0.85 : 1.1) + wob);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * r * 0.38, cy - r * 0.05, r * 0.2, r * 0.26, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = INK;
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * r * 0.38 + (player ? Math.sign(at2(player).x - p.x) * 2 : 0), cy - r * 0.02, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
    // 화난 눈썹
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.65, cy - r * 0.5); ctx.lineTo(cx - r * 0.15, cy - r * 0.28); ctx.moveTo(cx + r * 0.65, cy - r * 0.5); ctx.lineTo(cx + r * 0.15, cy - r * 0.28); ctx.stroke();
  } else {
    const cy = base + cell * 0.04;
    ctx.fillStyle = '#7fd18b';
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.05 * squish, r * 0.86 / squish, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(cx - r * 0.42, cy - r * 0.42, r * 0.2, r * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * r * 0.36, cy - r * 0.08, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = INK;
    const [dx] = DIRS[e.dir];
    for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * r * 0.36 + dx * 2, cy - r * 0.06, r * 0.1, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

function drawControls() {
  const pressed = new Set(held.map((h) => h.dir));
  const glyph = { 0: [[0, -1], [-1, 1], [1, 1]], 1: [[1, 0], [-1, -1], [-1, 1]], 2: [[0, 1], [-1, -1], [1, -1]], 3: [[-1, 0], [1, -1], [1, 1]] };
  for (const b of PAD) {
    const on = pressed.has(b.dir);
    panel(b.x, b.y + (on ? 3 : 0), b.w, b.h, 16, on ? '#fff' : '#ffd23f', on ? 1 : 5);
    ctx.fillStyle = INK; ctx.beginPath();
    glyph[b.dir].forEach(([ox, oy], i) => { const px = b.x + b.w / 2 + ox * 11, py = b.y + b.h / 2 + oy * 11 + (on ? 3 : 0); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.closePath(); ctx.fill();
  }
  const bx = BOMB_BTN.x, by = BOMB_BTN.y + (bombPressed ? 3 : 0), br = BOMB_BTN.r;
  const ready = stock > 0 && bombs.length < spec.maxBombs && state === 'play';
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(bx, by + (bombPressed ? 1 : 5), br, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = ready ? '#ff5fa2' : '#d9d3ea'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  ctx.font = `${br * 0.9}px ${EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.globalAlpha = ready ? 1 : 0.55; ctx.fillStyle = '#000';
  ctx.fillText('💣', bx, by + 3); ctx.globalAlpha = 1;
  // 남은 폭탄 뱃지
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx + br * 0.72, by - br * 0.72, 17, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
  ctx.font = `20px ${FONT}`; ctx.fillStyle = stock > 0 ? INK : '#e0405f'; ctx.fillText(String(stock), bx + br * 0.72, by - br * 0.72 + 1);
  panel(RESTART_BTN.x, RESTART_BTN.y, RESTART_BTN.w, RESTART_BTN.h, 16, '#fff', 4);
  ctx.font = `17px ${FONT}`; ctx.fillStyle = INK; ctx.fillText('🔄 다시', RESTART_BTN.x + RESTART_BTN.w / 2, RESTART_BTN.y + RESTART_BTN.h / 2 + 1);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (!g.length) return;
  // 위쪽 안내줄
  label('♥'.repeat(Math.max(0, lives)), 14, 26, 26, '#ff7eb6', 'left');
  label(`STAGE ${level}`, W / 2, 26, 22, '#ffd23f');
  label(`${time.toFixed(1)}초`, W - 14, 26, 22, '#fff', 'right');
  label(`💣 ${stock}`, 14, 56, 20, '#fff', 'left');
  label(`👾 ${aliveCount()}`, W / 2, 56, 20, aliveCount() ? '#fff' : '#ffd23f');
  label(`🔥 ${range}`, W - 14, 56, 20, '#fff', 'right');

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
  drawFloor();
  if (exitRevealed()) drawExit();
  for (const [k, t] of Object.entries(items)) if (!wallAt(k % n, Math.floor(k / n))) drawItem(Number(k), t);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[key(n, x, y)] !== EMPTY) drawWall(x, y);
  for (const b of bombs) drawBomb(b);
  for (const f of flames) drawFlame(f);
  // 위쪽 줄부터 그려 아래 캐릭터가 앞에 오게
  const sprites = [...enemies.map((e) => ({ y: at2(e).y, f: () => drawEnemy(e) })), { y: at2(player).y + 0.01, f: drawPlayer }].sort((a, b) => a.y - b.y);
  for (const s of sprites) s.f();

  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = INK; ctx.fillRect(p.x - p.size / 2 - 1, p.y - p.size / 2 - 1, p.size + 2, p.size + 2);
    ctx.fillStyle = p.col; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, (1.1 - t.t) * 3);
    label(t.text, t.x, t.y, t.big ? 20 : 16, t.big ? '#ffd23f' : '#fff');
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawControls();

  if (banner && state === 'play') {
    const s = 1 + Math.max(0, 0.25 - banner.t) * 1.6;
    ctx.save(); ctx.globalAlpha = Math.min(1, (1.3 - banner.t) * 3);
    ctx.translate(W / 2, banner.small ? GY + GW / 2 : GY + GW / 2 - 20); ctx.scale(s, s);
    label(banner.text, 0, 0, banner.small ? 24 : 44, banner.small ? '#ff9ecb' : '#ffd23f');
    ctx.restore();
  }
  if (state === 'play' && exitRevealed() && aliveCount() > 0 && Math.floor(clock * 1.4) % 2 === 0) {
    label(`적 ${aliveCount()}마리를 없애면 출구가 열려요`, W / 2, GY + GW + 20, 15, '#fff');
  } else if (state === 'play' && !exitRevealed() && aliveCount() === 0) {
    label('출구는 상자 밑에 숨어 있어요!', W / 2, GY + GW + 20, 15, '#ffd23f');
  }
}

// ---------- 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (state !== 'paused') update(dt);
  draw();
  requestAnimationFrame(frame);
}

// ---------- 오버레이 ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

function showMenu() {
  state = 'menu';
  held = [];
  showOverlay(`
    <h1>봄버 <span class="p">미로</span></h1>
    <p>폭탄으로 상자를 부수고 <b>적을 모두 없앤 뒤</b><br>숨어 있는 출구로 탈출해요!</p>
    <button data-act="again">시작하기</button>
    <div class="card">
      <span class="touch">🕹️ 방향 버튼으로 이동, 💣 버튼으로 폭탄 놓기<br></span>
      <span class="pc">⌨️ 방향키 / WASD 이동 · Space 폭탄<br></span>
      💥 폭발은 <b>내가 맞아도</b> 아파요! 놓고 도망쳐요<br>
      📦 판마다 폭탄 개수가 정해져 있어요 (상자 속 💣 +1)<br>
      ⚡ 빨리 깰수록, 목숨·폭탄을 아낄수록 높은 점수
    </div>`);
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'again') startRun();
  else if (act === 'next') newLevel(level + 1);
  else if (act === 'menu') showMenu();
  else if (act === 'continue') resume();
});
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2 class="inked">일시정지</h2><button data-act="continue">계속하기</button>
    <button class="sub" data-act="menu">← 그만하기</button>`);
}
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }

// ---------- 입력 ----------
function press(src, dir) { held = held.filter((h) => h.src !== src); held.push({ src, dir }); }
function release(src) { held = held.filter((h) => h.src !== src); }

function toLogical(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
}
const padDirAt = (p) => { const b = PAD.find((q) => p.x >= q.x - 8 && p.x <= q.x + q.w + 8 && p.y >= q.y - 8 && p.y <= q.y + q.h + 8); return b ? b.dir : -1; };
const inBomb = (p) => Math.hypot(p.x - BOMB_BTN.x, p.y - BOMB_BTN.y) <= BOMB_BTN.r + 10;
const inRestart = (p) => p.x >= RESTART_BTN.x && p.x <= RESTART_BTN.x + RESTART_BTN.w && p.y >= RESTART_BTN.y - 4 && p.y <= RESTART_BTN.y + RESTART_BTN.h + 6;
let bombPressed = false;
const bombPointers = new Set();

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  const p = toLogical(e);
  const d = padDirAt(p);
  if (d >= 0) { canvas.setPointerCapture(e.pointerId); press('p' + e.pointerId, d); return; }
  if (inBomb(p)) { canvas.setPointerCapture(e.pointerId); bombPointers.add(e.pointerId); bombPressed = true; placeBomb(); return; }
  if (inRestart(p)) newLevel(level, true);
});
canvas.addEventListener('pointermove', (e) => {
  const src = 'p' + e.pointerId;
  if (!held.some((h) => h.src === src)) return;
  const d = padDirAt(toLogical(e));
  if (d < 0) release(src); else press(src, d);
});
const lift = (e) => {
  release('p' + e.pointerId);
  bombPointers.delete(e.pointerId);
  bombPressed = bombPointers.size > 0;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

const KEY_DIR = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
addEventListener('keydown', (e) => {
  if (e.code in KEY_DIR || e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code in KEY_DIR) { press(e.code, KEY_DIR[e.code]); return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { state === 'paused' ? resume() : pause(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyX') {
    if (state === 'play') placeBomb();
    else if (state === 'menu' || state === 'over') startRun();
    else if (state === 'won') newLevel(level + 1);
    return;
  }
  if (e.code === 'KeyR' && state === 'play') newLevel(level, true);
});
addEventListener('keyup', (e) => { if (e.code in KEY_DIR) release(e.code); });
addEventListener('blur', () => { held = []; pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { held = []; pause(); } });

function toggleMute() {
  muted = !muted;
  store.set('bomberMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// 첫 화면 뒤에 흐릿하게 보일 판
newLevel(1);
state = 'menu';
updateHud();
showMenu();
fit();
requestAnimationFrame(frame);

// 테스트용
window.__bm = {
  get state() { return state; }, get level() { return level; }, get score() { return score; }, get lives() { return lives; }, get stock() { return stock; },
  get player() { return player; }, get enemies() { return enemies; }, get bombs() { return bombs; }, get flames() { return flames; },
  get g() { return g; }, get items() { return items; }, get exit() { return exit; }, get n() { return n; }, get time() { return time; }, get kills() { return kills; },
  placeBomb, newLevel, startRun, press, release, exitOpen, killEnemy, hitPlayer, win, explode, showMenu, update,
};
})();
