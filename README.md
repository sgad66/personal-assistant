# AI 日程助手

一个本地优先的 AI 日程桌面应用：用一句话、一段语音或一张截图录入事项，自动解析时间、地点和备注，生成周日程，并在事项开始前 10 分钟提醒。

应用基于 Electron + React + TypeScript 构建，数据默认保存在本机，不依赖云端账户。

## 功能

- **多模态录入**：文字、语音、图片通知截图
- **对话式安排**：补全缺失信息、候选事项勾选、时间冲突确认
- **周日程**：时间轴 / 列表 / 概览三种视图
- **冲突分组卡**：重叠事项合并展示，逐条可打开详情，不遮挡、不挤压
- **DIY 看板**：今日节奏、今日安排、本周概览、空档建议、模板、打卡、专注计时等组件，可增删、拖动排序、调整宽窄
- **布局预设**：日常 / 工作 / 生活 / 极简
- **提醒**：事项开始前 10 分钟提醒，支持稍后提醒与忽略
- **托盘常驻**：可设置关闭窗口时最小化到系统托盘
- **小窗模式**：右下角悬浮小窗，显示下一项安排，一键恢复主窗口
- **AI 服务配置**：文本、视觉、语音可分别接入不同服务商；默认文本使用本地规则解析
- **本地优先**：日程数据保存在本机，API Key 使用 Electron safeStorage 加密

## 技术栈

- Electron 33
- React 18 + TypeScript
- Zustand
- Zod
- electron-vite
- Vitest（单元/集成测试）
- Playwright（桌面端手动验证/端到端测试基础）

## 环境要求

- Node.js 22+
- npm 10+
- Windows 10 / 11（当前主要开发与打包目标）

## 快速开始

```bash
npm install
npm run dev
```

如果终端环境预设了 `ELECTRON_RUN_AS_NODE=1`，Electron 会以纯 Node 模式启动并报错。启动桌面窗口前需要清除该变量：

```bash
unset ELECTRON_RUN_AS_NODE
npm run dev
```

## 构建与测试

```bash
npm run typecheck   # TypeScript 类型检查
npm test            # Vitest 单元 + 集成测试
npm run build       # 构建 main / preload / renderer
npm run package     # 打包 Windows 安装程序（输出到 release/）
```

覆盖率与监听模式：

```bash
npm run test:cov
npm run test:watch
```

## 使用方式

### 今日

轻量入口：问候、今日概览、快捷录入。输入一句“明天下午三点开项目周会”，直接回车即可开始解析。

### 智能体

查看完整对话、附件、候选事项、冲突决策与会话历史。支持补充信息、重新描述、重试上一条。

### 看板

工作与生活组件的自由组合：

- 编辑模式支持拖动排序、宽/窄切换、隐藏、组件库添加
- 预设：日常 / 工作 / 生活 / 极简
- 布局保存在本机

### 本周

右上角可切换：

- **时间轴**：按小时查看时间分布与冲突
- **列表**：按天扫读
- **概览**：每天一张摘要卡

重叠事项会合并成一张“时间重叠 · N 项”的冲突分组卡，逐条点击进入详情。

### 设置

左下角 AI 状态卡打开设置：

- 文本 / 视觉 / 语音连接配置
- API Key 管理
- **桌面行为：关闭窗口时最小化到托盘**（默认开启）

### 托盘与小窗

- 关闭窗口（默认）→ 隐藏到系统托盘
- 托盘菜单：打开主窗口 / 小窗模式 / 退出
- 小窗模式：右下角悬浮窗口，显示时间、今日项数与下一项安排
- 侧栏“小窗模式”可直接打开

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + 1` | 今日 |
| `Ctrl + 2` | 智能体 |
| `Ctrl + 3` | 本周 |
| `Ctrl + 4` | 看板 |
| `Ctrl + K` | 智能体 |
| `Ctrl + ,` | 设置 |

## AI 配置说明

- 默认 `text` 通道使用本地规则解析，不需要 API Key
- 语音与图片识别需要在设置中接入支持的服务商
- 文本、视觉、语音可分别绑定不同服务商
- Key 会优先使用 Electron safeStorage 加密保存；降级时仅写入本机用户数据目录
- 语音/图片临时文件仅用于解析，解析后会清理

## 数据与隐私

- 日程数据保存在 Electron 的 `userData` 目录
- 语音、图片只在解析时使用
- 不配置 AI 服务时，除本地规则解析外不会联网
- 应用不包含账号体系，不会上传日程到自建服务器

## 项目结构

```text
src/
  main/                 Electron 主进程
    ai/                 AI Provider、连接配置、凭证
    schedule/           日程服务
    reminder/           提醒调度
    storage/            本地数据存储
    ipc/                IPC handler
  preload/              安全 bridge
  renderer/             React 前端
    pages/              今日 / 看板 / 智能体 / 本周
    components/         页面组件、看板组件、周视图组件
    stores/             Zustand 状态
    styles/             主题与布局
  shared/               共享类型、IPC 契约、时间解析
tests/
  unit/                 单元测试
  integration/          集成测试
```

## 开发说明

- `package.json` 中的 `overrides.esbuild = 0.25.12` 用于兼容部分 Windows 环境（旧版 esbuild 二进制可能无法执行）
- `.npmrc` 配置了 Electron 下载镜像，网络受限环境可保留；网络正常时可按需调整
- 新增逻辑请补充对应测试，提交前至少运行 `typecheck`、`test`、`build`

## License

MIT