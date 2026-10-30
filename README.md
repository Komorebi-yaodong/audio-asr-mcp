# audio-asr-mcp

将本地音频转为文本或 SRT 字幕的 MCP 服务，默认使用 OpenAI Whisper，支持 OpenAI 兼容的音频转写接口。

- 通过 `npx` 启动，使用 stdio 与 MCP 客户端通信。
- 直接返回转写内容，或保存为 UTF-8 `.txt` / `.srt` 文件。
- 通过环境变量配置 API 地址、Key 和模型。

## 快速开始

需要 **Node.js 22 或以上版本**。

将以下配置添加到 MCP 客户端，填入 API Key 后启动服务：

```json
{
  "mcpServers": {
    "audio-asr": {
      "command": "npx",
      "args": ["-y", "audio-asr-mcp"],
      "env": {
        "AUDIO_ASR_BASE_URL": "https://api.openai.com/v1",
        "AUDIO_ASR_API_KEY": "YOUR_API_KEY",
        "AUDIO_ASR_MODEL": "whisper-1"
      }
    }
  }
}
```

部分 Windows 客户端需将 `command` 改为 `npx.cmd`。如需固定版本，可在 `args` 中使用 `audio-asr-mcp@0.1.2`。

配置完成后，可在客户端中提出请求：

> 将 `E:\Audio\meeting.mp3` 转为文字，直接返回。

> 将 `E:\Audio\meeting.mp3` 转为 SRT，保存到 `E:\Transcripts\meeting.srt`。

音频文件与输出路径均位于运行 MCP 服务的机器上。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `AUDIO_ASR_BASE_URL` | 否 | `https://api.openai.com/v1` | OpenAI 兼容 API 的基础地址 |
| `AUDIO_ASR_API_KEY` | 是 | — | API Key |
| `AUDIO_ASR_MODEL` | 否 | `whisper-1` | 转写模型名称 |

基础地址需包含服务的版本路径，例如 `/v1`；也可以直接填写完整的 `/audio/transcriptions` 地址。音频文件会上传到该地址进行转写。

环境变量从进程中读取，不会自动加载 `.env` 文件。模型需支持文件转写接口。

### Groq 配置

使用 Groq 时，将对应配置设为：

```json
{
  "AUDIO_ASR_BASE_URL": "https://api.groq.com/openai/v1",
  "AUDIO_ASR_API_KEY": "YOUR_GROQ_API_KEY",
  "AUDIO_ASR_MODEL": "whisper-large-v3"
}
```

需要代理时，在 MCP 的 `env` 中添加以下变量，并重启服务（使用 Node.js 24 或以上）：

```json
{
  "NODE_USE_ENV_PROXY": "1",
  "HTTP_PROXY": "http://127.0.0.1:10808",
  "HTTPS_PROXY": "http://127.0.0.1:10808"
}
```

将端口替换为本机 HTTP 代理端口。Windows 系统代理设置不会自动应用到 Node 的请求。

## 工具：`transcribe_audio`

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `audio_path` | string | 是 | 本地音频文件的绝对路径 |
| `format` | `text` / `srt` | 否 | 输出格式，默认 `text` |
| `output_path` | string | 否 | 已有目录，或父目录已存在的 `.txt` / `.srt` 文件路径；使用绝对路径 |
| `language` | string | 否 | 音频语言代码，如 `zh`、`en`；省略时自动识别 |
| `prompt` | string | 否 | 人名、术语或录音上下文等转写提示 |

### 直接返回文本

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3"
}
```

返回结构：

```json
{
  "format": "text",
  "delivery": "inline",
  "text": "会议转写内容……"
}
```

### 直接返回 SRT

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3",
  "format": "srt"
}
```

返回结构中的 `format` 为 `srt`，`text` 为完整的字幕内容。

### 保存文件

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3",
  "format": "srt",
  "output_path": "E:\\Transcripts\\meeting.srt",
  "language": "zh"
}
```

返回结构：

```json
{
  "format": "srt",
  "delivery": "file",
  "output_path": "E:\\Transcripts\\meeting.srt"
}
```

也可以将 `output_path` 设为已有目录，如 `E:\Transcripts`，文件名将沿用音频名称，生成 `meeting.txt` 或 `meeting.srt`。

### 转写与字幕

文本和 SRT 均优先请求 `response_format=verbose_json`：文本读取返回的 `text`，SRT 使用 `segments` 中的文字和起止时间在本地生成，不额外翻译或改写。

`language` 和 `prompt` 仅在明确填写时发送，不默认设置语言或温度。自动识别语言时，省略 `language`；日语录音可填写 `ja`，不要使用目标翻译语言代替录音语言。

### 输出与回退

- 省略 `output_path` 时，直接返回内容；保存成功时，仅返回文件路径。
- 输出目录不存在、无法写入或目标文件已存在时，直接返回内容，不创建目录、不覆盖文件。
- 接口明确不支持 `verbose_json` 时，SRT 请求依次尝试原生 `srt`、`json`，文本请求尝试 `json`。成功响应不会再次转写。
- 返回结果没有可用时间戳时，SRT 回退为纯文本；若指定了文件输出，实际保存为 `.txt`。
- 文件后缀与实际输出格式一致。回退原因通过 `fallback_reason` 返回。
- 认证、限流、网络错误以及其他参数校验错误不会触发格式切换；工具错误中保留脱敏后的服务端原因与字段信息。

## 支持的音频与限制

- **格式**：FLAC、MP3、MP4、MPEG、MPGA、M4A、OGG、WAV、WEBM。
- **大小**：单个文件最多 25 MiB（25 × 1024 × 1024 字节）。
- **超时**：单次调用的网络请求总超时为 10 分钟，可由客户端取消。
- 不自动切割音频；较大文件需先压缩或分段。长录音需在 MCP 客户端中设置足够的调用超时。

## 本地开发

```sh
pnpm install
pnpm check
pnpm start
```

`pnpm check` 执行类型检查、构建和测试。运行服务前需设置上述环境变量。

## 许可证

MIT
