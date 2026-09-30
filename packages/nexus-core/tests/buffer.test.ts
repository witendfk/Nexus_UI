import { expect } from 'chai';
import { JSONLBuffer, MAX_JSONL_LINE_LENGTH } from '../src/buffer';

interface OversizedRecord {
  length: number;
}

function newBuffer(): { buffer: JSONLBuffer; oversized: OversizedRecord[] } {
  const oversized: OversizedRecord[] = [];
  return { buffer: new JSONLBuffer((info) => oversized.push(info)), oversized };
}

describe('JSONLBuffer', () => {
  it('一次 push 多行', () => {
    const b = new JSONLBuffer();
    expect(b.push('{"a":1}\n{"b":2}\n')).to.deep.equal(['{"a":1}', '{"b":2}']);
  });

  it('跨 chunk 拼接：半行先缓存', () => {
    const b = new JSONLBuffer();
    expect(b.push('{"a":')).to.deep.equal([]);
    expect(b.push('1}\n{"b":2}\n')).to.deep.equal(['{"a":1}', '{"b":2}']);
  });

  it('空行跳过', () => {
    const b = new JSONLBuffer();
    expect(b.push('\n\n{"a":1}\n\n')).to.deep.equal(['{"a":1}']);
  });

  it('无尾换行：push 不返回，flush 返回残留', () => {
    const b = new JSONLBuffer();
    expect(b.push('{"a":1}')).to.deep.equal([]);
    expect(b.flush()).to.deep.equal(['{"a":1}']);
    expect(b.flush()).to.deep.equal([]);
  });

  it('兼容 CRLF（\\r\\n）行尾', () => {
    const b = new JSONLBuffer();
    expect(b.push('{"a":1}\r\n{"b":2}\r\n')).to.deep.equal(['{"a":1}', '{"b":2}']);
  });

  it('L0-01：单 chunk 多条短行总长超限，所有完整行仍完整产出（不截断丢消息）', () => {
    const { buffer } = newBuffer();
    // 每行 4 字符 × 300k 行 ≈ 1.5M 字符，全部完整且远超旧的全局 1M 上限
    const chunk = Array.from({ length: 300_000 }, (_, i) => `{"i":${i % 10}}`).join('\n');
    const lines = buffer.push(`${chunk}\n{"last":1}`);
    expect(lines).to.have.lengthOf(300_000);
    expect(lines[0]).to.equal('{"i":0}');
    expect(lines[299_999]).to.equal('{"i":9}');
    expect(buffer.flush()).to.deep.equal(['{"last":1}']);
  });

  it('L0-01：同一流按不同 chunk 切分，产出行序列一致', () => {
    const chunk = Array.from({ length: 50_000 }, (_, i) => `m${i % 7}:xxxxxxxxxx`).join('\n');
    const run = (sizes: number[]): string[] => {
      const { buffer } = newBuffer();
      const out: string[] = [];
      let offset = 0;
      for (const size of sizes) {
        out.push(...buffer.push(chunk.slice(offset, offset + size)));
        offset += size;
      }
      if (offset < chunk.length) out.push(...buffer.push(chunk.slice(offset)));
      out.push(...buffer.flush());
      return out;
    };
    const expected = chunk.split('\n');
    expect(run([chunk.length])).to.deep.equal(expected);
    expect(run([1])).to.deep.equal(expected);
    expect(run([7, 13, 1024, 3, 997, chunk.length])).to.deep.equal(expected);
  });

  it('L0-01：超长完整行明确拒绝，同 chunk 后续合法行继续处理', () => {
    const { buffer, oversized } = newBuffer();
    const huge = `{"pad":"${'x'.repeat(MAX_JSONL_LINE_LENGTH + 10)}"}`;
    const lines = buffer.push(`${huge}\n{"a":1}\n`);
    expect(lines).to.deep.equal(['{"a":1}']);
    expect(oversized).to.have.lengthOf(1);
    expect(oversized[0]!.length).to.be.greaterThan(MAX_JSONL_LINE_LENGTH);
  });

  it('L0-01：跨 chunk 超长行合并拒绝；截断后缀不被当作新消息解析', () => {
    const { buffer, oversized } = newBuffer();
    const huge = 'y'.repeat(MAX_JSONL_LINE_LENGTH + 5);
    expect(buffer.push(`${huge.slice(0, 600_000)}`)).to.deep.equal([]);
    expect(buffer.push(`${huge.slice(600_000)}\n{"ok":2}\n`)).to.deep.equal(['{"ok":2}']);
    expect(oversized).to.have.lengthOf(1);
  });

  it('L0-01：永不换行的恶意流内存有界（溢出丢弃），换行后恢复正常', () => {
    const { buffer, oversized } = newBuffer();
    for (let i = 0; i < 50; i++) {
      expect(buffer.push('z'.repeat(100_000))).to.deep.equal([]);
    }
    // 溢出态下不再累积内容；换行终结超长行，其后的合法行正常恢复处理
    expect(buffer.push('\n{"fresh":1}\n')).to.deep.equal(['{"fresh":1}']);
    expect(oversized).to.have.lengthOf(1);
    expect(buffer.flush()).to.deep.equal([]);
  });

  it('L0-01：溢出行在 flush 时上报；CRLF 与 flush 尾行同样适用限长', () => {
    const { buffer, oversized } = newBuffer();
    expect(buffer.push('{"a":1}\r\n')).to.deep.equal(['{"a":1}']);
    const hugeTail = 'w'.repeat(MAX_JSONL_LINE_LENGTH + 1);
    expect(buffer.push(hugeTail)).to.deep.equal([]);
    expect(buffer.flush()).to.deep.equal([]);
    expect(oversized).to.have.lengthOf(1);
  });
});
