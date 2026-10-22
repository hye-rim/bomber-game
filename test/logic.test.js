'use strict';
// 봄버맨 미로 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function rng(seed) {                                   // mulberry32 (시험용 고정 난수)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { EMPTY, HARD, SOFT } = L;
const at = (lv, x, y) => lv.g[L.key(lv.n, x, y)];
// 빈 판(기둥만): 9×9
function plain(n = 9) {
  const g = new Array(n * n).fill(EMPTY);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x % 2 === 0 && y % 2 === 0)) g[L.key(n, x, y)] = HARD;
  return g;
}

test('levels: 9x9 first, then 11x11, more walls and enemies, chasers from level 3', () => {
  assert.strictEqual(L.levelSpec(1).size, 9);
  assert.strictEqual(L.levelSpec(4).size, 11);
  assert.strictEqual(L.levelSpec(2).chasers, 0);
  assert.ok(L.levelSpec(3).chasers > 0);
  for (let n = 2; n <= 40; n++) {
    const a = L.levelSpec(n - 1), b = L.levelSpec(n);
    assert.ok(b.enemies >= a.enemies && b.density >= a.density && b.chasers <= b.enemies);
  }
});

test('generated mazes: pillars, a clear start, a hidden exit far away, reachable enemies, enough bombs', () => {
  for (let level = 1; level <= 20; level++) {
    for (let s = 1; s <= 10; s++) {
      const lv = L.generate(level, rng(level * 100 + s));
      const { n } = lv;
      assert.strictEqual(n, L.levelSpec(level).size);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const hard = x === 0 || y === 0 || x === n - 1 || y === n - 1 || (x % 2 === 0 && y % 2 === 0);
        assert.strictEqual(at(lv, x, y) === HARD, hard, `pillar layout at ${x},${y}`);
      }
      for (const [x, y] of [[1, 1], [2, 1], [1, 2]]) assert.strictEqual(at(lv, x, y), EMPTY, 'room to drop the first bomb');
      assert.strictEqual(at(lv, lv.exit.x, lv.exit.y), SOFT, 'the exit hides under a wall');
      assert.ok(lv.exit.x - 1 + lv.exit.y - 1 >= n - 2, 'the exit is far from the start');
      assert.strictEqual(lv.enemies.length, L.levelSpec(level).enemies);
      assert.strictEqual(lv.enemies.filter((e) => e.type === 'chaser').length, Math.min(L.levelSpec(level).chasers, lv.enemies.length));
      const cost = L.wallCost(n, lv.g);
      for (const e of lv.enemies) {
        assert.strictEqual(at(lv, e.x, e.y), EMPTY);
        assert.ok(e.x - 1 + e.y - 1 >= 6, 'enemies start away from the player');
        assert.ok(cost[L.key(n, e.x, e.y)] < 1e9);
      }
      const need = cost[L.key(n, lv.exit.x, lv.exit.y)];
      assert.ok(need >= 1 && need < 1e9, 'the exit can be reached');
      assert.ok(lv.supply >= need + 2 && lv.supply >= 6);
      for (const k of Object.keys(lv.items)) {
        assert.strictEqual(lv.g[k], SOFT, 'items are hidden under walls');
        assert.ok(['bomb', 'range', 'life'].includes(lv.items[k]));
      }
      assert.ok(!(L.key(n, lv.exit.x, lv.exit.y) in lv.items));
    }
  }
});

test('wallCost counts the walls you must break', () => {
  const g = plain();
  assert.strictEqual(L.wallCost(9, g)[L.key(9, 7, 7)], 0);
  g[L.key(9, 3, 1)] = SOFT; g[L.key(9, 1, 3)] = SOFT;
  assert.strictEqual(L.wallCost(9, g)[L.key(9, 5, 1)], 1);
  assert.strictEqual(L.wallCost(9, g)[L.key(9, 3, 1)], 1);
  assert.ok(L.wallCost(9, g)[L.key(9, 2, 2)] >= 1e9, 'pillars are never reachable');
});

test('blast: a cross of fire that stops at pillars, breaks one wall per direction and sets off other bombs', () => {
  const g = plain();
  g[L.key(9, 3, 1)] = SOFT; g[L.key(9, 4, 1)] = SOFT;
  const b1 = { x: 1, y: 1, range: 3 }, b2 = { x: 1, y: 3, range: 1 };
  const r = L.blast(9, g, [b1, b2], b1);
  const has = (list, x, y) => list.some(([a, b]) => a === x && b === y);
  assert.ok(has(r.broken, 3, 1) && !has(r.broken, 4, 1), 'only the first wall breaks');
  assert.ok(has(r.flames, 2, 1) && has(r.flames, 3, 1) && !has(r.flames, 4, 1));
  assert.ok(!has(r.flames, 0, 1), 'stops at the outer wall');
  assert.deepStrictEqual(r.chain, [b1, b2], 'the other bomb goes off too');
  assert.ok(has(r.flames, 1, 4), 'the second bomb burns its own cross');
  assert.ok(!has(r.flames, 2, 2), 'pillars never burn');
});

test('enemy movement: path finding and choices only into free cells', () => {
  const g = plain();
  const blocked = (x, y) => g[L.key(9, x, y)] !== EMPTY;
  assert.strictEqual(L.stepToward(9, blocked, [1, 1], [3, 1]), 1, 'go right');
  assert.strictEqual(L.stepToward(9, blocked, [1, 1], [1, 3]), 2, 'go down');
  assert.strictEqual(L.stepToward(9, blocked, [1, 1], [1, 1]), -1);
  assert.strictEqual(L.stepToward(9, blocked, [1, 1], [7, 7], 4), -1, 'too far');
  g[L.key(9, 2, 1)] = SOFT; g[L.key(9, 1, 2)] = SOFT;
  assert.strictEqual(L.stepToward(9, blocked, [1, 1], [7, 7]), -1, 'walled in');
  assert.strictEqual(L.enemyChoose(9, blocked, { x: 1, y: 1, dir: 0 }, [7, 7], rng(1), true), -1);
  const open = plain();
  const free = (x, y) => open[L.key(9, x, y)] !== EMPTY;
  const rand = rng(3);
  for (let k = 0; k < 200; k++) {
    const d = L.enemyChoose(9, free, { x: 3, y: 3, dir: k % 4 }, [7, 7], rand, k % 2 === 0);
    const nx = 3 + L.DIRS[d][0], ny = 3 + L.DIRS[d][1];
    assert.strictEqual(open[L.key(9, nx, ny)], EMPTY);
  }
});

test('clear score adds up its parts', () => {
  const s = L.clearScore(3, { time: 40, par: L.parTime(L.levelSpec(3)), lives: 2, bombsLeft: 4, kills: 3 });
  assert.strictEqual(s.total, s.base + s.speed + s.lives + s.bombs + s.kills);
  assert.strictEqual(s.base, 800);
  assert.strictEqual(L.clearScore(1, { time: 999, par: 60, lives: 0, bombsLeft: 0, kills: 0 }).speed, 0, 'slow clears get no speed bonus, never negative');
});
