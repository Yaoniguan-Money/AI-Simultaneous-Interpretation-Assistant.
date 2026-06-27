/** 环形缓冲区条目——音频数据和对应时间戳 */
interface RingBufferEntry {
  data: Uint8Array;
  timestamp: number;
}

/**
 * 音频环形缓冲区 —— 生产者-消费者模型中的背压缓冲层
 *
 * 解决问题：当 ASR/LLM 处理速度低于音频采集速度时，替代简单的「丢弃」策略，
 * 将未处理的音频 chunk 缓存在固定容量环形队列中。
 * 队列满时覆盖最旧条目（丢弃最早音频），保证内存占用可控。
 *
 * 用法：
 *  - 音频采集回调 → enqueue(chunk, ts)   // 生产者
 *  - pipeline 消费循环 → dequeue()        // 消费者
 */
export class AudioRingBuffer {
  /** 预分配环形槽位，避免运行时数组扩容 */
  private readonly slots: Array<RingBufferEntry | null>;
  /** 写入指针（下一个入队位置） */
  private head = 0;
  /** 读取指针（下一个出队位置） */
  private tail = 0;
  /** 当前队列中的条目数 */
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity < 1) {
      throw new Error(`AudioRingBuffer 容量必须 ≥ 1，当前: ${capacity}`);
    }
    this.slots = new Array<RingBufferEntry | null>(capacity).fill(null);
  }

  /** 当前队列深度 */
  get size(): number {
    return this.count;
  }

  /** 队列是否为空 */
  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** 队列是否已满 */
  get isFull(): boolean {
    return this.count === this.capacity;
  }

  /**
   * 入队——满时覆盖最旧条目（丢弃最早音频，背压机制）
   * @param data 原始音频数据（深拷贝后存储——避免外部缓冲区复用导致已入队数据被覆盖）
   * @param timestamp 音频时间戳（毫秒）
   */
  enqueue(data: Uint8Array, timestamp: number): void {
    if (!data || data.length === 0) return;

    if (this.isFull) {
      /** 覆盖最旧条目：读取指针前移，丢弃旧数据 */
      this.slots[this.tail] = null;
      this.tail = (this.tail + 1) % this.capacity;
      this.count--;
    }

    /** 深拷贝音频数据——pcmBufferCache 在 float32ToInt16() 中复用同一块内存，浅拷贝会导致缓冲区中所有帧指向同一被覆盖的数据 */
    const copy = new Uint8Array(data);
    this.slots[this.head] = { data: copy, timestamp };
    this.head = (this.head + 1) % this.capacity;
    this.count++;
  }

  /**
   * 出队——返回最早入队的条目，队列为空时返回 null
   */
  dequeue(): RingBufferEntry | null {
    if (this.isEmpty) return null;

    const entry = this.slots[this.tail]!;
    this.slots[this.tail] = null;
    this.tail = (this.tail + 1) % this.capacity;
    this.count--;
    return entry;
  }

  /** 清空缓冲区，释放所有引用 */
  clear(): void {
    this.slots.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
