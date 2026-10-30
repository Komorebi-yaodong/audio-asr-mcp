import { openAsBlob } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from './config.js';
import { decodeTranscript } from './subtitles.js';
import type { OutputFormat, TranscribeInput, Transcript } from './types.js';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1_000;
const MIME_TYPES: Record<string, string> = {
  '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4',
  '.mpeg': 'audio/mpeg', '.mpga': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm',
};

export interface TranscriptionOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function formatUnsupported(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { return false; }
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return false;
  const error = payload.error;
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  const message = typeof fields.message === 'string' ? fields.message : '';
  return (fields.param === 'response_format' || /response[_ ]format|\bsrt\b/iu.test(message))
    && /unsupported|not supported|does not support|invalid|not allowed|must be|only|supported.*json/iu.test(message);
}

function apiError(status: number): Error {
  const detail: Record<number, string> = {
    401: '请检查 API Key。', 403: '当前 Key 或模型没有访问权限。',
    413: '音频文件超过接口限制。', 429: '请求受限或余额不足，请稍后再试。',
  };
  return new Error(`转写接口请求失败（HTTP ${status}）。${detail[status] ?? '请检查服务地址、模型和请求参数。'}`);
}

export async function transcribe(
  input: TranscribeInput,
  config: Config,
  options: TranscriptionOptions = {},
): Promise<Transcript> {
  if (!path.isAbsolute(input.audio_path)) throw new Error('audio_path 必须是本地文件的绝对路径。');
  let info;
  try { info = await stat(input.audio_path); } catch { throw new Error('音频文件不存在或无法读取。'); }
  if (!info.isFile()) throw new Error('audio_path 必须指向普通音频文件。');
  if (!info.size) throw new Error('音频文件为空。');
  if (info.size > MAX_FILE_BYTES) throw new Error('音频文件超过 25 MB，请先压缩或分段。');
  const mimeType = MIME_TYPES[path.extname(input.audio_path).toLowerCase()];
  if (!mimeType) throw new Error('不支持的音频格式。支持 flac、mp3、mp4、mpeg、mpga、m4a、ogg、wav、webm。');

  const requested = input.format ?? 'text';
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request(format: OutputFormat): Promise<Transcript> {
    const form = new FormData();
    form.set('file', await openAsBlob(input.audio_path, { type: mimeType }), path.basename(input.audio_path));
    form.set('model', config.model);
    form.set('response_format', format === 'srt' ? 'srt' : 'json');
    if (input.language) form.set('language', input.language);
    if (input.prompt) form.set('prompt', input.prompt);

    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal,
      redirect: 'error',
    });
    const body = await response.text();
    if (!response.ok) {
      if (format === 'srt' && formatUnsupported(response.status, body)) {
        const fallback = await request('text');
        return { ...fallback, fallbackReason: '当前模型未提供 SRT，已返回纯文本。' };
      }
      throw apiError(response.status);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('html') || /^\s*<!doctype html|^\s*<html/iu.test(body)) {
      throw new Error('转写接口返回了网页而非转写结果，请检查服务地址。');
    }
    return decodeTranscript(body, contentType, format);
  }

  try {
    return await request(requested);
  } catch (error) {
    if (options.signal?.aborted) throw new Error('转写已取消。');
    if (timeout.aborted) throw new Error('转写请求超时，请稍后重试。');
    if (error instanceof TypeError || (error instanceof Error && error.name === 'NotReadableError')) {
      throw new Error('无法读取音频或连接转写接口，请检查文件和网络。');
    }
    throw error;
  }
}
