/**
 * @nexus-ui/core/buffer —— JSONL 流式行缓冲。
 *
 * 职责：跨 chunk 拼接，按 `\n` 切出完整 JSONL 行；残留尾部留到下次，是
 * 「流式渐进渲染」的入口。空行跳过；兼容 `\r\n` 行尾（`\r` 由行内 trim 去除）。
 *
 * 内存边界作用于「单行」而非累积缓冲：
 *   - 完整行超长 → 经 onOversizedLine 明确拒绝并丢弃，同 chunk 后续行照常产出；
 *   - 永不换行的恶意流 → 未完成半行超限后转入溢出丢弃态（不再累积内容），
 *     直到换行或 flush 才作为一条超长行上报。
 * 因此同一字节流无论按何种 chunk 边界切分，产出的行序列与错误序列一致。
 */
/** 单行（trim 后待解析内容）的长度上限：超长行整体拒绝，不做截断拼接。 */
export const MAX_JSONL_LINE_LENGTH = 1_000_000;

export interface OversizedLineInfo {
  /** 被拒绝行的近似长度（字符数；溢出态下为已丢弃量，仅供诊断）。 */
  length: number;
}

export class JSONLBuffer {
  private tail = '';
  /** 溢出丢弃态：当前未完成行已超限，丢弃后续内容直到换行。 */
  private overflowing = false;
  private discardedLength = 0;

  constructor(
    private readonly onOversizedLine?: (info: OversizedLineInfo) => void,
  ) {}

  /** 喂入一段流文本，返回其中所有完整 JSONL 行（不含末尾半行）。空行跳过。 */
  push(chunk: string): string[] {
    const lines: string[] = [];
    let rest = chunk;

    if (this.overflowing) {
      const nl = rest.indexOf('\n');
      if (nl < 0) {
        this.discardedLength += rest.length;
        return lines;
      }
      this.discardedLength += rest.slice(0, nl).length;
      this.onOversizedLine?.({ length: this.discardedLength });
      this.overflowing = false;
      this.discardedLength = 0;
      rest = rest.slice(nl + 1);
    }

    this.tail += rest;
    let nl = this.tail.indexOf('\n');
    while (nl >= 0) {
      const line = this.tail.slice(0, nl).trim();
      this.tail = this.tail.slice(nl + 1);
      if (line) {
        if (line.length > MAX_JSONL_LINE_LENGTH) this.onOversizedLine?.({ length: line.length });
        else lines.push(line);
      }
      nl = this.tail.indexOf('\n');
    }
    if (this.tail.length > MAX_JSONL_LINE_LENGTH) {
      // 未完成半行已不可能合法：转入溢出丢弃态，防止永不换行的流撑大内存。
      this.overflowing = true;
      this.discardedLength = this.tail.length;
      this.tail = '';
    }
    return lines;
  }

  /** 流结束：冲刷残留尾部，返回最后一条（若有）。 */
  flush(): string[] {
    if (this.overflowing) {
      const length = this.discardedLength + this.tail.length;
      this.overflowing = false;
      this.discardedLength = 0;
      this.tail = '';
      this.onOversizedLine?.({ length });
      return [];
    }
    const rest = this.tail.trim();
    this.tail = '';
    if (!rest) return [];
    if (rest.length > MAX_JSONL_LINE_LENGTH) {
      this.onOversizedLine?.({ length: rest.length });
      return [];
    }
    return [rest];
  }
}
