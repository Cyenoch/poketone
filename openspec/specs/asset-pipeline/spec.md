# asset-pipeline Specification

## Purpose

定义从生成源素材到游戏发布资源的来源、缓存与显示完整性契约，保证资产可以追溯，已发布内容不会混用旧版本，音频与视觉反馈保持一致时序。

## Requirements

### Requirement: 资产来源与费用可追溯

生成资产 SHALL 保留原始源、生成记录和发布对应关系；付费生成 MUST 在用户已授权范围内。游戏运行 SHALL 不调用素材生成服务。

#### Scenario: 发布优化后的模型

- **WHEN** 原始模型经处理后进入发布资源
- **THEN** 能从发布记录追溯原始来源和处理过程，旧源不因优化而丢失

### Requirement: 发布缓存身份

会变化的发布资源 SHALL 通过清单解析到内容哈希路径；固定入口和清单 MUST 不使用永久不可变缓存，避免新旧资源混用。

#### Scenario: 部署资源更新

- **WHEN** 玩家加载新版清单
- **THEN** 取得对应版本的模型、图片和字体页，不因旧固定路径缓存读取过期内容

### Requirement: 字体完整后展示

页面 SHALL 等待支持文本所需的字形页和页面资源准备完成再展示，不逐字显露或为首屏速度降低已确认的字体质量。字体页与清单不一致 MUST 明确失败；单个字符漏收 SHALL 保持页面可操作并显示缺字标记，开发诊断须可定位，但缺字页面 MUST NOT 被记作完整文字验收通过。

#### Scenario: 动态中文名称需要额外字形页

- **WHEN** 页面包含支持字集内尚未驻留的字符
- **THEN** 按需准备对应字形页，显示完整文本后再交给用户操作

#### Scenario: 文本在加载期间被替换

- **WHEN** 旧文本的字形页晚于新文本准备完成
- **THEN** 不显示半串文字，也不让旧文本的完成结果覆盖当前页面

#### Scenario: 字符漏收但资源有效

- **WHEN** 页面文本包含图集中未收录的字符，而清单和页数据有效
- **THEN** 显示缺字标记并继续操作，开发环境报告字符位置，验收记录此缺口；不把它当作损坏字体导致的整页失败

#### Scenario: 部署后旧页面请求不存在的字体页

- **WHEN** 已打开的会话仍引用旧发布且其未加载字形页已不在服务器上
- **THEN** 明确报告资源失败，重新加载取得新发布，不拼接不匹配的字体版本

### Requirement: 声画时序与发布音源

正式音频 SHALL 经项目母带处理和发布选择，菜单、UI 与对局共用混音；音效重音 SHALL 对齐其效果关键帧，不早于效果开始或晚于效果结束。

#### Scenario: 播放技能反馈

- **WHEN** 技能进入对应视觉关键帧
- **THEN** 使用发布音源及其时序数据播放对应反馈，遵循混音优先级

## References

- [src/prepare](../../../src/prepare)
- [scripts/web-build.mjs](../../../scripts/web-build.mjs)
- [docs/fonts-paging-design.md](../../../docs/fonts-paging-design.md)
- [docs/AUDIO.md](../../../docs/AUDIO.md)
- [docs/state-machines/resources.md](../../../docs/state-machines/resources.md)

规范定义行为契约；文档导航见 [文档入口](../../../docs/README.md)。规范同步和格式校验不表示所有场景已经通过验收。
