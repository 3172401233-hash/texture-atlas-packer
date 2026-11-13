/**
 * MaxRects 装箱的单页面实现（扩展坐标模型）。
 *
 * gutter 建模：把每个纹理的保留区向四周扩张 gutter/2。自由矩形在
 * “扩展坐标系”中维护：初始内容区先向外扩 gutter/2（但最终纹理坐标
 * 会被钳制回 padding 内容区）。落位时再把扩展坐标收缩回纹理坐标。
 * 这样可以保证：
 *  - 任意两个纹理之间至少保留 gutter 像素，互不侵入对方 gutter；
 *  - 纹理像素坐标始终为整数（gutter 为奇数时仅扩展矩形出现半像素）；
 *  - 内容区边缘不强制浪费 gutter，纹理永远不会越过 padding。
 *
 * 打分采用 Best Short Side Fit（短边最贴合，短边相同再比长边），
 * 所有并列情况都使用纯数据字段做确定性裁决。
 */

function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export class MaxRectsBin {
  /**
   * @param {object} options
   * @param {number} options.pageWidth   页面宽（像素）
   * @param {number} options.pageHeight  页面高（像素）
   * @param {number} options.padding     页面边缘留白
   * @param {number} options.gutter      纹理间距
   */
  constructor({ pageWidth, pageHeight, padding, gutter }) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
    this.gutter = gutter;
    this.halfGutter = gutter / 2;
    this.contentX = padding;
    this.contentY = padding;
    this.contentWidth = pageWidth - padding * 2;
    this.contentHeight = pageHeight - padding * 2;

    // 扩展坐标系下的初始空闲区：内容区向四周各扩 halfGutter。
    this.freeRects = [
      {
        x: padding - this.halfGutter,
        y: padding - this.halfGutter,
        width: this.contentWidth + gutter,
        height: this.contentHeight + gutter,
      },
    ];
    /** 已放置的非零尺寸纹理 */
    this.placements = new Map();
  }

  /**
   * 查找最佳落点。返回 null 表示当前页面放不下。
   * @param {number} w 纹理原始宽
   * @param {number} h 纹理原始高
   * @param {boolean} rotatable 是否允许 90 度旋转
   */
  findPosition(w, h, rotatable) {
    const candidates = [{ width: w, height: h, rotated: false }];
    if (rotatable && w !== h) {
      candidates.push({ width: h, height: w, rotated: true });
    }

    const maxX = this.contentX + this.contentWidth;
    const maxY = this.contentY + this.contentHeight;
    let best = null;

    for (const free of this.freeRects) {
      for (const cand of candidates) {
        if (cand.width > free.width || cand.height > free.height) {
          continue;
        }
        // 扩展坐标 -> 纹理坐标；负扩展（内容区外的半格）钳制回内容区。
        const x = Math.max(free.x + this.halfGutter, this.contentX);
        const y = Math.max(free.y + this.halfGutter, this.contentY);
        // 钳制后必须重新校验：候选既要落在 free 内部（扩展坐标），
        // 也不能越过内容区。仅比较 cand 与 free 的尺寸是不够的，
        // 因为钳制会让实际落点相对 free 原点发生偏移。
        if (x + cand.width > free.x + free.width - this.halfGutter) {
          continue;
        }
        if (y + cand.height > free.y + free.height - this.halfGutter) {
          continue;
        }
        if (x + cand.width > maxX || y + cand.height > maxY) {
          continue;
        }

        const leftoverX = free.width - cand.width;
        const leftoverY = free.height - cand.height;
        const score = {
          shortSide: Math.min(leftoverX, leftoverY),
          longSide: Math.max(leftoverX, leftoverY),
          x,
          y,
          rotated: cand.rotated ? 1 : 0,
          width: cand.width,
          height: cand.height,
        };
        if (best === null || this.compareScore(score, best.score) < 0) {
          best = { x, y, score, rotated: cand.rotated };
        }
      }
    }
    return best;
  }

  compareScore(a, b) {
    if (a.shortSide !== b.shortSide) return a.shortSide - b.shortSide;
    if (a.longSide !== b.longSide) return a.longSide - b.longSide;
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    if (a.rotated !== b.rotated) return a.rotated - b.rotated;
    if (a.width !== b.width) return a.width - b.width;
    return a.height - b.height;
  }

  /**
   * 按已确定的落点放置纹理，并在扩展坐标系中拆分自由矩形。
   * @returns {object} 放置结果（页面像素坐标，均为整数）
   */
  place(item, position) {
    const g = this.halfGutter;
    const placedWidth = position.rotated ? item.height : item.width;
    const placedHeight = position.rotated ? item.width : item.height;

    // 扩展保留区允许进入内容区外的半格 gutter（初始空闲区就覆盖了它），
    // 因此只钳制纹理落点，不能钳制 used 的起点，否则边缘纹理会丢失
    // 朝内方向的半格 gutter 而与相邻纹理冲突。
    const usedX = position.x - g;
    const usedY = position.y - g;
    const right = position.x + placedWidth + g;
    const bottom = position.y + placedHeight + g;
    const used = {
      x: usedX,
      y: usedY,
      width: right - usedX,
      height: bottom - usedY,
    };

    const nextFree = [];
    for (const free of this.freeRects) {
      // 仅当 free 与 used 不相交时才能原样保留；相交的 free 必须被
      // 四向切割，否则旧大矩形会在剪枝阶段“吞掉”切出来的小矩形，
      // 造成同一块区域被重复分配。
      if (!intersects(free, used)) {
        nextFree.push(free);
        continue;
      }
      if (used.x > free.x) {
        nextFree.push({
          x: free.x,
          y: free.y,
          width: used.x - free.x,
          height: free.height,
        });
      }
      if (used.x + used.width < free.x + free.width) {
        nextFree.push({
          x: used.x + used.width,
          y: free.y,
          width: free.x + free.width - (used.x + used.width),
          height: free.height,
        });
      }
      if (used.y > free.y) {
        nextFree.push({
          x: free.x,
          y: free.y,
          width: free.width,
          height: used.y - free.y,
        });
      }
      if (used.y + used.height < free.y + free.height) {
        nextFree.push({
          x: free.x,
          y: used.y + used.height,
          width: free.width,
          height: free.y + free.height - (used.y + used.height),
        });
      }
    }

    this.freeRects = this.prune(nextFree);
    const placement = {
      id: item.id,
      x: position.x,
      y: position.y,
      width: placedWidth,
      height: placedHeight,
      rotated: position.rotated,
      area: item.width * item.height,
    };
    this.placements.set(item.id, placement);
    return placement;
  }

  /**
   * 删除被其它自由矩形包含的冗余自由矩形。
   * 完全相同的矩形只保留首个副本，避免同一块空闲区被重复占用。
   */
  prune(rects) {
    const kept = [];
    for (let i = 0; i < rects.length; i += 1) {
      let redundant = false;
      for (let j = 0; j < rects.length; j += 1) {
        if (i === j) continue;
        if (contains(rects[j], rects[i])) {
          redundant = true;
          break;
        }
      }
      if (!redundant) kept.push(rects[i]);
    }
    return kept;
  }
}
