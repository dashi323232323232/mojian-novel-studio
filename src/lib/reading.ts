/**
 * 实时朗读引擎（Web Speech）：
 * 直接把章节正文切成短句，边合成边播放，不落地任何音频文件。
 *
 * 关键设计：
 * - 以「短句」为单位合成：Windows 本地语音对长文本会在 15 秒左右截断，
 *   而短句既能规避该问题，也让拖动进度条、临时改语速都能立刻生效。
 * - 位置以「字符偏移」记录：换声音、改语速、拖动进度、关掉软件再打开，
 *   都能回到同一处继续读。
 * - 拖动进度条 = 找到目标字符所在的短句，从该短句的对应字符重新开读。
 */

import { clampRate } from './readingRate';

export interface ReadingSegment {
  /** 在全文中的起始字符偏移 */
  start: number;
  /** 在全文中的结束字符偏移（不含） */
  end: number;
  text: string;
}

export type ReaderState = 'idle' | 'playing' | 'paused' | 'ended';

export interface ReaderProgress {
  state: ReaderState;
  /** 当前朗读到的字符偏移（0 ~ charTotal） */
  charIndex: number;
  charTotal: number;
  /** 当前所在短句下标 */
  segmentIndex: number;
  /** 估算已用时长（毫秒） */
  elapsedMs: number;
  /** 估算总时长（毫秒） */
  totalMs: number;
}

/** 中文朗读速度基准：1.0 倍速下每秒约 4.6 个字（本地 SAPI 中文语音的经验值）。 */
export const CHARS_PER_SECOND = 4.6;

/** 句末标点：这些字符之后允许断开。 */
const SENTENCE_END = /[。！？!?…；;\n]/;
/** 句末标点后紧跟的引号、括号归入同一句，避免「他说。」「……」，被切碎。 */
const TRAILING_MARKS = /[”’"'）)】」』》…，,、]/;
/** 单条语音过长时，退而用逗号断句，保证短句不会太长。 */
const CLAUSE_END = /[，,、：:]/;
const MAX_SEGMENT_CHARS = 90;

/** cancel() 之后到再次 speak() 的间隔：太短会被引擎静默丢弃，太长会听出停顿。 */
export const SPEAK_RESTART_DELAY_MS = 140;

/**
 * 把正文切成适合朗读的短句。
 * 返回的每个片段都保留在原文中的字符区间，因此进度可以用字符偏移精确表达。
 */
export function buildSegments(raw: string): ReadingSegment[] {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const out: ReadingSegment[] = [];

  const push = (start: number, end: number) => {
    if (end <= start) return;
    const slice = text.slice(start, end);
    if (!slice.trim()) return;
    if (slice.length > MAX_SEGMENT_CHARS) {
      splitLong(text, start, end, out);
      return;
    }
    out.push({ start, end, text: slice });
  };

  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (SENTENCE_END.test(text[i])) {
      let end = i + 1;
      while (end < text.length && TRAILING_MARKS.test(text[end])) end += 1;
      push(start, end);
      start = end;
      i = end;
      continue;
    }
    i += 1;
  }
  push(start, text.length);
  return out;
}

/** 硬切上限：无标点的超长句按这个长度强制断开（含当前字符，因此不会多切 1 个）。 */
const HARD_LIMIT = Math.round(MAX_SEGMENT_CHARS * 1.5);

/** 超长句按逗号再切，切不动就按长度硬切，保证每条语音都很短。 */
function splitLong(text: string, start: number, end: number, out: ReadingSegment[]): void {
  let cursor = start;
  let lastBreak = -1;
  for (let i = start; i < end; i += 1) {
    if (CLAUSE_END.test(text[i])) lastBreak = i + 1;
    if (lastBreak > cursor && i - cursor >= MAX_SEGMENT_CHARS) {
      // 优先在最近的逗号/顿号处断开，长度不会超过「逗号位置」
      out.push({ start: cursor, end: lastBreak, text: text.slice(cursor, lastBreak) });
      cursor = lastBreak;
      lastBreak = -1;
    } else if (i - cursor + 1 >= HARD_LIMIT) {
      // 一直没有可断的标点：按 HARD_LIMIT 精确硬切，长度严格不超过上限
      out.push({ start: cursor, end: i + 1, text: text.slice(cursor, i + 1) });
      cursor = i + 1;
      lastBreak = -1;
    }
  }
  if (cursor < end) {
    const slice = text.slice(cursor, end);
    if (slice.trim()) out.push({ start: cursor, end, text: slice });
  }
}

/** 找到包含指定字符偏移的短句下标；越界时返回最后一句。 */
export function findSegmentIndex(segments: ReadingSegment[], charIndex: number): number {
  if (!segments.length) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (charIndex < seg.start) hi = mid - 1;
    else if (charIndex >= seg.end) lo = mid + 1;
    else {
      found = mid;
      break;
    }
  }
  if (found >= 0) return found;
  // 落在句间空白里：归到下一句
  return Math.min(segments.length - 1, lo);
}

export function estimateMs(chars: number, rate: number): number {
  const safeRate = rate > 0 ? rate : 1;
  return Math.max(0, Math.round((Math.max(0, chars) / (CHARS_PER_SECOND * safeRate)) * 1000));
}

/** 把毫秒格式化成 mm:ss（超过一小时显示 h:mm:ss）。 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export interface ReaderVoice {
  id: string;
  name: string;
  lang: string;
  local: boolean;
  default: boolean;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** 读取系统语音列表；Chromium 首次调用是异步的，需要等待 voiceschanged。 */
export function loadVoices(timeoutMs = 4000): Promise<ReaderVoice[]> {
  if (!isSpeechSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const map = (list: SpeechSynthesisVoice[]): ReaderVoice[] =>
    list.map((v) => ({ id: v.name, name: v.name, lang: v.lang, local: v.localService, default: v.default }));
  const existing = synth.getVoices();
  if (existing.length) return Promise.resolve(map(existing));
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', finish);
      resolve(map(synth.getVoices()));
    };
    synth.addEventListener('voiceschanged', finish);
    window.setTimeout(finish, timeoutMs);
  });
}

/** 中文优先排序，其次系统默认语音，方便用户直接选到能读中文的声音。 */
export function sortVoices(voices: ReaderVoice[]): ReaderVoice[] {
  const score = (v: ReaderVoice): number => {
    let s = 0;
    if (/^zh/i.test(v.lang)) s -= 100;
    if (v.default) s -= 10;
    if (v.local) s -= 1;
    return s;
  };
  return [...voices].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

export interface ReaderOptions {
  onProgress: (progress: ReaderProgress) => void;
  onError: (message: string) => void;
  /** 整章读完后触发（自动续读下一章用） */
  onFinished?: () => void;
}

/**
 * 实时朗读器：把文本切片后逐句朗读，支持随时暂停、拖动、变速、换声音。
 */
export class SpeechReader {
  private text = '';
  private segments: ReadingSegment[] = [];
  private state: ReaderState = 'idle';
  private charIndex = 0;
  private seq = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private rate = 1;
  private pitch = 1;
  private volume = 1;
  private disposed = false;
  /** 看门狗：utterance 没有回调时兜底重试 */
  private watchdog: number | null = null;
  private retried = false;

  constructor(private options: ReaderOptions) {}

  get currentState(): ReaderState {
    return this.state;
  }

  get currentCharIndex(): number {
    return this.charIndex;
  }

  get charTotal(): number {
    return this.text.length;
  }

  get segmentList(): ReadingSegment[] {
    return this.segments;
  }

  /** 载入文本并定位到指定字符（默认从头开始）。 */
  load(text: string, startChar = 0): void {
    this.hardCancel();
    this.text = String(text ?? '');
    this.segments = buildSegments(this.text);
    this.charIndex = Math.min(Math.max(0, Math.round(startChar)), this.text.length);
    this.state = 'idle';
    this.emit();
  }

  setVoiceByName(name: string): void {
    const list = isSpeechSupported() ? window.speechSynthesis.getVoices() : [];
    this.voice = list.find((v) => v.name === name) ?? null;
    this.restartIfPlaying();
  }

  /** 语速 0.1 ~ 3（保留两位小数），朗读中调用会立即从当前句重新开读。 */
  setRate(rate: number): void {
    const next = clampRate(rate, this.rate);
    if (next === this.rate) return;
    this.rate = next;
    this.restartIfPlaying();
  }

  setPitch(pitch: number): void {
    const next = Math.min(1.6, Math.max(0.5, Number(pitch) || 1));
    if (next === this.pitch) return;
    this.pitch = next;
    this.restartIfPlaying();
  }

  setVolume(volume: number): void {
    const next = Math.min(100, Math.max(0, Number(volume))) / 100;
    if (next === this.volume) return;
    this.volume = next;
    this.restartIfPlaying();
  }

  play(): void {
    if (this.disposed) return;
    if (!isSpeechSupported()) {
      this.options.onError('当前环境不支持实时朗读，请改用「离线生成音频」。');
      return;
    }
    if (!this.text.trim()) return;
    if (this.state === 'playing') return;
    if (this.state === 'ended' || this.charIndex >= this.text.length) {
      this.charIndex = 0;
    }
    this.state = 'playing';
    this.speakCurrent();
    this.emit();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hardCancel();
    this.emit();
  }

  toggle(): void {
    if (this.state === 'playing') this.pause();
    else this.play();
  }

  stop(): void {
    this.state = 'idle';
    this.charIndex = 0;
    this.hardCancel();
    this.emit();
  }

  /** 拖动进度条：直接跳到指定字符继续读。 */
  seek(charIndex: number): void {
    const next = Math.min(Math.max(0, Math.round(charIndex)), this.text.length);
    this.charIndex = next;
    if (this.state === 'playing') {
      if (next >= this.text.length) {
        this.finish();
        return;
      }
      this.speakCurrent();
    } else if (this.state === 'ended' && next < this.text.length) {
      this.state = 'paused';
    }
    this.emit();
  }

  /** 跳转到上一句 / 下一句开头。 */
  stepSentence(direction: -1 | 1): void {
    const idx = findSegmentIndex(this.segments, this.charIndex);
    if (idx < 0) return;
    const target = this.segments[Math.min(this.segments.length - 1, Math.max(0, idx + direction))];
    if (!target) return;
    const atStart = this.charIndex - this.segments[idx].start < 3;
    const index = direction < 0 && !atStart ? idx : Math.min(this.segments.length - 1, Math.max(0, idx + direction));
    this.seek(this.segments[index].start);
  }

  dispose(): void {
    this.disposed = true;
    this.state = 'idle';
    this.hardCancel();
  }

  private restartIfPlaying(): void {
    if (this.state === 'playing') this.speakCurrent();
    else this.emit();
  }

  private hardCancel(): void {
    if (!isSpeechSupported()) return;
    this.seq += 1;
    this.retried = false;
    if (this.watchdog) {
      window.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略取消失败 */
    }
  }

  private finish(): void {
    this.charIndex = this.text.length;
    this.state = 'ended';
    this.emit();
    this.options.onFinished?.();
  }

  /** 从当前字符偏移开始朗读；会先取消上一条语音。 */
  private speakCurrent(): void {
    if (!isSpeechSupported()) return;
    const synth = window.speechSynthesis;
    const mySeq = ++this.seq;

    // 找到真正要读的片段（跳过纯空白）
    let segIndex = findSegmentIndex(this.segments, this.charIndex);
    while (segIndex >= 0 && segIndex < this.segments.length) {
      const seg = this.segments[segIndex];
      const offset = Math.max(0, Math.min(seg.text.length, this.charIndex - seg.start));
      const slice = seg.text.slice(offset);
      if (slice.trim()) {
        this.speakSlice(seg, offset, slice, mySeq, synth);
        return;
      }
      this.charIndex = seg.end;
      segIndex += 1;
    }
    this.finish();
  }

  private speakSlice(
    seg: ReadingSegment,
    offset: number,
    slice: string,
    mySeq: number,
    synth: SpeechSynthesis,
  ): void {
    const start = () => {
      if (mySeq !== this.seq || this.state !== 'playing') return;
      try {
        if (synth.paused) synth.resume();
      } catch {
        /* 忽略 */
      }
      const utterance = new SpeechSynthesisUtterance(slice);
      let settled = false;
      // watchdog：Chromium 偶尔会把 speak() 静默丢弃，回调一个都不来，
      // 那样状态会永远停在「播放中」。超时后重试一次，仍失败就暂停并提示。
      const expected = estimateMs(slice.length, this.rate);
      const armWatchdog = () => {
        if (this.watchdog) window.clearTimeout(this.watchdog);
        this.watchdog = window.setTimeout(() => {
          if (settled || mySeq !== this.seq || this.state !== 'playing') return;
          if (this.retried) {
            this.state = 'paused';
            this.emit();
            this.options.onError('朗读没有响应，已暂停。请重新点击播放，或在设置中更换声音。');
            return;
          }
          this.retried = true;
          this.speakCurrent();
        }, Math.max(3000, expected * 2 + 1200));
      };
      if (this.voice) {
        utterance.voice = this.voice;
        utterance.lang = this.voice.lang;
      }
      utterance.rate = this.rate;
      utterance.pitch = this.pitch;
      utterance.volume = this.volume;

      utterance.onstart = () => {
        if (mySeq !== this.seq) return;
        this.retried = false;
        armWatchdog();
      };
      utterance.onboundary = (event) => {
        if (mySeq !== this.seq) return;
        this.retried = false;
        armWatchdog();
        const abs = seg.start + offset + Math.max(0, event.charIndex || 0);
        if (abs > this.charIndex && abs <= seg.end) {
          this.charIndex = abs;
          this.emit();
        }
      };
      utterance.onend = () => {
        settled = true;
        if (this.watchdog) {
          window.clearTimeout(this.watchdog);
          this.watchdog = null;
        }
        if (mySeq !== this.seq) return;
        this.retried = false;
        this.charIndex = seg.end;
        this.emit();
        if (this.state !== 'playing') return;
        if (seg.end >= this.text.length) {
          this.finish();
          return;
        }
        this.charIndex = seg.end;
        this.speakCurrent();
      };
      utterance.onerror = (event) => {
        settled = true;
        if (this.watchdog) {
          window.clearTimeout(this.watchdog);
          this.watchdog = null;
        }
        if (mySeq !== this.seq) return;
        const reason = String((event as SpeechSynthesisErrorEvent).error ?? '');
        if (reason === 'interrupted' || reason === 'canceled') return;
        this.state = 'paused';
        this.emit();
        this.options.onError(
          reason === 'not-allowed'
            ? '系统拒绝了朗读请求，请点击播放按钮重试。'
            : `朗读失败：${reason || '未知错误'}。可在设置中更换声音或改用离线生成。`,
        );
      };
      synth.speak(utterance);
      // speak() 之后立刻起表：即便 onstart 因引擎问题没来，也能兜住
      armWatchdog();
    };

    // Chromium 在 cancel() 之后立刻 speak() 会被静默丢弃，必须留出恢复间隔。
    // 一律先 cancel（包括看似空闲的情况，此时队列里可能仍有未置位的 utterance），
    // 再等一小段时间后重新 speak，避免连读两遍或整段丢失。
    try {
      synth.cancel();
    } catch {
      /* 忽略 */
    }
    window.setTimeout(start, SPEAK_RESTART_DELAY_MS);
  }

  private emit(): void {
    const totalMs = estimateMs(this.text.length, this.rate);
    this.options.onProgress({
      state: this.state,
      charIndex: this.charIndex,
      charTotal: this.text.length,
      segmentIndex: findSegmentIndex(this.segments, this.charIndex),
      elapsedMs: estimateMs(this.charIndex, this.rate),
      totalMs,
    });
  }
}
