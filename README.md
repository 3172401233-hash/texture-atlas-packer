# texture-atlas-packer

零第三方依赖、不生成任何图片的 Node.js 纹理图集打包库。它只做一件事：
在游戏资源构建期，把大量小纹理（矩形）确定性地排到一张或多张大图页面里，
并输出落位、旋转、归一化 UV 与页面利用率，供后续的图片合成 / 引擎加载环节使用。

- 纯 ESM，仅使用 Node.js 内置模块（`node:test` 跑测试）。
- 装箱算法为确定性 [MaxRects](https://wiki.unity3d.com/index.php?title=MaxRectsBinPacker)
  的 Best Short Side Fit 变体，支持 90° 旋转、多页、间距与边缘留白。
- 不包含图片查看器、编辑器或任何像素读写逻辑。

## 安装与要求

- Node.js `>= 18`（使用内置测试运行器 `node --test`）。
- 无运行时依赖，`package.json` 的 `dependencies` 为空。

```bash
npm test          # 等价于 node --test
```

## 快速开始

```js
import { packTextures } from 'texture-atlas-packer';

const textures = [
  { id: 'hero',   width: 64, height: 64 },
  { id: 'sword',  width: 96, height: 24, rotatable: true },
  { id: 'logo',   width: 128, height: 128, fixedPage: 0, priority: 10 },
  { id: 'empty',  width: 0, height: 32 },
];

const result = packTextures(textures, {
  pageWidth: 256,
  pageHeight: 256,
  padding: 2,
  gutter: 2,
});

console.log(result.pageCount, result.utilization);
for (const p of result.placements) {
  // p.id / p.page / p.x / p.y / p.width / p.height / p.rotated / p.uv
}
```

## 输入

### `packTextures(textures, config)`

`config` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pageWidth` / `pageHeight` | 正整数 | 每张页面的像素尺寸 |
| `padding` | 非负整数，默认 `0` | 页面四周边缘留白，纹理不得越过 |
| `gutter` | 非负整数，默认 `0` | 相邻纹理之间的最小像素间距 |

每个纹理对象：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | 非空字符串或有限数字 | 稳定唯一标识，重复会报错 |
| `width` / `height` | 非负整数 | 纹理像素尺寸，允许为 `0` |
| `rotatable` | 布尔，默认 `true` | 是否允许顺时针旋转 90° |
| `fixedPage` | 非负整数，可选 | 强制分配到的页面下标 |
| `priority` | 有限数字，默认 `0` | 数值越大越先打包，低优先级会被推迟到后续页面 |

## 输出

```ts
{
  pageCount: number,          // 实际生成的页面数
  utilization: number,        // 所有页面的整体纹理面积占比（0..1）
  pages: [
    {
      page: number,           // 页面下标
      width, height, padding, gutter,
      textureCount: number,   // 该页非零尺寸纹理数量
      textureArea: number,    // 该页纹理原始面积之和
      utilization: number,    // 相对整页面积的利用率
      contentUtilization: number, // 相对 padding 内容区的利用率
    },
  ],
  placements: [
    {
      id, page,
      x, y,                   // 纹理左上角在页面上的整数像素坐标
      width, height,          // 旋转后的页面占用尺寸
      rotated: boolean,       // 是否顺时针旋转了 90°
      uv: { u0, v0, u1, v1 }, // 轴对齐归一化 UV 范围
      uvCorners: {            // 源图四个角对应的 UV（旋转时有意义）
        tl, tr, br, bl,
      },
    },
  ],
}
```

`placements` 数组顺序与输入 `textures` 完全一致，便于按下标回查。

## 坐标系与旋转 / UV 约定

- 页面坐标系原点在左上角，x 向右、y 向下，单位为像素。
- 旋转只支持顺时针 90°。当 `rotated: true` 时，`width/height` 为旋转后
  在页面上的占用尺寸；源图到页面的角点映射由 `uvCorners` 给出：
  源图左上 → 页面矩形左下，右上 → 左上，右下 → 右上，左下 → 右下。
- `uv` 以页面左上角为 `(0,0)`，右下角为 `(1,1)`，按
  `u = 像素 x / pageWidth`、`v = 像素 y / pageHeight` 计算。
  如果引擎的纹理坐标原点在左下角，需在采样端自行翻转 v 轴。

## 间距（gutter）模型

每个纹理的保留区向四周扩张 `gutter/2`，所有自由矩形在“扩展坐标系”中维护，
落位时再收缩回整数像素坐标。该模型保证：

- 任意两个纹理之间至少保留 `gutter` 像素，互不侵入对方的 gutter 区域；
- 纹理像素坐标始终是整数，奇数 `gutter` 仅在内部扩展矩形上出现半像素；
- 内容区边缘不强制浪费一条 gutter，纹理永远不会越过 `padding`。

## 确定性保证

输出只由输入数据本身决定，与对象在数组中的先后顺序无关：

- 处理顺序：固定项优先（按固定页、ID 排序），其余按优先级、面积、
  最长边、宽高、ID 逐级决胜，最后才用原始下标兜底。
- 落位打分：Best Short Side Fit 的所有并列情况都按坐标、旋转标记、
  宽高等纯数据字段裁决，不依赖任何随机源或哈希迭代顺序。
- 因此相同输入重复运行、或仅打乱输入顺序，已固定项与全部落位都保持稳定。

测试中的数据生成器使用固定种子的 `mulberry32` 伪随机数，保证可复现。

## 错误处理

所有错误都抛出 `AtlasPackError`，带稳定的 `code`：

| code | 触发条件 |
| --- | --- |
| `INVALID_CONFIG` | 页面尺寸、padding、gutter 等配置非法 |
| `INVALID_TEXTURE` | 纹理字段非法（多个问题会一次性收集到 `details.errors`） |
| `DUPLICATE_ID` | 存在重复的稳定 ID |
| `TEXTURE_TOO_LARGE` | 纹理在允许的旋转方案下仍超出页面内容区 |
| `FIXED_PAGE_OVERFLOW` | 固定页面无法容纳该固定纹理 |
| `NO_FIT` | 合法输入但所有页面都无可用空间 |

超大纹理在打包前的统一校验阶段就会明确失败；而某个纹理当前页放不下时，
打包器会继续尝试后续页面 / 新建页面，不会因此终止整个任务。

## 零尺寸与超大纹理

- `width` 或 `height` 为 `0` 的纹理不占用装箱空间，被放到
  `fixedPage ?? 0` 的内容区原点 `(padding, padding)`，其 UV 退化为
  `u0 === u1` 或 `v0 === v1`，且不会触发重叠。
- 非零纹理若在所有允许朝向下都无法放进内容区，立即抛
  `TEXTURE_TOO_LARGE`，错误详情包含页面、内容区与 gutter 尺寸。

## 已知打包边界

- 算法为启发式 MaxRects，不保证数学最优；极端长宽比或强旋转约束下
  可能留下无法利用的碎片空闲区。
- 自由矩形剪枝为 O(n²)，单页碎片数量极大（数千以上）时耗时会明显上升，
  当前测试规模（1000 个碎片、256px 页面）约在百毫秒量级。
- 仅支持 90° 整数旋转，不支持任意角度、镜像或多边形（非矩形）打包。
- 不做纹理内容感知（如边缘色 extrude、bleed），gutter 区域保持空白，
  由下游图片合成步骤决定如何填充。
- 页面尺寸、宽高、间距均按整数像素处理，不接受浮点尺寸。

## 项目结构

```
src/
  index.js      公共导出
  packer.js     校验、确定性排序、多页调度、UV 与利用率
  max-rects.js  单页 MaxRects（扩展坐标 gutter 模型 + BSSF 打分）
  errors.js     AtlasPackError 与断言工具
test/
  helpers.js             确定性数据生成器与无重叠 / UV 校验器
  validation.test.js     重复 ID、非法输入、超限、固定页溢出
  layout.test.js         单页、多页、间距、旋转、固定页、优先级、UV
  determinism.test.js    顺序无关、固定项稳定、1000 碎片压测
```
