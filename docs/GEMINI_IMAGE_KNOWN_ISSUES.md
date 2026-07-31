# Gemini 图像模型已知问题与规避策略

本文档记录 Gemini / Nano Banana 图像模型在分辨率、宽高比和参数大小写上的已知行为差异，并说明 SanHub 当前的处理方式。

更新时间：2026-02

## 适用范围

本文主要覆盖以下模型：

| 模型 | 常用别名 | 说明 |
| --- | --- | --- |
| `gemini-3-pro-image-preview` | `nano-banana-pro`、`banana-pro` | 高质量图像生成模型，支持 `1K` / `2K` / `4K` 档位 |
| `gemini-3.1-flash-image-preview` | `nano-banana-2`、`banana-2`、`banana2` | 快速图像生成和编辑模型，支持更多宽高比 |

相关参数主要包括：

| 参数 | 说明 |
| --- | --- |
| `aspectRatio` / `aspect_ratio` | 目标宽高比，例如 `1:1`、`16:9`、`9:16` |
| `imageSize` / `image_size` | 分辨率档位，例如 `1K`、`2K`、`4K` |
| `size` | 具体像素尺寸，例如 `1024x1024`、`3840x2160` |

## 问题总览

| 问题 | 影响模型 | 表现 | 风险 |
| --- | --- | --- | --- |
| `imageSize` 被静默忽略 | `gemini-3-pro-image-preview` | 即使传入 `imageSize: "4K"`，上游仍可能返回 1K 图像 | 用户选择高清档位后实际输出不符合预期 |
| 编辑时 `aspectRatio` 被忽略 | `gemini-3.1-flash-image-preview` | 图生图、背景编辑、参考图编辑时，宽高比可能不按请求生效 | 输出尺寸沿用参考图或由上游自动决定 |
| `imageSize` 大小写敏感 | 所有 Gemini 图像模型 | `"1k"`、`"2k"`、`"4k"` 可能被上游当作无效值或降级处理 | 输出静默降级，例如返回 512px 或默认尺寸 |

## 详细说明

### 1. Pro 模型忽略 `imageSize`

`gemini-3-pro-image-preview` 理论上支持 `1K`、`2K`、`4K` 档位，但在部分上游实现中，单独传入 `imageSize` 并不可靠。

典型现象：

| 请求意图 | 可能结果 |
| --- | --- |
| `imageSize: "4K"` | 实际返回 1K |
| `aspectRatio: "16:9"` + `imageSize: "4K"` | 宽高比可能正确，但分辨率仍不达 4K |

推荐策略：

不要只依赖 `imageSize`。应尽量同时传入具体像素 `size`，让上游有明确的最终尺寸约束。

示例：

```json
{
  "aspectRatio": "16:9",
  "imageSize": "4K",
  "size": "3840x2160"
}
```

### 2. Flash 编辑场景忽略 `aspectRatio`

`gemini-3.1-flash-image-preview` 在文生图场景中通常能较好遵守 `aspectRatio`。但在图生图、参考图编辑、背景编辑等场景中，上游可能优先参考输入图尺寸，导致 `aspectRatio` 不生效。

典型现象：

| 场景 | 可能结果 |
| --- | --- |
| 上传竖图，要求 `16:9` | 输出仍接近竖图比例 |
| 上传方图，要求 `9:16` | 输出仍接近方图 |
| 多参考图编辑 | 输出比例由上游综合判断 |

推荐策略：

尽量同时传入：

- `aspectRatio`
- `imageSize`
- `size`

如果业务强依赖最终画布比例，需要在生成后增加裁切、补边或重采样流程。SanHub 当前只做上游参数规避，不对结果做强制后处理。

### 3. `imageSize` 大小写敏感

Gemini 图像模型对 `imageSize` 的大小写较敏感。推荐始终使用大写 `K`。

| 不推荐 | 推荐 |
| --- | --- |
| `1k` | `1K` |
| `2k` | `2K` |
| `4k` | `4K` |

如果传入小写值，上游可能不会显式报错，而是静默降级到默认尺寸或较低分辨率。

## SanHub 的处理方式

SanHub 当前采用“输入标准化 + 像素尺寸映射 + 多路径透传”的策略，尽量降低上游参数不生效的概率。

### 1. 输入标准化

SanHub 会在进入生成流程前标准化用户输入：

| 输入 | 标准化结果 |
| --- | --- |
| `1k` | `1K` |
| `２Ｋ` | `2K` |
| `16：9` | `16:9` |
| ` １６ ： ９ ` | `16:9` |
| `1024×1024` | `1024x1024` |

相关实现：

| 文件 | 作用 |
| --- | --- |
| `lib/image-sizing.ts` | 标准化 `size`、`aspectRatio`、`imageSize` |
| `app/api/generate/image/route.ts` | 解析前端生成请求 |
| `lib/v1-images.ts` | 解析 OpenAI Images 兼容请求 |

### 2. 将档位映射为具体像素尺寸

SanHub 不只把 `imageSize: "4K"` 传给上游，还会尽量根据宽高比映射出明确的 `size`。

常见映射示例：

| `imageSize` | `aspectRatio` | `size` |
| --- | --- | --- |
| `1K` | `1:1` | `1024x1024` |
| `2K` | `16:9` | `2048x1152` |
| `4K` | `16:9` | `3840x2160` |
| `4K` | `9:16` | `2160x3840` |
| `4K` | `21:9` | `5120x2160` |

管理后台的 Gemini Pro 预设还维护了一组更细的像素映射，用于模型配置中的 `resolutions` 字段。

### 3. OpenAI-compatible 渠道的透传方式

对于 `/v1/images/generations` 兼容渠道，SanHub 会尽量同时传：

```json
{
  "size": "3840x2160",
  "extra_body": {
    "google": {
      "image_config": {
        "aspect_ratio": "16:9",
        "image_size": "4K",
        "size": "3840x2160"
      }
    }
  }
}
```

这样做的目的：

- `size` 给 OpenAI-compatible 层明确像素约束；
- `extra_body.google.image_config.aspect_ratio` 给 Gemini 兼容层保留宽高比；
- `extra_body.google.image_config.image_size` 给 Gemini 兼容层保留档位；
- `extra_body.google.image_config.size` 作为最终像素尺寸兜底。

### 4. Gemini 原生渠道的透传方式

对于 Google Gemini 原生接口，SanHub 会在 `generationConfig` 中同时写入两处：

```json
{
  "generationConfig": {
    "imageConfig": {
      "aspectRatio": "16:9",
      "imageSize": "4K",
      "size": "3840x2160"
    },
    "responseFormat": {
      "image": {
        "aspectRatio": "16:9",
        "imageSize": "4K",
        "size": "3840x2160"
      }
    }
  }
}
```

这样做是为了兼容不同上游实现对参数路径的识别差异。

## 推荐请求写法

### 文生图

推荐同时传 `aspectRatio` 和 `imageSize`。如果调用方可以计算像素尺寸，也建议传 `size`。

```json
{
  "model": "gemini-3-pro-image-preview",
  "prompt": "A cinematic product poster",
  "aspectRatio": "16:9",
  "imageSize": "4K",
  "size": "3840x2160"
}
```

### 图生图 / 编辑

编辑场景下不要只依赖 `aspectRatio`。如果最终比例非常重要，应在业务层准备接近目标比例的参考图，或在生成后做后处理。

```json
{
  "model": "gemini-3.1-flash-image-preview",
  "prompt": "Replace the background with a sunset beach",
  "aspectRatio": "16:9",
  "imageSize": "2K",
  "size": "2048x1152",
  "image": "data:image/png;base64,..."
}
```

## 当前限制

SanHub 的规避策略无法保证上游一定按请求返回目标尺寸。原因是：

- 上游可能忽略某些参数；
- 编辑场景可能优先参考输入图尺寸；
- 聚合渠道可能只支持部分参数；
- 不同渠道对 `size`、`imageSize`、`aspectRatio` 的优先级不一致。

因此，SanHub 当前保证的是：

| 能力 | 状态 |
| --- | --- |
| 输入标准化 | 已支持 |
| `1k` 转 `1K` | 已支持 |
| 全角比例转半角比例 | 已支持 |
| `imageSize + aspectRatio` 映射到像素 `size` | 已支持 |
| OpenAI-compatible 参数透传 | 已支持 |
| Gemini 原生参数透传 | 已支持 |
| 生成后强制裁切或补边 | 暂未支持 |
| 对上游返回尺寸做强校验和自动重试 | 暂未支持 |

## 排查建议

如果用户反馈分辨率或比例不符合预期，按以下顺序检查：

1. 确认模型是否为 Gemini / Nano Banana 系列。
2. 确认请求中的 `imageSize` 是否为 `1K`、`2K`、`4K` 这类大写格式。
3. 确认请求是否同时包含 `aspectRatio` 和 `size`。
4. 检查模型配置中的 `resolutions` 是否配置了对应比例和档位。
5. 如果是图生图或编辑任务，检查参考图自身比例是否与目标比例冲突。
6. 如果走聚合渠道，确认该渠道是否支持 `extra_body.google.image_config`。
7. 如果最终尺寸必须严格一致，在调用方或后处理流程中增加裁切、补边或重采样。

## 代码参考

| 文件 | 说明 |
| --- | --- |
| `lib/image-sizing.ts` | 尺寸、比例、档位标准化和像素映射 |
| `lib/image-generator.ts` | 生成请求组装，包含 OpenAI-compatible 和 Gemini 原生路径 |
| `app/api/generate/image/route.ts` | 前端图像生成请求解析 |
| `lib/v1-images.ts` | OpenAI Images 兼容请求解析 |
| `app/admin/image-channels/page.tsx` | 管理后台模型分辨率配置和 Gemini Pro 预设 |
