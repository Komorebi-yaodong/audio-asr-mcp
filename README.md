# Audio Transcription MCP

将本地音频转成文字或 SRT 字幕的 stdio MCP 服务，默认使用 OpenAI 官方 Whisper。支持直接返回内容，或保存为 UTF-8 `.txt` / `.srt` 文件。

## 功能

- 通过环境变量配置 API URL、Key、模型。
- 一个工具 `transcribe_audio`，支持文字 / SRT。
- 输出路径可填写已有目录或完整文件路径。
- 路径不存在、不可写或目标文件已存在时，直接返回内容；不创建目录、不覆盖文件。
- SRT 不可用时回退纯文本；保存文件时自动使用 `.txt`。
- 可发布为 npm 包，通过 `npx` 启动。

## 环境要求

- Node.js **22 或以上**。
- 开发使用 pnpm。
- 运行在能够读取音频文件的本机环境；stdio MCP 客户端负责启动服务。

## MCP 配置

### 本地使用（尚未发布）

在项目目录执行：

```powershell
Set-Location 'E:\Programming\audio-transcription'
pnpm install
pnpm build
```

将以下内容加入 MCP 客户端配置：

```json
{
  "mcpServers": {
    "audio-transcription": {
      "command": "node",
      "args": ["E:\\Programming\\audio-transcription\\dist\\index.js"],
      "env": {
        "AUDIO_TRANSCRIPTION_BASE_URL": "https://api.openai.com/v1",
        "AUDIO_TRANSCRIPTION_API_KEY": "你的 API Key",
        "AUDIO_TRANSCRIPTION_MODEL": "whisper-1"
      }
    }
  }
}
```

### npm 发布后使用 npx

以下包名是当前 `package.json` 中的预设名称，**不表示已经发布或已取得该名称**。发布时可以更换为自己的包名，例如 `@your-scope/audio-transcription-mcp`。

```json
{
  "mcpServers": {
    "audio-transcription": {
      "command": "npx",
      "args": ["-y", "audio-transcription-mcp"],
      "env": {
        "AUDIO_TRANSCRIPTION_BASE_URL": "https://api.openai.com/v1",
        "AUDIO_TRANSCRIPTION_API_KEY": "你的 API Key",
        "AUDIO_TRANSCRIPTION_MODEL": "whisper-1"
      }
    }
  }
}
```

部分 Windows MCP 客户端需要使用 `"command": "npx.cmd"`，其他配置不变。音频路径始终以运行 MCP 服务的机器为准。

## 环境变量

| 变量 | 必填 | 默认值 / 说明 |
| --- | --- | --- |
| `AUDIO_TRANSCRIPTION_BASE_URL` | 否 | `https://api.openai.com/v1`，支持自定义 OpenAI 兼容地址，也接受完整 `/audio/transcriptions` URL |
| `AUDIO_TRANSCRIPTION_API_KEY` | 是 | Bearer API Key |
| `AUDIO_TRANSCRIPTION_MODEL` | 否 | `whisper-1` |

Base URL 需要包含服务使用的版本路径（例如 `/v1`），程序只补充 `/audio/transcriptions`，不猜测版本号。

程序读取进程环境变量，**不会自动加载 `.env`**。`.env.example` 仅作示例；推荐直接在 MCP 客户端的 `env` 中配置。自托管服务不需要鉴权时，也需要配置非空占位 Key。

音频会发送至配置的 API 地址；Key 和服务端原始错误体不会写入日志。

## 工具：`transcribe_audio`

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `audio_path` | 是 | 本地音频普通文件的绝对路径 |
| `format` | 否 | `text` 或 `srt`，默认 `text` |
| `output_path` | 否 | 已有目录，或父目录已存在的 `.txt` / `.srt` 目标文件路径；必须是绝对路径 |
| `language` | 否 | 语言代码，例如 `zh`、`en`；不传则由接口自动识别 |
| `prompt` | 否 | 专有名词、上下文等转写提示 |

### 直接返回文字

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3"
}
```

工具直接返回转写文字；机器可读结果为：

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

### 保存到已有目录

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3",
  "format": "text",
  "output_path": "E:\\Transcripts"
}
```

目录存在且可写时生成 `E:\Transcripts\meeting.txt`；相同文件已存在则直接返回内容。

### 保存到指定文件

```json
{
  "audio_path": "E:\\Audio\\meeting.mp3",
  "format": "srt",
  "output_path": "E:\\Transcripts\\meeting-2026.srt",
  "language": "zh"
}
```

成功时仅返回保存位置，不重复返回整篇转写内容：

```json
{
  "format": "srt",
  "delivery": "file",
  "output_path": "E:\\Transcripts\\meeting-2026.srt"
}
```

### 回退规则

1. **输出路径不可用**：不建目录，返回转写内容，并在 `fallback_reason` 中用一句话说明原因。
2. **目标文件已存在**：不覆盖，直接返回内容。
3. **SRT 不可用**：若接口返回文字则直接复用；若明确拒绝 SRT 格式，则重试一次 JSON 转写。认证、配额、网络等错误不会触发该重试。
4. **SRT 回退后写文件**：原来指定 `result.srt` 时改为 `result.txt`；如果 `.txt` 已存在，同样不覆盖。
5. **格式与后缀**：`format` 决定内容与实际文件后缀，避免把纯文本写入 `.srt`。程序不编造时间戳。

正常转写不附加提示。输入文件或 API 错误以 MCP 工具错误返回，不伪装为成功的空文本。

## 文件与请求限制

- 支持：FLAC、MP3、MP4、MPEG、MPGA、M4A、OGG、WAV、WEBM。
- 单个文件不超过 **25 MiB（25 × 1024 × 1024 字节）**；程序不自动切割音频。
- 单次工具调用的网络请求总超时为 **10 分钟**，可由 MCP 客户端取消。
- 对长录音，请相应提高 MCP 客户端的工具调用超时。
- 不自动重试网络、限流或服务端错误；不跟随 HTTP 重定向。

## 开发与测试

```powershell
pnpm install
pnpm check
```

`pnpm check` 依次执行类型检查、构建和测试。测试使用本地模拟转写 API，包括真实 stdio 客户端调用，不上传真实音频或调用计费 API。

```text
src/
  config.ts         环境变量与接口地址
  transcription.ts  音频验证、文件上传与错误处理
  subtitles.ts      原生 SRT 校验、时间戳转换及纯文本回退
  output.ts         文件输出与路径回退
  server.ts         MCP 工具及返回结构
  index.ts          stdio / CLI 入口
```

## 打包与发布

先将 `package.json` 中的 `name` 改为自己可发布的 npm 包名，补充作者、仓库等信息，并确认许可证。`bin` 命令名称可按需调整。

```powershell
pnpm check
pnpm pack
```

`prepack` 会自动构建。包内容通过 `files` 白名单控制；不会包含源码测试、本地凭据、`进度.md` 或 `项目AGENT.md`。

确认打包内容后自行发布：

```powershell
pnpm publish --access public
```

发布后即可在 MCP 配置中使用 `npx -y <实际包名>`。本项目不会自动发布。
