export interface Config {
  endpoint: string;
  apiKey: string;
  model: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = env.AUDIO_TRANSCRIPTION_BASE_URL?.trim() || 'https://api.openai.com/v1';
  const apiKey = env.AUDIO_TRANSCRIPTION_API_KEY?.trim();
  const model = env.AUDIO_TRANSCRIPTION_MODEL?.trim() || 'whisper-1';

  if (!apiKey) throw new Error('请设置 AUDIO_TRANSCRIPTION_API_KEY。');
  if (/[\r\n]/u.test(apiKey)) throw new Error('API Key 格式无效。');

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('AUDIO_TRANSCRIPTION_BASE_URL 必须是 HTTP(S) URL。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('API URL 必须使用 HTTP(S)，且不能包含用户名、密码、查询参数或片段。');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  if (!url.pathname.endsWith('/audio/transcriptions')) {
    url.pathname += '/audio/transcriptions';
  }
  return { endpoint: url.toString(), apiKey, model };
}
