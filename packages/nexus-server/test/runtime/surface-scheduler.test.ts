import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SurfaceScheduler } from '../../src/runtime/surface-scheduler';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('SurfaceScheduler（S3.2 单一调度）', () => {
  it('同 surface FIFO 串行：前一任务完成前后续不启动', async () => {
    const scheduler = new SurfaceScheduler();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = scheduler.enqueue('s', async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
    });
    assert.ok(first.accepted);
    const second = scheduler.enqueue('s', async () => {
      order.push('second-start');
    });
    assert.ok(second.accepted);
    await tick();
    assert.deepEqual(order, ['first-start'], '排队任务必须等前一任务完成');
    release();
    await tick();
    await tick();
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
  });

  it('不同 surface 并发推进，互不阻塞', async () => {
    const scheduler = new SurfaceScheduler();
    const done: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scheduler.enqueue('a', async () => {
      await gate;
      done.push('a');
    });
    await tick();
    const other = scheduler.enqueue('b', async () => {
      done.push('b');
    });
    assert.ok(other.accepted);
    await tick();
    assert.deepEqual(done, ['b'], 'b 不得被挂起的 a 阻塞');
    release();
    await tick();
    assert.deepEqual(done, ['b', 'a']);
  });

  it('排队容量超限入队拒绝；取消先于任务体；额度可复用', async () => {
    const scheduler = new SurfaceScheduler({ maxQueuedPerSurface: 1 });
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = scheduler.enqueue('s', async () => {
      calls.push('running');
      await gate;
    });
    assert.ok(running.accepted);
    await tick(); // 首个任务开跑（进入运行槽，不再占排队额度）
    const queued = scheduler.enqueue('s', async () => {
      calls.push('queued');
    });
    assert.ok(queued.accepted);
    assert.ok(!scheduler.hasCapacity('s'), '排队满（1 活动 + 1 排队）时不得再有额度');
    const rejected = scheduler.enqueue('s', async () => {
      calls.push('never');
    });
    assert.deepEqual(rejected, { accepted: false, reason: 'capacity' });

    assert.equal(queued.cancel(), true, '排队任务可取消');
    assert.equal(scheduler.pendingCount('s'), 0, '取消立即移除排队项');
    assert.ok(scheduler.hasCapacity('s'), '活动任务未完成时也立即恢复额度');
    const replacement = scheduler.enqueue('s', async () => {
      calls.push('replacement');
    });
    assert.ok(replacement.accepted, '释放的额度可立即复用');
    assert.ok(replacement.cancel());
    assert.equal(replacement.cancel(), false, '重复取消不重复释放额度');
    release();
    await tick();
    await tick();
    assert.deepEqual(calls, ['running'], '取消必须先于任务体');
    await tick();
    assert.ok(scheduler.hasCapacity('s'), '额度在任务结束后释放');
    const again = scheduler.enqueue('s', async () => {
      calls.push('again');
    });
    assert.ok(again.accepted);
    await tick();
    await tick();
    assert.deepEqual(calls, ['running', 'again']);
  });

  it('已开跑的任务不能再被排队取消；空闲时入队即声明活动', async () => {
    const scheduler = new SurfaceScheduler();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = scheduler.enqueue('s', async () => {
      started.push('first');
      await gate;
    });
    assert.ok(first.accepted);
    await tick();
    assert.equal(first.cancel(), false, '运行中的任务不可取消');
    assert.ok(scheduler.isBusy('s'));
    release();
    await tick();
    await tick();
    assert.ok(!scheduler.isBusy('s'), '排空后不再活动');
  });

  it('非法容量配置在构造时抛错，0 不表示关闭限制', () => {
    assert.throws(() => new SurfaceScheduler({ maxQueuedPerSurface: 0 }), /正安全整数/);
    assert.throws(() => new SurfaceScheduler({ maxQueuedPerSurface: -1 }));
    assert.throws(() => new SurfaceScheduler({ maxQueuedPerSurface: 1.5 }));
    assert.throws(() => new SurfaceScheduler({ maxQueuedPerSurface: Number.MAX_SAFE_INTEGER + 1 }));
  });
});
