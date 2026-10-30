import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { metadata } from '../src/metadata.js';
import { fixture, mockApi, sampleSrt, sampleVerbose } from './helpers.js';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));

test('compiled stdio server supports list/call, files, fallback and validation', async t => {
  const files = await fixture(); t.after(files.cleanup);
  const api = await mockApi((_call, index) => index === 3
    ? { status: 422, body: JSON.stringify({ detail: [{ loc: ['body', 'language'], msg: 'Invalid language code', input: 'private-context' }] }) }
    : { body: JSON.stringify({ ...sampleVerbose, text: 'MCP 测试文本' }) }); t.after(api.close);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    env: { AUDIO_ASR_API_KEY: 'test-secret', AUDIO_ASR_BASE_URL: api.baseUrl, AUDIO_ASR_MODEL: 'whisper-1' },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'audio-transcription-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 1); assert.equal(tools.tools[0]!.name, 'transcribe_audio');
  assert.ok(tools.tools[0]!.outputSchema);

  const inline = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: files.audioPath } });
  assert.equal(inline.isError, undefined);
  assert.deepEqual(inline.structuredContent, { format: 'text', delivery: 'inline', text: 'MCP 测试文本' });

  const output = path.join(files.directory, 'mcp.srt');
  const saved = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: files.audioPath, format: 'srt', output_path: output } });
  assert.deepEqual(saved.structuredContent, { format: 'srt', delivery: 'file', output_path: output });
  assert.equal(await readFile(output, 'utf8'), sampleSrt);

  const fallback = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: files.audioPath, output_path: path.join(files.directory, 'missing') } });
  const fallbackData = fallback.structuredContent as Record<string, unknown>;
  assert.equal(fallbackData.delivery, 'inline');
  assert.equal(fallbackData.text, 'MCP 测试文本');
  assert.ok(fallbackData.fallback_reason);

  const invalid = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: 'relative.wav' } });
  assert.equal(invalid.isError, true);
  const badFormat = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: files.audioPath, format: 'pdf' } });
  assert.equal(badFormat.isError, true);
  const apiFailure = await client.callTool({ name: 'transcribe_audio', arguments: { audio_path: files.audioPath } });
  assert.equal(apiFailure.isError, true);
  assert.match(JSON.stringify(apiFailure.content), /body\.language.*Invalid language code/u);
  assert.doesNotMatch(JSON.stringify(apiFailure.content), /private-context/u);
  assert.equal(api.calls.length, 4);
  for (const call of api.calls) {
    assert.equal(call.form.get('response_format'), 'verbose_json');
    assert.equal(call.form.has('language'), false);
    assert.equal(call.form.has('prompt'), false);
    assert.equal(call.form.has('temperature'), false);
  }
  assert.equal(stderr, '');
});

test('CLI help/version need no credentials; missing key exits without stdout noise', async () => {
  const run = promisify(execFile);
  const env = { ...process.env }; delete env.AUDIO_ASR_API_KEY;
  const help = await run(process.execPath, [entry, '--help'], { env });
  assert.match(help.stdout, /AUDIO_ASR_API_KEY/u);
  const version = await run(process.execPath, [entry, '--version'], { env });
  assert.equal(version.stdout.trim(), metadata.version);
  await assert.rejects(run(process.execPath, [entry], { env }), error => {
    const failure = error as Error & { stdout: string; stderr: string; code: number };
    assert.equal(failure.code, 1); assert.equal(failure.stdout, ''); assert.match(failure.stderr, /API_KEY/u);
    return true;
  });
});
