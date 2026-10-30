import type { OutputFormat, Transcript } from './types.js';

const timingLine = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/u;

function timestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000).toString().padStart(2, '0');
  const minutes = Math.floor((ms % 3_600_000) / 60_000).toString().padStart(2, '0');
  const seconds = Math.floor((ms % 60_000) / 1_000).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds},${(ms % 1_000).toString().padStart(3, '0')}`;
}

/** Validates native subtitles rather than accepting arbitrary text as a .srt file. */
export function normalizeSrt(value: string): string | undefined {
  const blocks = value.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').trim().split(/\n\s*\n/u);
  const normalized: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (!/^\d+$/u.test(lines[0]?.trim() ?? '')) return undefined;
    const timing = lines[1]?.trim();
    const match = timing?.match(timingLine);
    if (!match || !lines.slice(2).join('\n').trim()) return undefined;
    const parts = match.slice(1).map(Number);
    const [h1, m1, s1, ms1, h2, m2, s2, ms2] = parts as [number, number, number, number, number, number, number, number];
    if (m1 > 59 || s1 > 59 || m2 > 59 || s2 > 59) return undefined;
    const start = h1 * 3_600_000 + m1 * 60_000 + s1 * 1_000 + ms1;
    const end = h2 * 3_600_000 + m2 * 60_000 + s2 * 1_000 + ms2;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return undefined;
    normalized.push(`${normalized.length + 1}\n${timing}\n${lines.slice(2).join('\n').trim()}`);
  }
  return normalized.length ? `${normalized.join('\n\n')}\n` : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function srtFromSegments(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const cues: string[] = [];
  for (const segment of value) {
    if (!isObject(segment) || typeof segment.text !== 'string') return undefined;
    const text = segment.text.trim();
    if (!text) continue;
    const { start, end } = segment;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return undefined;
    const startMs = Math.round(start * 1_000);
    const endMs = Math.round(end * 1_000);
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) return undefined;
    cues.push(`${cues.length + 1}\n${timestamp(startMs)} --> ${timestamp(endMs)}\n${text.replace(/\r\n?/gu, '\n').replace(/\n\s*\n/gu, '\n')}`);
  }
  return cues.length ? `${cues.join('\n\n')}\n` : undefined;
}

export function decodeTranscript(body: string, contentType: string, requested: OutputFormat): Transcript {
  let payload: unknown = body;
  if (contentType.includes('json')) {
    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error('转写接口返回了无效的 JSON。');
    }
  } else if (body.trimStart().startsWith('{')) {
    try { payload = JSON.parse(body); } catch { /* Plain text may start with a brace. */ }
  }

  let text: string;
  if (typeof payload === 'string') {
    text = payload.replace(/^\uFEFF/u, '');
  } else if (isObject(payload) && typeof payload.text === 'string') {
    text = payload.text;
  } else if (isObject(payload) && Array.isArray(payload.segments) && payload.segments.every(s => isObject(s) && typeof s.text === 'string')) {
    text = payload.segments.map(s => (s as { text: string }).text).join(' ').trim();
  } else {
    throw new Error('转写接口没有返回有效的文本。');
  }

  if (requested === 'srt') {
    const srt = normalizeSrt(text) ?? (isObject(payload) ? srtFromSegments(payload.segments) : undefined);
    if (srt) return { content: srt, format: 'srt' };
    return { content: text, format: 'text', fallbackReason: '未获得可用字幕，已返回纯文本。' };
  }
  return { content: text, format: 'text' };
}
