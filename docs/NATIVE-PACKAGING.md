# Native standalone packaging

当前构建目标仅为 **macOS arm64**。`Poketone.app/Contents/MacOS/poketone` 是 Bun 1.4.4 `--compile` 生成的真实 Mach-O 可执行文件，应用代码与 Bun runtime 在其中。运行不调用 Bun、shell launcher 或仓库脚本，不启动 Web 服务，不依赖工作目录。

```sh
# 构建机器：Bun 1.4.4、已安装的项目依赖、Xcode Command Line Tools、当前 manifest 指定的字体 base 集
bun scripts/native-build.mjs --output /tmp/poketone-release/Poketone.app
bun test scripts/native-packaging.test.mjs

# 整个 .app 可以搬动；已有输出目录会报错，不覆盖已有发布件
mv /tmp/poketone-release/Poketone.app '/tmp/Poketone relocated.app'
cd /
'/tmp/Poketone relocated.app/Contents/MacOS/poketone' \
  --save /tmp/poketone-test/save.v3.txt \
  --harbor ws://127.0.0.1:8787/multiplayer
```

默认输出 `dist/native/Poketone.app`（在既有 dist 忽略规则内）。`bun run native` 仍为仓库开发入口，默认连接本机 8787；父任务在 package.json 接入独立构建命令。打包默认 Harbor 为 `wss://poketone.bingzi.dev/multiplayer`，来自 [生产部署](../deploy/README.md) 已记录的玩家入口；没有猜测新服务或使用仅供源站的 Harbor origin。参数 `--harbor` 可覆盖，`--save` 沿用原入口语义；默认存档 `~/.poketone/save.v3.txt`，不写进应用包。

2026-11-08 的存档修复沿用 progress v4 / 外壳 v3，移除旧格式迁移；默认目录仅有旧 `save.txt` 时拒绝启动并保留原文件。路径覆盖与排查见 [运行手册](NATIVE-RUNTIME.md#存档排查)。下方包体和启动结果均为 2026-11-07 历史证据；本次文档更新未重建独立包。

## 资源和依赖契约

- 资源由 `process.execPath` 解析到 `../Resources/public/`；当前 `public/` 资源完整复制，字体 base 仅带 core manifest 指定的一版。构建前、复制后校验 core/base 的字体 JSON 和每页 SHA-256；缺失或损坏直接失败，不静默跳过字体。
- Web/native 继续共用 `scripts/game-build.ts` 的模拟内容指纹。`Resources/build.json` 记录该值、Bun 版本、Harbor、base key 和实际依赖包版本。这里不改变 Web 构建脚本、5173/8787 或模型版本规则。
- `Resources/runtime/node_modules` 来自 native 生产构建的真实外部 imports，再递归收集已安装包的 dependencies、peerDependencies 和当前主机可用的 optionalDependencies。每个真实版本独立保存，依赖边用包内相对符号链接连接；没有固定 SDL/sharp/WebRTC 包名列表，不拉入项目 devDependencies 列表。包本身完整复制，保留原生 addon、相邻 dylib、WASM、许可证和运行时文件。整包搬动要保留符号链接；建议 Finder 或 `ditto`。
- 编译后的外部 import 经 `Bun.resolveSync` 从上述 runtime 目录解析，保留 ESM export conditions。不可改为 `createRequire.resolve`，它会选择 Three 的 CJS 入口，造成双实现。Bun compile 必须启用 `--compile-autoload-package-json` 才能解析这些磁盘包的 exports/main；dotenv、bunfig、tsconfig 自动加载关闭。
- `scripts/native-platform-build.mjs` 的 `buildNativePlatform(outputDir)` 由父任务提供。开发调用后把绝对 `NATIVE_PLATFORM_LIBRARY` 注入；打包调用到 `Resources/native/`，注入 `../Resources/native/libpoketone-platform.dylib`。FFI 模块对 `process.execPath` 解析该相对路径。此处不复制或替代 AppKit 文件选择实现。
- `Resources/runtime/application.mjs` 保留完整编译输入，用于重建/relink Bun/JSC；它不是启动时运行的 launcher。构建没有网络安装步骤，使用已安装的依赖及资源。

## 许可证、签名和分发

依赖包内的 LICENSE/COPYING/NOTICE/README 均保留。补充 Bun、SDL、ANGLE、Yoga、webgl-node、data-uri-to-buffer、libvips notices 来自 [scripts/native/licenses](../scripts/native/licenses/README.md)，字体与美术 provenance 在 public 中。`native-gles@0.7.1` 的 npm 包和上游 tag 声明 MIT 但没有 copyright/license 正文；现保留其作者、声明和 source，附通用 MIT 文本并明确记录缺口，正式公开发布前需补上游通知。此产物没有声称完成完整第三方版权审计。

没有使用 Developer ID 凭据、上传、公证或改变本机 Gatekeeper。Bun 编译文件具有本地 ad-hoc 签名，`.app` 本身未做发布签名。面向其他 Mac 的正式分发还需要维护者的 Developer ID Application 证书/私钥、Team ID 和 notarization 凭据。应先签嵌套 Mach-O addon/dylib，再签 runtime 可执行文件和外层 `.app`，验证签名，然后按 Apple 流程提交、公证、staple；Bun/JSC 的 hardened-runtime/JIT 权限及第三方库签名必须在实际分发包上验证，不能用本机未隔离启动代替。这里不提供未经验证的签名脚本或声称 Gatekeeper 可通过。

Bun 官方依据：[Standalone executables](https://bun.com/docs/bundler/executables)；构建 API/compile 与签名资料通过官方 Bun 文档核对。只支持当前主机构建；没有 Windows/Linux/x64 或最低系统版本的测试结论。

## 2026-11-07 实测

- `bun test scripts/native-packaging.test.mjs`：3/3，退出 0。保护冲突版本依赖边/原生邻接文件、实际编译程序搬到带空格路径后在干净环境启动并选 ESM exports、缺失/损坏字体拒绝打包。
- `bun scripts/native-build.mjs --output /tmp/poketone-package-esm/Poketone.app`：退出 0，34 个生产依赖，约 467 MiB。随后整个包移动到 `/tmp/poketone standalone final/Poketone.app`，原构建位置消失。
- cwd `/`，`env -i HOME=/tmp/poketone-packaged-home PATH=/usr/bin:/bin` 启动实际二进制，传入独立 `--save` 和 `--harbor`。没有 Bun PATH、仓库 cwd 或外部 Web server。CUA 实际检查 SDL 窗口：正式大厅、小火龙模型/肖像、背景、中文与控件均呈现。SIGTERM 正常退出 0。
- 启动日志包含已知 `KHR_parallel_shader_compile extension not supported`；还出现一次 macOS `sandbox_extension_issue_file_to_process ... Operation not permitted`，未阻止窗口启动。不隐去这些日志。
- 实测候选包含 AppKit dylib，但早于父任务把文件选择、WebRTC 接入最终应用。本次不把“能启动”当成文件选择、联机、游戏生命周期、音频听感或视觉保真完整验收；父任务需在最终集成后重建并做自己的 native smoke。
- `otool -L` 检查当前 arm64 addon/shared libraries：SDL、ANGLE、libvips 依赖为随包 `@rpath` 或系统库。node-web-audio-api 和自建 dylib 中的构建路径是 `LC_ID_DYLIB` 自身标识，不是需要从构建机加载的外部依赖；启动已验证这些路径不阻碍重定位。

尚未验证 Finder 双击、Gatekeeper quarantine、Developer ID/公证、干净的第二台 Mac，以及未来新增 native 包的真实加载。新增包会随依赖图收集，但仍必须在最终产物上加载验证；编译成功从来不等于 addon/dependency 分发成功。

补充交付构建：最终脚本（含静态和动态 import 发现、完整补充 notices）在 `/tmp/poketone-package-delivery/Poketone.app` 构建退出 0，再移动至 `/tmp/poketone delivery relocated/Poketone.app`。该构建的 `gameBuild` 为 `0b055e7593b0b5c2`；并行模拟改动令指纹与较早可见启动候选不同。以干净环境从 `/` 运行 `--unknown-packaging-probe`，成功加载实际入口和外部依赖后按预期报 `ERR_PARSE_ARGS_UNKNOWN_OPTION`、退出 1；这是参数失败验证，不是本版 GPU 复验。较早通过可见大厅的包仍保留在 `/tmp/poketone standalone final/Poketone.app`。开发入口同样通过编译并对该未知参数退出 1。`plutil -lint`、Mach-O arm64 检查、局部 lint/format 均成功。未重跑父任务负责的全仓测试。
