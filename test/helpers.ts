import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'audio-transcription-test-'));
  const audioPath = path.join(directory, '测试录音.wav');
  const wav = Buffer.alloc(48);
  wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(4, 40);
  await writeFile(audioPath, wav);
  return { directory, audioPath, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

export interface ApiReply {
  status?: number;
  body: string;
  contentType?: string;
}

export interface ApiCall {
  url: string | undefined;
  authorization: string | undefined;
  form: FormData;
}

export async function mockApi(handler: (call: ApiCall, index: number) => ApiReply | Promise<ApiReply>) {
  const calls: ApiCall[] = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? '' },
        body: new Uint8Array(Buffer.concat(chunks)),
      });
      const call = { url: req.url, authorization: req.headers.authorization, form: await request.formData() };
      calls.push(call);
      const reply = await handler(call, calls.length - 1);
      res.writeHead(reply.status ?? 200, { 'content-type': reply.contentType ?? 'application/json' });
      res.end(reply.body);
    } catch {
      res.writeHead(500);
      res.end('Mock failure');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock API failed to start');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export const sampleSrt = '1\n00:00:00,000 --> 00:00:01,250\n你好，世界。\n\n2\n00:00:01,500 --> 00:00:03,000\nWhisper 转写测试。\n';
