import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pooled } from './pool.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('pooled', () => {
  test('never exceeds the concurrency ceiling, which is the whole point', async () => {
    let inFlight = 0;
    let peak = 0;
    await pooled(Array.from({ length: 40 }, (_u, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(1);
      inFlight -= 1;
    });
    assert.ok(peak <= 4, `peak concurrency was ${peak}`);
  });

  test('results line up with inputs even when later items finish first', async () => {
    const out = await pooled([30, 20, 10, 0], 4, async (ms, i) => {
      await tick(ms);
      return i;
    });
    assert.deepEqual(out, [0, 1, 2, 3]);
  });

  test('an empty list does no work and returns empty', async () => {
    let called = 0;
    const out = await pooled([], 4, async () => { called += 1; });
    assert.equal(called, 0);
    assert.deepEqual(out, []);
  });

  test('a limit of zero or below still runs, serially, rather than hanging', async () => {
    assert.deepEqual(await pooled([1, 2, 3], 0, async (n) => n * 2), [2, 4, 6]);
  });

  test('a rejection propagates rather than resolving with a hole', async () => {
    await assert.rejects(
      () => pooled([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
      /boom/,
    );
  });

  test('every item is processed exactly once', async () => {
    const seen: number[] = [];
    await pooled(Array.from({ length: 100 }, (_u, i) => i), 7, async (n) => {
      await tick(0);
      seen.push(n);
    });
    assert.equal(seen.length, 100);
    assert.equal(new Set(seen).size, 100);
  });
});
