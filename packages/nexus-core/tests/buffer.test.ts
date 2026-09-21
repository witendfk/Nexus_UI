import { expect } from 'chai';
import { JSONLBuffer } from '../src/buffer';

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
});
