# 字体构建、发布与排障

字体准备、完整性与漏字行为只在 [asset-pipeline](../openspec/specs/asset-pipeline/spec.md) 维护。原设计稿已收敛为操作手册，保留文件名供现有构建入口引用。

## 构建

```sh
# 游戏文字或字体配方改变后重新生成core；需要基础字集时构建base
bun run fonts:core
bun run fonts:base
# 聚焦完整性、覆盖与异步文本检查
bun test scripts/ui-fonts.test.mjs scripts/ui-fonts-paged.test.mjs scripts/ui-glyph-sweep.test.mjs scripts/ui-font-revision.test.mjs
```

core从游戏源码、内容注册表与UI标点生成，随仓库发布；base按固定字集和配方生成，在 `public/fonts/gpu/base/<key>/`。core manifest固定它引用的base key，不能改成“latest”。准确字符范围、源字体、字重、字形参数、许可证和工具版本只查 [SOURCES.txt](../public/fonts/SOURCES.txt) 及manifest，不在这里手抄另一张数值表。

修改文本后先检查覆盖；不要手改atlas、metrics或manifest来绕过构建。首屏文本来源由 [first-screen-text.mjs](../scripts/fonts/first-screen-text.mjs) 维护。流水线和缓存配置只查 [部署手册](../deploy/README.md)，避免重复维护CI步骤。

## 发布与恢复

构建在临时目录完成全部页与JSON；发布锁覆盖安装、manifest替换和清理。失败不覆盖已发布集合，manifest通过rename提交。具体实现见 [publish.py](../scripts/fonts/publish.py)。

本地记录最近三次发布用于保护并行/开发构建；仓库与部署镜像只带当前core发布和当前base key。**本地保留不等于服务器保留旧版本。** 部署改变字体后，已开会话尚未获取的旧页可能404；已接受的处理是明确字体错误后重新载入，不在客户端混拼版本。不要把此限制改写成“线上永远不会缺页”。

## 定位错误

- 清单摘要、页数量、解码尺寸或页字节不匹配：检查构建是否混入另一版本、资源是否齐全、缓存是否违反内容身份。不要把完整性异常降为缺字方块。
- 部署后仅旧会话失败：核对其base key和页URL，重新载入当前清单。
- 单个字符漏收：开发日志会报告字体与码点；检查来源文本/字集及覆盖测试，再重建。用户决定允许运行时显示缺字标记而继续操作，但这不是文字完整性验收通过。
- 切页或改文本后错字/半串：查 [资源地图 F01–F10](state-machines/resources.md#f01) 的revision、页面准备与context generation，不逐页直接显露文字。

## 范围与验收

GPU没有系统字体回退。当前采用SC字体来源，部分共用汉字在繁体/日文中仍是SC地区字形；基础字符范围和地区字形选择原先为暂定，确认与小字真机检查在 [UI验收change](../openspec/changes/complete-shared-ui-acceptance/design.md) 集中维护。

未来若新增自由输入名称字段，应在该功能change中规定字符范围和拒绝行为；现有 `unsupported` 边界不是一个已经开放的命名功能，也不能据此把运行时漏收字符一律改为阻塞页面。
