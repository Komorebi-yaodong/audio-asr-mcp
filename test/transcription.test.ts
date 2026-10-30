import assert from 'node:assert/strict';
import { readFile, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { decodeTranscript, normalizeSrt } from '../src/subtitles.js';
import { transcribe } from '../src/transcription.js';
import { fixture, mockApi, sampleSrt, sampleVerbose } from './helpers.js';

function config(baseUrl: string) {
  return loadConfig({ AUDIO_ASR_API_KEY: 'test-secret', AUDIO_ASR_BASE_URL: baseUrl });
}

test('configuration defaults and full endpoint', () => {
  assert.equal(loadConfig({ AUDIO_ASR_API_KEY: 'x' }).endpoint, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(loadConfig({ AUDIO_ASR_API_KEY: 'x' }).model, 'whisper-1');
  assert.deepEqual(loadConfig({
    AUDIO_ASR_BASE_URL: 'https://example.com/custom/v1',
    AUDIO_ASR_API_KEY: 'custom-key',
    AUDIO_ASR_MODEL: 'custom-whisper',
  }), {
    endpoint: 'https://example.com/custom/v1/audio/transcriptions',
    apiKey: 'custom-key',
    model: 'custom-whisper',
  });
  assert.equal(config('https://example.com/v1/audio/transcriptions/').endpoint, 'https://example.com/v1/audio/transcriptions');
  assert.throws(() => loadConfig({}), /API_KEY/u);
  for (const url of ['file:///tmp', 'https://name:secret@example.com/v1', 'https://example.com/?key=x']) {
    assert.throws(() => config(url));
  }
});

test('Whisper multipart upload returns multilingual text and passes optional fields', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ body: JSON.stringify({ text: '你好，OpenAI。' }) })); t.after(api.close);
  const result = await transcribe({ audio_path: files.audioPath, language: 'zh', prompt: 'OpenAI' }, config(api.baseUrl));
  assert.deepEqual(result, { content: '你好，OpenAI。', format: 'text' });
  const call = api.calls[0]!;
  assert.equal(call.url, '/v1/audio/transcriptions');
  assert.equal(call.authorization, 'Bearer test-secret');
  assert.equal(call.form.get('model'), 'whisper-1');
  assert.equal(call.form.get('response_format'), 'verbose_json');
  assert.equal(call.form.has('temperature'), false);
  assert.equal(call.form.get('language'), 'zh');
  assert.equal(call.form.get('prompt'), 'OpenAI');
  const uploaded = call.form.get('file') as File;
  assert.equal(uploaded.name, '测试录音.wav');
  assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), await readFile(files.audioPath));
});

test('WhisperTTS-style verbose segments generate SRT in one request without language or prompt', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ body: JSON.stringify(sampleVerbose) })); t.after(api.close);
  assert.deepEqual(await transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl)), { content: sampleSrt, format: 'srt' });
  assert.equal(api.calls[0]!.form.get('response_format'), 'verbose_json');
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0]!.form.has('prompt'), false);
  assert.equal(api.calls[0]!.form.has('language'), false);
  assert.equal(api.calls[0]!.form.has('temperature'), false);
});

test('text reads top-level text while SRT reads segment text without rewriting', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const payload = { text: 'トップレベルの全文', segments: [{ start: 0, end: 10.4, text: ' ご提供いただいたリンクに基づき' }] };
  const api = await mockApi(() => ({ body: JSON.stringify(payload) })); t.after(api.close);
  const text = await transcribe({ audio_path: files.audioPath }, config(api.baseUrl));
  const srt = await transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl));
  assert.equal(text.content, payload.text);
  assert.equal(srt.content, '1\n00:00:00,000 --> 00:00:10,400\nご提供いただいたリンクに基づき\n');
  assert.deepEqual(api.calls.map(call => call.form.get('response_format')), ['verbose_json', 'verbose_json']);
});

test('native SRT is tried after verbose_json is explicitly unsupported', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi((_call, index) => index === 0
    ? { status: 400, body: JSON.stringify({ error: { param: 'response_format', message: 'verbose_json is not supported' } }) }
    : { body: sampleSrt, contentType: 'text/plain' }); t.after(api.close);
  assert.deepEqual(await transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl)), { content: sampleSrt, format: 'srt' });
  assert.deepEqual(api.calls.map(call => call.form.get('response_format')), ['verbose_json', 'srt']);
});

test('only-json API safely falls back after rejecting both subtitle formats', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi((_call, index) => index < 2
    ? { status: 422, body: JSON.stringify({ error: { param: 'response_format', message: 'Invalid response_format; only json is supported' } }) }
    : { body: JSON.stringify({ text: '纯文本结果' }) }); t.after(api.close);
  const result = await transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl));
  assert.equal(result.format, 'text');
  assert.equal(result.content, '纯文本结果');
  assert.ok(result.fallbackReason);
  assert.deepEqual(api.calls.map(call => call.form.get('response_format')), ['verbose_json', 'srt', 'json']);
});

test('text falls back to JSON for FastAPI response_format validation errors', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi((_call, index) => index === 0
    ? { status: 422, body: JSON.stringify({ detail: [{ loc: ['body', 'response_format'], type: 'literal_error', msg: "Input should be 'json'", input: 'verbose_json' }] }) }
    : { body: JSON.stringify({ text: '兼容输出' }) }); t.after(api.close);
  assert.equal((await transcribe({ audio_path: files.audioPath }, config(api.baseUrl))).content, '兼容输出');
  assert.deepEqual(api.calls.map(call => call.form.get('response_format')), ['verbose_json', 'json']);
});

test('an exhausted format negotiation returns a useful error instead of looping', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ status: 400, body: JSON.stringify({ error: { param: 'response_format', message: 'Unsupported response_format' } }) })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl)), /response_format/u);
  assert.equal(api.calls.length, 3);
});

test('successful plain response falls back without retrying', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ body: JSON.stringify({ text: '没有时间戳' }) })); t.after(api.close);
  const result = await transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl));
  assert.equal(result.format, 'text'); assert.equal(api.calls.length, 1);
});

test('real segment timestamps convert to SRT; invalid timestamps never invented', () => {
  const body = JSON.stringify({ text: '你好', segments: [{ start: 0.25, end: 1.5, text: '你好' }] });
  assert.equal(decodeTranscript(body, 'application/json', 'srt').content, '1\n00:00:00,250 --> 00:00:01,500\n你好\n');
  for (const segment of [{ start: 2, end: 1, text: '你好' }, { text: '你好' }]) {
    assert.equal(decodeTranscript(JSON.stringify({ text: '你好', segments: [segment] }), 'application/json', 'srt').format, 'text');
  }
  assert.equal(normalizeSrt(sampleSrt.replaceAll('\n', '\r\n')), sampleSrt);
  assert.equal(normalizeSrt('1\n00:61:00,000 --> 00:62:00,000\n错误'), undefined);
  assert.equal(normalizeSrt(''), undefined);
  assert.throws(() => decodeTranscript('{}', 'application/json', 'text'), /有效的文本/u);
  assert.throws(() => decodeTranscript('{', 'application/json', 'text'), /JSON/u);
  assert.deepEqual(decodeTranscript('{"text":""}', 'application/json', 'text'), { content: '', format: 'text' });
});

test('API errors do not leak remote messages or retry unrelated failures', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ status: 401, body: JSON.stringify({ error: { message: 'test-secret internal private text' } }) })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath, format: 'srt' }, config(api.baseUrl)), error => {
    assert.ok(error instanceof Error); assert.match(error.message, /401/u); assert.doesNotMatch(error.message, /test-secret|private/u); return true;
  });
  assert.equal(api.calls.length, 1);
});

test('non-format 422 is not retried and reports a sanitized field error', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ status: 422, body: JSON.stringify({ detail: [{ loc: ['body', 'language'], type: 'value_error', msg: 'Invalid language code', input: 'private input' }] }) })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath, format: 'srt', language: 'invalid' }, config(api.baseUrl)), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /422.*body\.language.*Invalid language code/u);
    assert.doesNotMatch(error.message, /private input/u);
    return true;
  });
  assert.equal(api.calls.length, 1);
});

test('400 validation errors redact key, audio path, prompt and bearer credentials', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const prompt = 'private-context';
  const message = `Invalid audio: test-secret ${files.audioPath} ${prompt} Bearer leaked-value gsk_otherkey https://example.com/?token=secret`;
  const api = await mockApi(() => ({ status: 400, body: JSON.stringify({ error: { param: 'file', code: 'invalid_audio', message } }) })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath, prompt }, config(api.baseUrl)), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Invalid audio/u);
    assert.match(error.message, /invalid_audio/u);
    for (const secret of ['test-secret', files.audioPath, prompt, 'leaked-value', 'gsk_otherkey', 'token=secret']) assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(api.calls.length, 1);
});

test('403 does not assert model permissions and HTML errors are not echoed', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ status: 403, contentType: 'text/html', body: '<html>private challenge</html>' })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath }, config(api.baseUrl)), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /代理\/网络出口/u);
    assert.doesNotMatch(error.message, /private challenge|当前 Key 或模型没有访问权限/u);
    return true;
  });
  assert.equal(api.calls.length, 1);
});


test('local files are validated before network requests', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const cfg = config('http://127.0.0.1:1/v1');
  await assert.rejects(transcribe({ audio_path: 'relative.wav' }, cfg), /绝对路径/u);
  await assert.rejects(transcribe({ audio_path: files.directory }, cfg), /普通音频文件/u);
  await assert.rejects(transcribe({ audio_path: path.join(files.directory, 'missing.wav') }, cfg), /不存在/u);
  const empty = path.join(files.directory, 'empty.wav'); await writeFile(empty, '');
  await assert.rejects(transcribe({ audio_path: empty }, cfg), /为空/u);
  const huge = path.join(files.directory, 'huge.wav'); await writeFile(huge, 'x'); await truncate(huge, 26 * 1024 * 1024);
  await assert.rejects(transcribe({ audio_path: huge }, cfg), /25 MB/u);
  const text = path.join(files.directory, 'audio.txt'); await writeFile(text, 'x');
  await assert.rejects(transcribe({ audio_path: text }, cfg), /不支持/u);
});

test('HTML response is rejected and request timeout is handled', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi(() => ({ body: '<html>login</html>', contentType: 'text/html' })); t.after(api.close);
  await assert.rejects(transcribe({ audio_path: files.audioPath }, config(api.baseUrl)), /网页/u);
  const hangingFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
  });
  const keepAlive = setTimeout(() => {}, 1000); t.after(() => clearTimeout(keepAlive));
  await assert.rejects(transcribe({ audio_path: files.audioPath }, config(api.baseUrl), { timeoutMs: 20, fetchImpl: hangingFetch }), /超时/u);
});
