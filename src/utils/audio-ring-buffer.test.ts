/**
 * AudioRingBuffer 单元测试
 * 覆盖入队/出队、满时覆盖、深拷贝、边界情况
 */
import { describe, it, expect } from 'vitest';
import { AudioRingBuffer } from './audio-ring-buffer';

describe('AudioRingBuffer', () => {
  // ---- 构造 ----

  describe('构造', () => {
    it('正常创建 capacity=8 的缓冲区', () => {
      const buf = new AudioRingBuffer(8);
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.isFull).toBe(false);
    });

    it('capacity=1（最小边界）正常工作', () => {
      const buf = new AudioRingBuffer(1);
      expect(buf.size).toBe(0);
    });

    it('capacity < 1 抛出异常', () => {
      expect(() => new AudioRingBuffer(0)).toThrow('容量必须 ≥ 1');
      expect(() => new AudioRingBuffer(-1)).toThrow('容量必须 ≥ 1');
    });
  });

  // ---- 入队/出队 ----

  describe('入队/出队', () => {
    it('单个条目入队后出队', () => {
      const buf = new AudioRingBuffer(8);
      const data = new Uint8Array([1, 2, 3]);
      buf.enqueue(data, 100);

      expect(buf.size).toBe(1);
      expect(buf.isEmpty).toBe(false);

      const entry = buf.dequeue();
      expect(entry).not.toBeNull();
      expect(entry!.data).toEqual(data);
      expect(entry!.timestamp).toBe(100);
      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
    });

    it('FIFO 顺序：先入先出', () => {
      const buf = new AudioRingBuffer(8);
      const a = new Uint8Array([1]);
      const b = new Uint8Array([2]);
      const c = new Uint8Array([3]);

      buf.enqueue(a, 100);
      buf.enqueue(b, 200);
      buf.enqueue(c, 300);

      expect(buf.dequeue()!.data).toEqual(a);
      expect(buf.dequeue()!.data).toEqual(b);
      expect(buf.dequeue()!.data).toEqual(c);
      expect(buf.dequeue()).toBeNull();
    });

    it('空数据不增加计数', () => {
      const buf = new AudioRingBuffer(8);
      buf.enqueue(new Uint8Array(0), 100);
      expect(buf.size).toBe(0);
    });

    it('空缓冲区出队返回 null', () => {
      const buf = new AudioRingBuffer(8);
      expect(buf.dequeue()).toBeNull();
      expect(buf.size).toBe(0);
    });
  });

  // ---- 深拷贝 ----

  describe('深拷贝语义', () => {
    it('入队后修改源数组不影响已入队数据', () => {
      const buf = new AudioRingBuffer(8);
      const data = new Uint8Array([1, 2, 3]);
      buf.enqueue(data, 100);

      // 修改源数组
      data[0] = 99;

      const entry = buf.dequeue();
      expect(entry!.data[0]).toBe(1); // 仍是原值
    });

    it('出队后修改出队数据不影响缓冲区', () => {
      const buf = new AudioRingBuffer(8);
      buf.enqueue(new Uint8Array([1, 2, 3]), 100);
      buf.enqueue(new Uint8Array([4, 5, 6]), 200);

      const entry = buf.dequeue()!;
      entry.data[0] = 99;

      // 第二个出队的值不受影响
      expect(buf.dequeue()!.data[0]).toBe(4);
    });
  });

  // ---- 满时覆盖 ----

  describe('满时覆盖', () => {
    it('填满后覆盖最旧条目', () => {
      const buf = new AudioRingBuffer(3);

      buf.enqueue(new Uint8Array([1]), 100);
      buf.enqueue(new Uint8Array([2]), 200);
      buf.enqueue(new Uint8Array([3]), 300);
      expect(buf.isFull).toBe(true);
      expect(buf.size).toBe(3);

      // 再入队一个，应覆盖最早（idx 0）
      buf.enqueue(new Uint8Array([4]), 400);
      expect(buf.size).toBe(3);
      expect(buf.isFull).toBe(true);

      // 最旧的被覆盖，第一个出队的应为 [2]
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([2]));
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([3]));
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([4]));
    });

    it('循环包装：多次覆盖后数据完整', () => {
      const buf = new AudioRingBuffer(3);

      // 入队 5 个条目（容量 3），应丢弃前 2 个
      for (let i = 0; i < 5; i++) {
        buf.enqueue(new Uint8Array([i]), i * 100);
      }

      expect(buf.size).toBe(3);
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([2]));
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([3]));
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([4]));
    });
  });

  // ---- clear ----

  describe('clear', () => {
    it('清空后状态重置', () => {
      const buf = new AudioRingBuffer(4);
      buf.enqueue(new Uint8Array([1]), 100);
      buf.enqueue(new Uint8Array([2]), 200);

      buf.clear();

      expect(buf.size).toBe(0);
      expect(buf.isEmpty).toBe(true);
      expect(buf.isFull).toBe(false);
      expect(buf.dequeue()).toBeNull();
    });

    it('清空后可重新入队', () => {
      const buf = new AudioRingBuffer(4);
      buf.enqueue(new Uint8Array([1]), 100);
      buf.clear();
      buf.enqueue(new Uint8Array([2]), 200);

      expect(buf.size).toBe(1);
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([2]));
    });
  });

  // ---- 边界 ----

  describe('边界情况', () => {
    it('capacity=1 乒乓行为', () => {
      const buf = new AudioRingBuffer(1);

      buf.enqueue(new Uint8Array([1]), 100);
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([1]));
      expect(buf.dequeue()).toBeNull();

      buf.enqueue(new Uint8Array([2]), 200);
      expect(buf.dequeue()!.data).toEqual(new Uint8Array([2]));
    });

    it('大容量缓冲区正常工作', () => {
      const buf = new AudioRingBuffer(1024);
      for (let i = 0; i < 100; i++) {
        buf.enqueue(new Uint8Array([i % 256]), i);
      }
      expect(buf.size).toBe(100);
    });
  });
});
