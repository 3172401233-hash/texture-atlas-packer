import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packTextures } from '../src/index.js';
import {
  generateSquares,
  generateStrips,
  generateZeroSize,
  assertValidAtlas,
} from './helpers.js';

describe('单页布局', () => {
  it('无间距时四等分铺满整页，利用率为 1', () => {
    const config = { pageWidth: 100, pageHeight: 100, padding: 0, gutter: 0 };
    const result = packTextures(generateSquares(4, 50), config);
    assertValidAtlas(generateSquares(4, 50), result, config);
    assert.equal(result.pageCount, 1);
    assert.equal(result.utilization, 1);
    const map = new Map(result.placements.map((p) => [p.id, p]));
    assert.deepEqual(
      [
        [map.get('square-0000').x, map.get('square-0000').y],
        [map.get('square-0001').x, map.get('square-0001').y],
        [map.get('square-0002').x, map.get('square-0002').y],
        [map.get('square-0003').x, map.get('square-0003').y],
      ],
      [
        [0, 0],
        [0, 50],
        [50, 0],
        [50, 50],
      ],
    );
  });

  it('边缘留白与页间间距被严格保留', () => {
    const config = { pageWidth: 60, pageHeight: 60, padding: 5, gutter: 4 };
    const textures = generateSquares(4, 20);
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 1);
    const map = new Map(result.placements.map((p) => [p.id, p]));
    const first = map.get('square-0000');
    const second = map.get('square-0001');
    assert.equal(first.x, 5);
    assert.equal(first.y, 5);
    assert.equal(second.x, 5);
    assert.equal(second.y, 29);
    assert.equal(second.y - (first.y + first.height), 4);
    const right = map.get('square-0002');
    assert.equal(right.x, 29);
    assert.equal(right.y, 5);
    assert.equal(right.x - (first.x + first.width), 4);
    assert.equal(result.pages[0].utilization, 1600 / 3600);
    assert.equal(result.pages[0].contentUtilization, 1600 / 2500);
  });
});

describe('多页输出', () => {
  it('当前页放不下时自动开启后续页面，不中断任务', () => {
    const config = { pageWidth: 32, pageHeight: 32, padding: 0, gutter: 0 };
    const textures = generateSquares(10, 16);
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 3);
    assert.deepEqual(
      result.pages.map((p) => p.textureCount),
      [4, 4, 2],
    );
    assert.deepEqual(
      result.pages.map((p) => p.utilization),
      [1, 1, 0.5],
    );
    const pages = new Set(result.placements.map((p) => p.page));
    assert.deepEqual([...pages].sort(), [0, 1, 2]);
  });

  it('带 gutter 时按单元尺寸分页并保持间隔', () => {
    const config = { pageWidth: 64, pageHeight: 64, padding: 2, gutter: 2 };
    const textures = generateSquares(6, 20);
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 2);
    assert.equal(result.pages[0].textureCount, 4);
    assert.equal(result.pages[1].textureCount, 2);
  });
});

describe('90 度旋转', () => {
  it('旋转得分更优时顺时针旋转 90 度并输出对应 UV 角点', () => {
    const config = { pageWidth: 100, pageHeight: 100, padding: 0, gutter: 0 };
    const textures = [
      { id: 'block', width: 70, height: 70, rotatable: true },
      { id: 'rot', width: 25, height: 45, rotatable: true },
    ];
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    const rotated = result.placements.find((p) => p.id === 'rot');
    assert.equal(rotated.rotated, true);
    assert.equal(rotated.width, 45);
    assert.equal(rotated.height, 25);
    assert.deepEqual([rotated.x, rotated.y], [0, 70]);
    assert.deepEqual(rotated.uv, {
      u0: 0,
      v0: 0.7,
      u1: 0.45,
      v1: 0.95,
    });
    assert.deepEqual(rotated.uvCorners, {
      tl: { u: 0, v: 0.95 },
      tr: { u: 0, v: 0.7 },
      br: { u: 0.45, v: 0.7 },
      bl: { u: 0.45, v: 0.95 },
    });
  });

  it('不可旋转的长条始终保持原朝向，靠多页容纳', () => {
    const config = { pageWidth: 80, pageHeight: 80, padding: 0, gutter: 0 };
    const textures = generateStrips(6, 70, 12, { rotatable: false });
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.ok(result.pageCount >= 2);
    for (const placement of result.placements) {
      assert.equal(placement.rotated, false);
    }
  });
});

describe('固定页面', () => {
  it('固定项只进入指定页面，非固定项按页顺序填充', () => {
    const config = { pageWidth: 200, pageHeight: 200, padding: 0, gutter: 0 };
    const textures = [
      { id: 'page1', width: 50, height: 50, fixedPage: 1 },
      { id: 'page0', width: 50, height: 50, fixedPage: 0 },
      { id: 'free', width: 50, height: 50 },
    ];
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 2);
    const map = new Map(result.placements.map((p) => [p.id, p]));
    assert.equal(map.get('page0').page, 0);
    assert.equal(map.get('page1').page, 1);
    assert.equal(map.get('free').page, 0);
  });

  it('零尺寸纹理落在指定页的留白原点，并可创建空的中间页', () => {
    const config = { pageWidth: 64, pageHeight: 64, padding: 4, gutter: 2 };
    const textures = [
      ...generateZeroSize(),
      { id: 'zero-fixed', width: 0, height: 0, fixedPage: 2 },
      { id: 'normal', width: 20, height: 20 },
    ];
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 3);
    assert.deepEqual(result.pages.map((p) => p.textureCount), [1, 0, 0]);
    const fixed = result.placements.find((p) => p.id === 'zero-fixed');
    assert.equal(fixed.page, 2);
    assert.deepEqual([fixed.x, fixed.y], [4, 4]);
    assert.equal(fixed.uv.u0, fixed.uv.u1);
    assert.equal(fixed.uv.v0, fixed.uv.v1);
  });
});

describe('优先级与 UV', () => {
  it('高优先级纹理先打包，低优先级被延迟到后续页面', () => {
    const config = { pageWidth: 100, pageHeight: 100, padding: 0, gutter: 0 };
    const textures = [
      { id: 'low', width: 60, height: 60, priority: 0 },
      { id: 'high', width: 50, height: 50, priority: 10 },
    ];
    const result = packTextures(textures, config);
    assertValidAtlas(textures, result, config);
    assert.equal(result.pageCount, 2);
    const map = new Map(result.placements.map((p) => [p.id, p]));
    assert.equal(map.get('high').page, 0);
    assert.equal(map.get('low').page, 1);
  });

  it('普通矩形的 UV 与像素坐标、页面尺寸严格对应', () => {
    const config = { pageWidth: 200, pageHeight: 100, padding: 0, gutter: 0 };
    const textures = [{ id: 'rect', width: 40, height: 20, rotatable: false }];
    const result = packTextures(textures, config);
    const placement = result.placements[0];
    assert.deepEqual(placement.uv, {
      u0: 0,
      v0: 0,
      u1: 0.2,
      v1: 0.2,
    });
    assert.deepEqual(placement.uvCorners, {
      tl: { u: 0, v: 0 },
      tr: { u: 0.2, v: 0 },
      br: { u: 0.2, v: 0.2 },
      bl: { u: 0, v: 0.2 },
    });
  });
});
