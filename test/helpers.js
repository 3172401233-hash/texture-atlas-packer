import assert from 'node:assert/strict';

/**
 * mulberry32 确定性伪随机数生成器：相同 seed 永远产生相同序列，
 * 保证“代码生成的”测试数据在重复运行之间完全一致。
 */
export function createRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 规则尺寸矩形：宽高来自固定网格，覆盖正方形与普通矩形 */
export function generateGridRects(columns, rows, sizes, options = {}) {
  const list = [];
  let seq = 0;
  for (let col = 0; col < columns; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const size = sizes[(col * rows + row) % sizes.length];
      list.push({
        id: `grid-${String(seq).padStart(4, '0')}`,
        width: size[0],
        height: size[1],
        ...options,
      });
      seq += 1;
    }
  }
  return list;
}

/** 长条矩形：横向 / 纵向交替，用于逼迫旋转与多页 */
export function generateStrips(count, length, thickness, options = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `strip-${String(i).padStart(4, '0')}`,
    width: i % 2 === 0 ? length : thickness,
    height: i % 2 === 0 ? thickness : length,
    ...options,
  }));
}

/** 方形矩形 */
export function generateSquares(count, size, options = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `square-${String(i).padStart(4, '0')}`,
    width: size,
    height: size,
    ...options,
  }));
}

/** 超大矩形：可配置是否超出页面、是否允许旋转 */
export function makeOversized(id, width, height, options = {}) {
  return { id, width, height, ...options };
}

/** 高数量碎片矩形：尺寸在小范围内确定地变化 */
export function generateFragments(count, seed = 42) {
  const rng = createRng(seed);
  return Array.from({ length: count }, (_, i) => {
    const width = 4 + Math.floor(rng() * 13);
    const height = 4 + Math.floor(rng() * 13);
    return { id: `frag-${String(i).padStart(5, '0')}`, width, height };
  });
}

/** 零尺寸矩形（宽或高为 0） */
export function generateZeroSize(prefix = 'zero') {
  return [
    { id: `${prefix}-w0`, width: 0, height: 10 },
    { id: `${prefix}-h0`, width: 10, height: 0 },
    { id: `${prefix}-both`, width: 0, height: 0 },
  ];
}

/** 以固定 seed 打乱数组（返回新数组），用于稳定性测试 */
export function shuffled(input, seed) {
  const rng = createRng(seed);
  const copy = [...input];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rectsOverlap(a, b, epsilon = 0) {
  return (
    a.x + epsilon < b.x + b.width &&
    b.x + epsilon < a.x + a.width &&
    a.y + epsilon < b.y + b.height &&
    b.y + epsilon < a.y + a.height
  );
}

/**
 * 通用结果校验：
 * 1. 每个非零纹理完整位于 padding 内容区内；
 * 2. 同页任意两个非零纹理不重叠；
 * 3. 同页任意两个纹理的“含 gutter 保留区”不互相侵入；
 * 4. 所有输入纹理都恰好输出一次，旋转与尺寸一致；
 * 5. UV 为 0..1 的归一化值且与像素坐标一致。
 */
export function assertValidAtlas(input, result, config) {
  const { padding, gutter, pageWidth, pageHeight } = config;
  assert.equal(result.placements.length, input.length);

  const byId = new Map(input.map((t) => [t.id, t]));
  for (const placement of result.placements) {
    const source = byId.get(placement.id);
    assert.ok(source, `出现未输入的纹理 ${String(placement.id)}`);

    if (placement.rotated) {
      assert.equal(source.rotatable !== false, true);
      assert.equal(placement.width, source.height);
      assert.equal(placement.height, source.width);
    } else {
      assert.equal(placement.width, source.width);
      assert.equal(placement.height, source.height);
    }

    if (source.width === 0 || source.height === 0) {
      assert.equal(placement.rotated, false);
      continue;
    }

    assert.ok(placement.x >= padding, '越过左侧留白');
    assert.ok(placement.y >= padding, '越过顶部留白');
    assert.ok(
      placement.x + placement.width <= pageWidth - padding,
      '越过右侧留白',
    );
    assert.ok(
      placement.y + placement.height <= pageHeight - padding,
      '越过底部留白',
    );

    const approx = (actual, expected) =>
      assert.ok(
        Math.abs(actual - expected) < 1e-12,
        `UV ${actual} 与坐标 ${expected} 不一致`,
      );
    approx(placement.uv.u0, placement.x / pageWidth);
    approx(placement.uv.v0, placement.y / pageHeight);
    approx(placement.uv.u1, (placement.x + placement.width) / pageWidth);
    approx(placement.uv.v1, (placement.y + placement.height) / pageHeight);
    for (const corner of Object.values(placement.uvCorners)) {
      assert.ok(corner.u >= 0 && corner.u <= 1);
      assert.ok(corner.v >= 0 && corner.v <= 1);
    }
  }

  const nonZero = result.placements.filter(
    (p) => p.width > 0 && p.height > 0,
  );
  for (let i = 0; i < nonZero.length; i += 1) {
    for (let j = i + 1; j < nonZero.length; j += 1) {
      const a = nonZero[i];
      const b = nonZero[j];
      if (a.page !== b.page) continue;
      assert.equal(
        rectsOverlap(a, b),
        false,
        `纹理 ${String(a.id)} 与 ${String(b.id)} 发生重叠`,
      );
      // 每个纹理向四周扩张半格 gutter；扩展矩形互不相交即保证
      // gutter 区域不被其它纹理占用（奇数 gutter 时为半像素误差内）。
      const half = gutter / 2;
      const cellA = {
        x: a.x - half,
        y: a.y - half,
        width: a.width + gutter,
        height: a.height + gutter,
      };
      const cellB = {
        x: b.x - half,
        y: b.y - half,
        width: b.width + gutter,
        height: b.height + gutter,
      };
      assert.equal(
        rectsOverlap(cellA, cellB, 1e-9),
        false,
        `纹理 ${String(a.id)} 侵入 ${String(b.id)} 的 gutter 区域`,
      );
    }
  }

  assert.equal(result.pages.length, result.pageCount);
  for (const page of result.pages) {
    const onPage = nonZero.filter((p) => p.page === page.page);
    assert.equal(page.textureCount, onPage.length);
    const area = onPage.reduce((sum, p) => {
      const source = byId.get(p.id);
      return sum + source.width * source.height;
    }, 0);
    assert.equal(page.textureArea, area);
    assert.equal(page.utilization, area / (pageWidth * pageHeight));
  }
}
