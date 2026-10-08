/**
 * core 层统一错误类型（CORE-API §2.2）。
 *
 * 约定：**有副作用的异步操作 throw DayCellError 子类**；
 * 纯校验函数返回 ParseResult，不用异常。
 */

export type ErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'MIGRATION_FAILED'
  | 'LUNAR_UNAVAILABLE'
  | 'BACKUP_CORRUPT'
  | 'WEBDAV_FAILED'
  | 'GITEE_FAILED'
  | 'NOT_FOUND'
  | 'TX_ABORTED'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'INTERNAL'

export abstract class DayCellError extends Error {
  abstract readonly code: ErrorCode

  protected constructor(message: string, cause?: unknown) {
    // ES2022 的 Error 已内建 cause，走标准 options 而不是自己再声明一个字段
    super(message, { cause })
    this.name = new.target.name
    // 让 instanceof 在编译到 ES5/ES2015 时仍然可用
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** IndexedDB 不可用（Safari 隐私模式、被策略禁用）→ PRD E1 */
export class StorageUnavailableError extends DayCellError {
  readonly code = 'STORAGE_UNAVAILABLE' as const
  constructor(message = '浏览器存储不可用，当前数据不会被保存', cause?: unknown) {
    super(message, cause)
  }
}

/** 存储配额耗尽 → PRD E2。UI 必须保留用户输入 */
export class QuotaExceededError extends DayCellError {
  readonly code = 'QUOTA_EXCEEDED' as const
  constructor(message = '存储空间不足，请导出备份后清理', cause?: unknown) {
    super(message, cause)
  }
}

/** 版本迁移失败，事务已回滚、旧数据完好 → PRD §6.4 */
export class MigrationFailedError extends DayCellError {
  readonly code = 'MIGRATION_FAILED' as const
  constructor(message = '数据升级失败，已回滚到升级前的状态', cause?: unknown) {
    super(message, cause)
  }
}

/** 农历库加载失败（重试后仍失败）→ PRD E4。UI 只显示公历，不白屏 */
export class LunarUnavailableError extends DayCellError {
  readonly code = 'LUNAR_UNAVAILABLE' as const
  constructor(message = '农历信息加载失败，将在下次打开时重试', cause?: unknown) {
    super(message, cause)
  }
}

/** 备份文件损坏/非法，一条都没写入 → PRD E17 */
export class BackupCorruptError extends DayCellError {
  readonly code = 'BACKUP_CORRUPT' as const
  constructor(message = '备份文件无法识别，现有数据未改动', cause?: unknown) {
    super(message, cause)
  }
}

/** WebDAV 同步失败（网络/鉴权/服务端错误）→ v8.1 坚果云同步 */
export class WebDavError extends DayCellError {
  readonly code = 'WEBDAV_FAILED' as const
  constructor(message = '同步失败，请检查网络与同步设置', cause?: unknown) {
    super(message, cause)
  }
}

/** Gitee 云同步失败（网络/鉴权/服务端错误）→ v8.2 同步通道（ADR-0009 修订） */
export class GiteeError extends DayCellError {
  readonly code = 'GITEE_FAILED' as const
  constructor(message = '同步失败，请检查网络与同步设置', cause?: unknown) {
    super(message, cause)
  }
}

/** 记录不存在（可能已被其他标签页删除）→ PRD E19 */
export class NotFoundError extends DayCellError {
  readonly code = 'NOT_FOUND' as const
  constructor(message = '记录不存在或已被删除', cause?: unknown) {
    super(message, cause)
  }
}

/** 事务中止 */
export class TxAbortedError extends DayCellError {
  readonly code = 'TX_ABORTED' as const
  constructor(message = '操作未完成，请重试', cause?: unknown) {
    super(message, cause)
  }
}

import type { ValidateCode } from './validate'

/**
 * 输入校验失败。
 *
 * 为什么 core 已经有了返回 ParseResult 的 validate，还要一个异常版本：
 *  - UI 在**输入过程中**调 parseXxx，失败是预期路径 → 用 ParseResult，不抛
 *  - repo 是**最后一道防线**，走到这里说明调用方漏了校验 → 抛，属于编程错误
 * 两者共用同一批 ValidateCode 与同一份中文文案，不会出现两套提示。
 */
export class ValidationError extends DayCellError {
  readonly code = 'VALIDATION' as const
  readonly validateCode: ValidateCode

  constructor(validateCode: ValidateCode, message: string) {
    super(message)
    this.validateCode = validateCode
  }
}

/** 兜底：不该发生的内部错误 */
export class InternalError extends DayCellError {
  readonly code = 'INTERNAL' as const
  constructor(message = '内部错误', cause?: unknown) {
    super(message, cause)
  }
}

export function isDayCellError(e: unknown): e is DayCellError {
  return e instanceof DayCellError
}
