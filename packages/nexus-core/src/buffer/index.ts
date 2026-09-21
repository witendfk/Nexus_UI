/**
 * @nexus-ui/core/buffer —— JSONL 流式行缓冲。
 *
 * 职责：跨 chunk 拼接，按 `\n` 切出完整 JSONL 行；残留尾部留到下次，是
 * 「流式渐进渲染」的入口。空行跳过；兼容 `\r\n` 行尾。
 *
 *   push(chunk)   喂入一段流文本，返回其中所有完整行（不含末尾半行）
 *   flush()       流结束，冲刷残留尾部（返回最后一条，若有）
 */
export class JSONLBuffer {
  private tail = '';

  /** 喂入一段流文本，返回其中所有完整 JSONL 行（不含末尾半行）。空行跳过。 */
  push(chunk: string): string[] {
    this.tail += chunk;
    const lines: string[] = [];
    let nl = this.tail.indexOf('\n');
    while (nl >= 0) {
      const line = this.tail.slice(0, nl).trim();
      this.tail = this.tail.slice(nl + 1);
      if (line) lines.push(line);
      nl = this.tail.indexOf('\n');
    }
    return lines;
  }

  /** 流结束：冲刷残留尾部，返回最后一条（若有）。 */
  flush(): string[] {
    const rest = this.tail.trim();
    this.tail = '';
    return rest ? [rest] : [];
  }
}
