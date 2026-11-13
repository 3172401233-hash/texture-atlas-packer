import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { packTextures, AtlasPackError } from '../src/index.js';
import { makeOversized } from './helpers.js';

const baseConfig = {
  pageWidth: 256,
  pageHeight: 256,
  padding: 4,
  gutter: 2,
};

describe('输入校验', () => {
  it('重复 ID 抛出 DUPLICATE_ID 并给出首次出现位置', () => {
    const textures = [
      { id: 'dup', width: 10, height: 10 },
      { id: 'other', width: 8, height: 8 },
      { id: 'dup', width: 6, height: 6 },
    ];
    assert.throws(
      () => packTextures(textures, baseConfig),
      (error) => {
        assert.ok(error instanceof AtlasPackError);
        assert.equal(error.code, 'DUPLICATE_ID');
        const dup = error.details.errors.find((e) => e.reason === '重复 ID');
        assert.equal(dup.firstIndex, 0);
        assert.equal(dup.index, 2);
        return true;
      },
    );
  });

  it('非法纹理与配置字段被一次性收集', () => {
    assert.throws(
      () =>
        packTextures(
          [
            { id: '', width: 10, height: 10 },
            { id: 'bad-size', width: -1, height: 0 },
          ],
          baseConfig,
        ),
      (error) => {
        assert.equal(error.code, 'INVALID_TEXTURE');
        assert.ok(error.details.errors.length >= 2);
        return true;
      },
    );
    assert.throws(
      () =>
        packTextures([{ id: 'a', width: 1, height: 1 }], {
          pageWidth: 0,
          pageHeight: 10,
        }),
      /INVALID_CONFIG|pageWidth/,
    );
    assert.throws(
      () =>
        packTextures([{ id: 'a', width: 1, height: 1 }], {
          pageWidth: 10,
          pageHeight: 10,
          padding: 6,
        }),
      /padding/,
    );
  });

  it('未旋转即超出页面的纹理明确失败（即使旋转也放不下）', () => {
    const textures = [
      makeOversized('too-wide', 300, 10, { rotatable: true }),
    ];
    assert.throws(
      () => packTextures(textures, baseConfig),
      (error) => {
        assert.equal(error.code, 'TEXTURE_TOO_LARGE');
        assert.equal(error.details.id, 'too-wide');
        assert.equal(error.details.rotatable, true);
        return true;
      },
    );
  });

  it('不可旋转纹理在唯一朝向下超限时失败', () => {
    const textures = [
      makeOversized('tall', 40, 300, { rotatable: false }),
    ];
    assert.throws(
      () => packTextures(textures, baseConfig),
      (error) => error.code === 'TEXTURE_TOO_LARGE',
    );
  });

  it('因 gutter 导致内容区放不下时同样按超限处理', () => {
    // 内容区为 248x248，纹理 250 宽即使旋转也放不下。
    const textures = [{ id: 'tight', width: 250, height: 10 }];
    assert.throws(
      () =>
        packTextures(textures, {
          pageWidth: 256,
          pageHeight: 256,
          padding: 4,
          gutter: 4,
        }),
      (error) => error.code === 'TEXTURE_TOO_LARGE',
    );
  });

  it('固定页面放不下时抛出 FIXED_PAGE_OVERFLOW', () => {
    const textures = [
      { id: 'a', width: 200, height: 200, fixedPage: 0 },
      { id: 'b', width: 200, height: 200, fixedPage: 0 },
    ];
    assert.throws(
      () => packTextures(textures, baseConfig),
      (error) => {
        assert.equal(error.code, 'FIXED_PAGE_OVERFLOW');
        assert.equal(error.details.fixedPage, 0);
        return true;
      },
    );
  });

  it('空输入返回零页结果且不抛错', () => {
    const result = packTextures([], baseConfig);
    assert.deepEqual(result.placements, []);
    assert.equal(result.pageCount, 0);
    assert.equal(result.pages.length, 0);
  });
});
