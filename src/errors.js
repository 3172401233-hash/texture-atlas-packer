/**
 * 打包失败时抛出的错误，携带稳定的 code 与详细上下文。
 * code 取值：
 *  - INVALID_CONFIG      页面尺寸 / padding / gutter 等配置非法
 *  - INVALID_TEXTURE     单个纹理的字段非法
 *  - DUPLICATE_ID        存在重复的稳定 ID
 *  - TEXTURE_TOO_LARGE   纹理在允许的旋转方案下仍然超出页面
 *  - FIXED_PAGE_OVERFLOW 指定固定页面无法容纳该纹理
 *  - NO_FIT              合法输入但所有页面均无可用空间
 */
export class AtlasPackError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AtlasPackError';
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, code, message, details) {
  if (!condition) {
    throw new AtlasPackError(code, message, details);
  }
}
