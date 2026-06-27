export type FirstScreenLatencyMark =
  | 'start'
  | 'audio_ready'
  | 'first_audio_chunk'
  | 'asr_ws_open'
  | 'first_audio_sent'
  | 'first_asr_interim'
  | 'first_asr_final'
  | 'preview_translate_start'
  | 'force_delivery_triggered'
  | 'segment_output'
  | 'llm_request_start'
  | 'first_llm_token'
  | 'overlay_update';

class FirstScreenLatencyTracker {
  private startedAt = 0;
  private marks = new Set<FirstScreenLatencyMark>();

  start(details?: string): void {
    this.startedAt = Date.now();
    this.marks.clear();
    this.write('start', this.startedAt, details);
  }

  mark(point: Exclude<FirstScreenLatencyMark, 'start'>, details?: string): void {
    if (this.marks.has(point)) return;

    const now = Date.now();
    if (this.startedAt === 0) {
      this.startedAt = now;
    }

    this.marks.add(point);
    this.write(point, now, details);
  }

  private write(point: FirstScreenLatencyMark, now: number, details?: string): void {
    const elapsed = Math.max(0, now - this.startedAt);
    const suffix = details ? ` ${details}` : '';
    console.info(`[first-screen] [${point}] Date.now()=${now} +${elapsed}ms${suffix}`);
  }
}

export const firstScreenLatency = new FirstScreenLatencyTracker();
