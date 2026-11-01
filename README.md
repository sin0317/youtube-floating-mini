# YouTube 悬浮小窗播放器

> YouTube 视频滚出视口时自动弹出可拖拽/可缩放的悬浮小窗播放器。完全自包含的 Tampermonkey/Violentmonkey 用户脚本，无外部 CDN 依赖，无须额外脚本。

## 功能

- 📺 **自动弹出**：视频滚出视口后，自动在右下角弹出悬浮小窗（可关闭）
- 🖱️ **拖拽移动**：按住小窗顶栏任意空白处拖动
- 📐 **拖拽缩放**：右下角斜杠手柄可调尺寸
- 🧲 **自动贴边**：松手时若距屏幕边缘 < 16px，自动吸附到最近边
- 🎯 **一键开关**：YouTube 播放器控制栏新增「小窗」按钮（点击弹出/收回）
- ⏯️ **双击暂停**：双击小窗主体暂停/播放
- ↩️ **返回 / ✕ 关闭**：顶栏按钮控制，关闭后本次滚回视口前不再自动弹出
- 💾 **状态记忆**：尺寸、位置、开关状态全部跨会话保存
- 🔄 **SPA 兼容**：切视频时自动重绑定，不掉帧、不中断

## 安装

1. 装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 打开仓库里的 [`youtube-floating-mini.user.js`](./youtube-floating-mini.user.js)
3. 把整个文件拖进扩展页面，或复制源码粘贴到「添加新脚本」里保存
4. 打开任意 [YouTube 视频页](https://www.youtube.com/watch?v=dQw4w9WgXcQ)，往下滚即可

> 也支持 `music.youtube.com` 和 `m.youtube.com`。

## 菜单命令

插件面板菜单提供四项配置：

| 命令 | 作用 |
|---|---|
| YouTube 小窗：已启用 / 已停用 | 总开关 |
| 滚动自动弹出：开 / 关 | 关闭后仅保留「控制栏按钮」手动弹出 |
| 设置小窗尺寸 (宽x高) | 输入如 `480x270`，刷新生效 |
| 重置小窗位置 | 清空自定义位置，回到右下角默认 |

## 设计要点

- **自包含**：不依赖任何其他用户脚本，不引入外部 JS 库
- **原生交互**：拖拽 / 缩放全部用浏览器原生 Pointer Events API
- **零侵入**：不动 `#movie_player` 之外的结构，只在 `.ytp-right-controls` 注入一个按钮
- **数据安全**：通过 `Element.insertBefore` 移动真实的 `.html5-video-container`，不重建 `<video>`，所以**进度、音轨、字幕、画质**全部不丢

## 对比原版

原版的痛点：

| 原版 | 新版 |
|---|---|
| 必须安装另一个「网页全屏」脚本才跑得起来 | 完全自包含 |
| 从 unpkg CDN 拉 `draggable` 库，断网即失效 | 零外部依赖 |
| 依赖较新的 `Element.moveBefore`，老浏览器不工作 | 标准 `insertBefore` |
| 全站通用、规则容易误触 | 只针对 YouTube |

## 兼容性

- ✅ Chrome / Edge / Firefox / Brave 等现代浏览器
- ✅ YouTube 主站 / YouTube Music / 移动端网页
- ⚠️ 嵌入页 (`youtube.com/embed/...`) 默认未启用，可自行加 `@match`

## 开发 / 自定义

所有配置通过 `GM_getValue`/`GM_setValue` 持久化，键前缀 `YT_MINI_`：

```
YT_MINI_enabled  : 总开关（true/false）
YT_MINI_auto     : 自动弹出（true/false）
YT_MINI_w        : 宽度（像素）
YT_MINI_h        : 高度（像素）
YT_MINI_pos      : 位置 {x, y}
```

## 许可

MIT — 见 [LICENSE](./LICENSE)。