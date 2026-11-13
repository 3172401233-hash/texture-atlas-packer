import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { packTextures } from '../src/index.js';
import {
  createRng,
  generateFragments,
  generateGridRects,
  generateSquares,
  generateStrips,
  generateZeroSize,
  shuffled,
  assertValidAtlas,
} from './helpers.js';

const config = {
  pageWidth: 256,
  pageHeight: 256,
  padding: 2,
  gutter: 1,
};

function placementMap(result) {
  return new Map(
    result.placements
      .map((p) => [
        p.id,
        {
          page: p.page,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          rotated: p.rotated,
        },
      ])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );
}

describe('确定性', () => {
  it('相同输入重复运行产出完全一致的结果', () => {
    const textures = generateFragments(120, 99);
    const first = packTextures(textures, config);
    const second = packTextures(textures, config);
    assert.deepEqual(second, first);
  });

  it('输入顺序变化不改变布局（落位只由数据本身决定）', () => {
    const textures = [
      ...generateGridRects(4, 4, [
        [16, 16],
        [32, 16],
        [16, 32],
        [24, 24],
      ]),
      ...generateStrips(8, 80, 10),
      ...generateZeroSize(),
    ];
    const baseline = placementMap(packTextures(textures, config));
    for (const seed of [1, 7, 42, 1009]) {
      const reordered = shuffled(textures, seed);
      const actual = placementMap(packTextures(reordered, config));
      assert.deepEqual(actual, baseline, `seed=${seed} 时布局发生漂移`);
    }
  });

  it('同尺寸矩形的落位顺序由 ID 决定，与输入下标无关', () => {
    const textures = generateSquares(20, 24);
    const baseline = placementMap(packTextures(textures, config));
    const reversed = [...textures].reverse();
    assert.deepEqual(placementMap(packTextures(reversed, config)), baseline);
  });

  it('自由项顺序变化不会移动已有固定项', () => {
    const build = () => [
      { id: 'fixed-a', width: 60, height: 60, fixedPage: 0 },
      { id: 'fixed-b', width: 40, height: 90, fixedPage: 1 },
      ...generateFragments(60, 3),
      ...generateStrips(6, 120, 12),
    ];
    const baseline = packTextures(build(), config);
    assertValidAtlas(build(), baseline, config);
    const fixedBaseline = [...placementMap(baseline)].filter(([id]) =>
      id.startsWith('fixed-'),
    );
    for (const seed of [11, 22]) {
      const moved = packTextures(shuffled(build(), seed), config);
      const fixedMoved = [...placementMap(moved)].filter(([id]) =>
        id.startsWith('fixed-'),
      );
      assert.deepEqual(fixedMoved, fixedBaseline);
    }
  });
});

describe('高数量碎片纹理', () => {
  it('1000 个碎片纹理被完整、无重叠地放入多页且性能可接受', (t) => {
    const count = 1000;
    const textures = generateFragments(count, 2026);
    assert.equal(new Set(textures.map((t) => t.id)).size, count);

    const startedAt = performance.now();
    const result = packTextures(textures, config);
    const elapsedMs = performance.now() - startedAt;

    assertValidAtlas(textures, result, config);
    assert.equal(result.placements.length, count);
    assert.ok(result.pageCount >= 2);
    for (const page of result.pages) {
      assert.ok(page.utilization > 0 && page.utilization <= 1);
    }
    assert.ok(
      result.utilization > 0.5,
      `整体利用率异常偏低: ${result.utilization}`,
    );
    assert.ok(
      elapsedMs < 15000,
      `打包耗时过长: ${elapsedMs.toFixed(1)}ms`,
    );

    const secondRun = packTextures(textures, config);
    assert.deepEqual(secondRun, result);
    // 诊断信息：便于人工观察页面利用率与耗时
    result.pages.forEach((page) => {
      t.diagnostic(
        `page ${page.page}: count=${page.textureCount} ` +
          `utilization=${(page.utilization * 100).toFixed(2)}%`,
      );
    });
    t.diagnostic(
      `pages=${result.pageCount} overall=${(
        result.utilization * 100
      ).toFixed(2)}% elapsed=${elapsedMs.toFixed(1)}ms`,
    );
  });

  it('混合数据集（网格/长条/方形/零尺寸/固定页/优先级）稳定通过约束校验', () => {
    const rng = createRng(5462);
    const textures = [
      ...generateGridRects(6, 6, [
        [20, 20],
        [40, 20],
        [20, 40],
        [30, 30],
      ]),
      ...generateStrips(10, 180, 12),
      ...generateSquares(12, 48),
      ...generateZeroSize('mix-zero'),
      { id: 'pinned-0', width: 100, height: 100, fixedPage: 0 },
      { id: 'pinned-2', width: 80, height: 80, fixedPage: 3 },
    ].map((texture) =>
      rng() > 0.5
        ? { ...texture, priority: Math.floor(rng() * 5) }
        : texture,
    );

    const result = packTextures(shuffled(textures, 1234), config);
    assertValidAtlas(textures, result, config);
    const pinned2 = result.placements.find((p) => p.id === 'pinned-2');
    assert.equal(pinned2.page, 3);
    assert.equal(result.pageCount, 4);
  });
});
