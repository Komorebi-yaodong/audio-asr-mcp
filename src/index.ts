#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { metadata } from './metadata.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${metadata.version}\n`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${metadata.name} ${metadata.version}

stdio MCP 服务，将本地音频转为文本 / SRT。

环境变量：
  AUDIO_TRANSCRIPTION_BASE_URL  默认 https://api.openai.com/v1
  AUDIO_TRANSCRIPTION_API_KEY   必填
  AUDIO_TRANSCRIPTION_MODEL     默认 whisper-1

由 MCP 客户端启动本命令；工具名：transcribe_audio。
`);
    return;
  }
  if (args.length) throw new Error('不支持的启动参数。使用 --help 查看说明。');

  const server = createServer(loadConfig());
  const transport = new StdioServerTransport();
  const shutdown = async (): Promise<void> => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'MCP 启动失败。'}\n`);
  process.exitCode = 1;
});
