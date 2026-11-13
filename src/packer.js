import { AtlasPackError, assert } from './errors.js';
import { MaxRectsBin } from './max-rects.js';

function isNonNegativeInt(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function compareId(a, b) {
  const left = String(a);
  const right = String(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * 规范化并校验输入，返回带原始下标 index 的纹理数组。
 * 所有结构性错误一次性收集，避免“修一个再报一个”。
 */
function normalize(textures, config) {
  assert(Array.isArray(textures), 'INVALID_TEXTURE', 'textures 必须是数组');
  assert(
    isPositiveInt(config.pageWidth) && isPositiveInt(config.pageHeight),
    'INVALID_CONFIG',
    'pageWidth / pageHeight 必须是正整数',
  );
  assert(
    isNonNegativeInt(config.padding) && isNonNegativeInt(config.gutter),
    'INVALID_CONFIG',
    'padding / gutter 必须是非负整数',
  );
  assert(
    config.padding * 2 <= config.pageWidth &&
      config.padding * 2 <= config.pageHeight,
    'INVALID_CONFIG',
    'padding 之和不能超过页面尺寸',
  );

  const errors = [];
  const seen = new Map();
  const normalized = textures.map((raw, index) => {
    const context = { index };
    if (raw === null || typeof raw !== 'object') {
      errors.push({ ...context, reason: '纹理必须是对象' });
      return null;
    }
    const { id, width, height } = raw;
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      (typeof id === 'number' && !Number.isFinite(id)) ||
      (typeof id === 'string' && id.length === 0)
    ) {
      errors.push({ ...context, reason: 'id 必须是非空字符串或有限数字' });
    } else if (seen.has(id)) {
      errors.push({
        ...context,
        reason: '重复 ID',
        id,
        firstIndex: seen.get(id),
      });
    } else {
      seen.set(id, index);
    }
    if (!isNonNegativeInt(width) || !isNonNegativeInt(height)) {
      errors.push({ ...context, id, reason: 'width / height 必须是非负整数' });
    }
    if (
      raw.rotatable !== undefined &&
      typeof raw.rotatable !== 'boolean'
    ) {
      errors.push({ ...context, id, reason: 'rotatable 必须是布尔值' });
    }
    if (
      raw.fixedPage !== undefined &&
      !isNonNegativeInt(raw.fixedPage)
    ) {
      errors.push({ ...context, id, reason: 'fixedPage 必须是非负整数' });
    }
    if (
      raw.priority !== undefined &&
      (typeof raw.priority !== 'number' || !Number.isFinite(raw.priority))
    ) {
      errors.push({ ...context, id, reason: 'priority 必须是有限数字' });
    }
    return {
      index,
      id: raw.id,
      width,
      height,
      rotatable: raw.rotatable === undefined ? true : raw.rotatable,
      fixedPage: raw.fixedPage,
      priority: raw.priority === undefined ? 0 : raw.priority,
    };
  });

  if (errors.length > 0) {
    throw new AtlasPackError(
      errors.some((e) => e.reason === '重复 ID')
        ? 'DUPLICATE_ID'
        : 'INVALID_TEXTURE',
      `输入校验失败，共 ${errors.length} 处问题`,
      { errors },
    );
  }
  return normalized;
}

/**
 * 确定性排序：固定项优先且按固定页聚合，随后按优先级、面积、边长、ID，
 * 最后以原始下标兜底。结果只依赖输入数据本身，与遍历随机性无关。
 */
function compareItems(a, b) {
  const fixedA = a.fixedPage === undefined ? 1 : 0;
  const fixedB = b.fixedPage === undefined ? 1 : 0;
  if (fixedA !== fixedB) return fixedA - fixedB;
  if (fixedA === 0 && a.fixedPage !== b.fixedPage) {
    return a.fixedPage - b.fixedPage;
  }
  // 固定项同页内以 ID 做最终裁决，保证自由项输入顺序变化时，
  // 固定项的相对处理顺序与落位完全不变。
  if (fixedA === 0) {
    const idCmpFixed = compareId(a.id, b.id);
    if (idCmpFixed !== 0) return idCmpFixed;
    return a.index - b.index;
  }
  if (a.priority !== b.priority) return b.priority - a.priority;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return areaB - areaA;
  const maxA = Math.max(a.width, a.height);
  const maxB = Math.max(b.width, b.height);
  if (maxA !== maxB) return maxB - maxA;
  if (a.width !== b.width) return b.width - a.width;
  if (a.height !== b.height) return b.height - a.height;
  const idCmp = compareId(a.id, b.id);
  if (idCmp !== 0) return idCmp;
  return a.index - b.index;
}

/**
 * 超大预判：非零纹理在允许的旋转方案下，连“纹理 + gutter”的单元
 * 都无法放进内容区时，明确失败（零尺寸纹理始终可放置）。
 */
function assertFitsPage(item, config) {
  if (item.width === 0 || item.height === 0) return;
  const contentWidth = config.pageWidth - config.padding * 2;
  const contentHeight = config.pageHeight - config.padding * 2;
  const g = config.gutter;
  const orientations = [{ w: item.width, h: item.height }];
  if (item.rotatable && item.width !== item.height) {
    orientations.push({ w: item.height, h: item.width });
  }
  // 扩展模型下，纹理只需自身能放进内容区；相邻 gutter 由扩展坐标保证。
  const fits = orientations.some(
    (o) => o.w <= contentWidth && o.h <= contentHeight,
  );
  assert(
    fits,
    'TEXTURE_TOO_LARGE',
    `纹理 ${String(item.id)} 超出页面可用区域`,
    {
      id: item.id,
      texture: { width: item.width, height: item.height },
      page: { width: config.pageWidth, height: config.pageHeight },
      content: { width: contentWidth, height: contentHeight },
      gutter: g,
      rotatable: item.rotatable,
    },
  );
}

function buildUv(placement, pageWidth, pageHeight) {
  const { x, y, width, height, rotated } = placement;
  const u0 = x / pageWidth;
  const v0 = y / pageHeight;
  const u1 = (x + width) / pageWidth;
  const v1 = (y + height) / pageHeight;

  if (!rotated) {
    return {
      uv: { u0, v0, u1, v1 },
      uvCorners: {
        tl: { u: u0, v: v0 },
        tr: { u: u1, v: v0 },
        br: { u: u1, v: v1 },
        bl: { u: u0, v: v1 },
      },
    };
  }

  // 旋转约定：源图顺时针旋转 90° 后落入页面矩形。
  // 源图四角在页面上的对应位置：
  //   左上 -> 页面矩形左下角，右上 -> 左上角，
  //   右下 -> 右上角，     左下 -> 右下角。
  return {
    uv: { u0, v0, u1, v1 },
    uvCorners: {
      tl: { u: u0, v: v1 },
      tr: { u: u0, v: v0 },
      br: { u: u1, v: v0 },
      bl: { u: u1, v: v1 },
    },
  };
}

/**
 * 打包入口。
 * @param {Array<object>} textures 纹理描述列表
 * @param {object} config 页面与间距配置
 * @returns {{pages: object[], placements: object[], utilization: number, pageCount: number}}
 */
export function packTextures(textures, config) {
  const resolved = {
    pageWidth: config?.pageWidth,
    pageHeight: config?.pageHeight,
    padding: config?.padding ?? 0,
    gutter: config?.gutter ?? 0,
  };
  const items = normalize(textures, resolved);
  for (const item of items) {
    assertFitsPage(item, resolved);
  }

  const bins = [];
  const ensureBin = (pageIndex) => {
    while (bins.length <= pageIndex) {
      bins.push(new MaxRectsBin(resolved));
    }
    return bins[pageIndex];
  };

  const placementsById = new Map();
  const sorted = [...items].sort(compareItems);

  for (const item of sorted) {
    const isZeroSize = item.width === 0 || item.height === 0;
    if (isZeroSize) {
      const pageIndex = item.fixedPage ?? 0;
      const bin = ensureBin(pageIndex);
      placementsById.set(item.id, {
        id: item.id,
        page: pageIndex,
        x: bin.contentX,
        y: bin.contentY,
        width: item.width,
        height: item.height,
        rotated: false,
        area: 0,
      });
      continue;
    }

    if (item.fixedPage !== undefined) {
      const bin = ensureBin(item.fixedPage);
      const position = bin.findPosition(item.width, item.height, item.rotatable);
      if (position === null) {
        throw new AtlasPackError(
          'FIXED_PAGE_OVERFLOW',
          `纹理 ${String(item.id)} 无法放入固定页面 ${item.fixedPage}`,
          { id: item.id, fixedPage: item.fixedPage },
        );
      }
      const placement = bin.place(item, position);
      placementsById.set(item.id, { ...placement, page: item.fixedPage });
      continue;
    }

    let target = null;
    let position = null;
    for (let pageIndex = 0; pageIndex < bins.length; pageIndex += 1) {
      const candidate = bins[pageIndex].findPosition(
        item.width,
        item.height,
        item.rotatable,
      );
      if (candidate !== null) {
        target = bins[pageIndex];
        position = candidate;
        break;
      }
    }
    if (target === null) {
      target = ensureBin(bins.length);
      position = target.findPosition(item.width, item.height, item.rotatable);
    }
    if (position === null) {
      throw new AtlasPackError(
        'NO_FIT',
        `纹理 ${String(item.id)} 在所有页面中均无可用空间`,
        { id: item.id },
      );
    }
    const placement = target.place(item, position);
    placementsById.set(item.id, {
      ...placement,
      page: bins.indexOf(target),
    });
  }

  const pageArea = resolved.pageWidth * resolved.pageHeight;
  const contentArea =
    (resolved.pageWidth - resolved.padding * 2) *
    (resolved.pageHeight - resolved.padding * 2);

  const pages = bins.map((bin, pageIndex) => {
    const textureArea = [...bin.placements.values()].reduce(
      (sum, p) => sum + p.area,
      0,
    );
    return {
      page: pageIndex,
      width: resolved.pageWidth,
      height: resolved.pageHeight,
      padding: resolved.padding,
      gutter: resolved.gutter,
      textureCount: bin.placements.size,
      textureArea,
      utilization: textureArea / pageArea,
      contentUtilization:
        contentArea > 0 ? textureArea / contentArea : 0,
    };
  });

  const placements = items.map((item) => {
    const placement = placementsById.get(item.id);
    const { uv, uvCorners } = buildUv(
      placement,
      resolved.pageWidth,
      resolved.pageHeight,
    );
    return {
      id: placement.id,
      page: placement.page,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotated: placement.rotated,
      uv,
      uvCorners,
    };
  });

  const totalTextureArea = pages.reduce(
    (sum, page) => sum + page.textureArea,
    0,
  );

  return {
    pageCount: pages.length,
    utilization: totalTextureArea / (pageArea * pages.length),
    pages,
    placements,
  };
}
