'use strict';

// 봄버맨 미로: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// 판은 n×n 칸. 바깥 테두리와 (짝수, 짝수) 칸은 안 부서지는 기둥, 나머지는 빈칸 또는 부술 수 있는 벽.
// 출구는 벽 하나 밑에 숨어 있고, 적을 모두 없애야 열린다. 폭탄은 판마다 정해진 개수만 쓸 수 있다.
const EMPTY = 0, HARD = 1, SOFT = 2;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // 위 · 오른쪽 · 아래 · 왼쪽
const START = [1, 1];
const MAX_LIVES = 5;

const key = (n, x, y) => y * n + x;
const isHardCell = (n, x, y) => x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x % 2 === 0 && y % 2 === 0);

// ---------- 레벨 ----------
// 1~3레벨은 9×9, 4레벨부터 11×11. 레벨이 오를수록 벽이 빽빽해지고 적이 늘며 추격형이 섞인다
function levelSpec(n) {
  return {
    size: n <= 3 ? 9 : 11,
    enemies: Math.min(2 + Math.floor((n - 1) / 2), 7),
    chasers: n < 3 ? 0 : Math.min(Math.floor((n - 1) / 2), 4),   // 그중 플레이어를 쫓아오는 수
    density: Math.min(0.5 + n * 0.02, 0.66),                     // 빈칸 중 벽이 되는 비율
    fuse: 2.2,
    range: 2,
    maxBombs: 2,                                                 // 동시에 놓을 수 있는 수
  };
}

// 시작점에서 각 칸까지 부숴야 하는 벽 수 (0-1 BFS). 기둥은 못 지나감
function wallCost(n, g, from = START) {
  const INF = 1e9, dist = new Array(n * n).fill(INF);
  const dq = [[from[0], from[1]]];
  dist[key(n, from[0], from[1])] = 0;
  while (dq.length) {
    const [x, y] = dq.shift();
    const d = dist[key(n, x, y)];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || g[key(n, nx, ny)] === HARD) continue;
      const w = g[key(n, nx, ny)] === SOFT ? 1 : 0;
      if (d + w < dist[key(n, nx, ny)]) {
        dist[key(n, nx, ny)] = d + w;
        w ? dq.push([nx, ny]) : dq.unshift([nx, ny]);
      }
    }
  }
  return dist;
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const ITEM_WEIGHTS = [['bomb', 5], ['range', 3], ['life', 1]];
function randomItem(rng) {
  let r = rng() * ITEM_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  for (const [t, w] of ITEM_WEIGHTS) if ((r -= w) < 0) return t;
  return 'bomb';
}

// 새 판. { n, g, items, exit, enemies, supply, spec }
//  - g: 칸 종류 배열
//  - items: { 칸 번호: 'bomb'|'range'|'life' } — 벽 밑에 숨어 있다가 벽이 부서지면 드러난다
//  - supply: 이 판에서 쓸 수 있는 폭탄 총 개수 (출구까지 부술 벽 + 적 잡기에 필요한 만큼만 넉넉하지 않게)
function generate(level, rng = Math.random) {
  const spec = levelSpec(level), n = spec.size;
  const g = new Array(n * n).fill(EMPTY);
  const safe = new Set([[1, 1], [2, 1], [1, 2]].map(([x, y]) => key(n, x, y)));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (isHardCell(n, x, y)) g[key(n, x, y)] = HARD;
      else if (!safe.has(key(n, x, y)) && rng() < spec.density) g[key(n, x, y)] = SOFT;
    }
  }
  const open = [];
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) if (g[key(n, x, y)] !== HARD) open.push([x, y]);
  const far = (x, y, d) => Math.abs(x - START[0]) + Math.abs(y - START[1]) >= d;

  // 출구: 멀리 있는 칸 중 하나를 벽으로 덮는다
  const exitCells = open.filter(([x, y]) => far(x, y, n - 2));
  const [ex, ey] = pick(exitCells, rng);
  g[key(n, ex, ey)] = SOFT;

  // 적: 시작점에서 떨어진 칸에 놓고 그 칸의 벽은 치운다
  const enemies = [];
  const spots = open.filter(([x, y]) => far(x, y, 6) && !(x === ex && y === ey));
  for (let i = 0; i < spec.enemies && spots.length; i++) {
    const [x, y] = spots.splice(Math.floor(rng() * spots.length), 1)[0];
    g[key(n, x, y)] = EMPTY;
    enemies.push({ x, y, type: i < spec.chasers ? 'chaser' : 'slime' });
  }

  // 아이템: 벽 밑에 숨김 (출구 벽 제외)
  const items = {};
  for (const [x, y] of open) {
    if (g[key(n, x, y)] === SOFT && !(x === ex && y === ey) && rng() < 0.2) items[key(n, x, y)] = randomItem(rng);
  }

  // 폭탄 개수: 출구까지 부술 벽 수 + 적 하나당 (1 + 그 적에게 가려고 부술 벽) 의 7할 + 여유 2
  const cost = wallCost(n, g);
  let need = cost[key(n, ex, ey)];
  let foes = 0;
  for (const e of enemies) foes += 1 + cost[key(n, e.x, e.y)];
  const supply = Math.max(6, need + Math.ceil(foes * 0.7) + 2);
  return { n, g, items, exit: { x: ex, y: ey }, enemies, supply, spec };
}

// ---------- 폭발 ----------
// bombs: [{ x, y, range }], origin: 터지는 폭탄. 불길은 십자 모양으로 range 칸, 기둥에서 멈추고
// 벽은 하나 부수고 멈춘다. 불길에 닿은 다른 폭탄도 같이 터진다(연쇄).
// 돌려주는 값: { flames: [[x,y]...], broken: [[x,y]...], chain: [폭탄...] } (chain 에 origin 도 들어 있다)
function blast(n, g, bombs, origin) {
  const flames = new Map(), broken = new Map(), chain = [], seen = new Set();
  const queue = [origin];
  seen.add(origin);
  while (queue.length) {
    const b = queue.shift();
    chain.push(b);
    flames.set(key(n, b.x, b.y), [b.x, b.y]);
    for (const [dx, dy] of DIRS) {
      for (let k = 1; k <= b.range; k++) {
        const x = b.x + dx * k, y = b.y + dy * k;
        if (x < 0 || y < 0 || x >= n || y >= n) break;
        const c = g[key(n, x, y)];
        if (c === HARD) break;
        flames.set(key(n, x, y), [x, y]);
        if (c === SOFT) { broken.set(key(n, x, y), [x, y]); break; }
        const other = bombs.find((o) => !seen.has(o) && o.x === x && o.y === y);
        if (other) { seen.add(other); queue.push(other); break; }
      }
    }
  }
  return { flames: [...flames.values()], broken: [...broken.values()], chain };
}

// ---------- 적 움직임 ----------
// blocked(x, y): 적이 못 들어가는 칸인가. 돌려주는 값은 방향 번호(0~3), 갈 곳이 없으면 -1
function freeDirs(n, blocked, x, y) {
  const out = [];
  DIRS.forEach(([dx, dy], d) => {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < n && ny < n && !blocked(nx, ny)) out.push(d);
  });
  return out;
}

// 목표 칸으로 가는 첫 걸음 (막히지 않은 칸만 지나는 최단 경로). 못 가면 -1, maxLen 보다 멀어도 -1
function stepToward(n, blocked, from, to, maxLen = 12) {
  const start = key(n, from[0], from[1]), goal = key(n, to[0], to[1]);
  if (start === goal) return -1;
  const first = new Map([[start, -1]]), depth = new Map([[start, 0]]);
  const q = [from];
  while (q.length) {
    const [x, y] = q.shift();
    const dk = depth.get(key(n, x, y));
    if (dk >= maxLen) continue;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const k = key(n, nx, ny);
      if (first.has(k)) continue;
      if (k !== goal && blocked(nx, ny)) continue;
      first.set(k, first.get(key(n, x, y)) === -1 ? d : first.get(key(n, x, y)));
      depth.set(k, dk + 1);
      if (k === goal) return first.get(k);
      q.push([nx, ny]);
    }
  }
  return -1;
}

// 적이 다음에 갈 방향. 슬라임은 앞으로 쭉 가다 가끔 꺾고, 추격형은 가까우면 플레이어 쪽으로 온다
function enemyChoose(n, blocked, e, player, rng, chase) {
  const dirs = freeDirs(n, blocked, e.x, e.y);
  if (!dirs.length) return -1;
  if (chase && rng() < 0.85) {
    const d = stepToward(n, blocked, [e.x, e.y], player);
    if (d >= 0) return d;
  }
  const back = e.dir === undefined ? -1 : (e.dir + 2) % 4;
  const ahead = dirs.includes(e.dir) && rng() < 0.7;
  if (ahead) return e.dir;
  const others = dirs.filter((d) => d !== back);
  return others.length ? pick(others, rng) : dirs[0];
}

// ---------- 점수 ----------
// 클리어 점수: 기본 + 빨리 깰수록 + 남은 목숨 + 아낀 폭탄 + 잡은 적
function clearScore(level, { time, par, lives, bombsLeft, kills }) {
  const parts = {
    base: 500 + level * 100,
    speed: Math.max(0, Math.round((par - time) * 10)),
    lives: lives * 300,
    bombs: bombsLeft * 50,
    kills: kills * 100,
  };
  parts.total = parts.base + parts.speed + parts.lives + parts.bombs + parts.kills;
  return parts;
}
const parTime = (spec) => 50 + spec.enemies * 10;

const LOGIC = { EMPTY, HARD, SOFT, DIRS, START, MAX_LIVES, levelSpec, generate, wallCost, blast, freeDirs, stepToward, enemyChoose, clearScore, parTime, key };
if (typeof module !== 'undefined') module.exports = LOGIC;
