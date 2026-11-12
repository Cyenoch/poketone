# Proposal

## Why

共享 GPU UI 与 native 应用已经落地，也有 2026-11-07 用户验收，但历史迁移文档尚未给出覆盖当前版本的最终验收结论。需要归并既有证据、补上实际缺口，而不是重新迁移已完成界面。

## What Changes

- 明确正式页面的视觉、动态、输入和宿主生命周期验收边界。
- 复用对应机制未改变的旧证据；补验当前页面差异、真实手机/手柄和集成树。
- 将完成结果写入本change；实际未测的设备保留未完成。

本次文档整理只登记这项剩余工作，不执行设备测试，不重新设计页面。WAN、完整自然通关、发行签名/公证不属于该 change。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `gpu-presentation`: 补充完成迁移时必须交付的正式页面与设备验收证据。

## Impact

主要是本change的规范/任务；验收发现真实问题时再按现有 GPU / platform 边界修复。保持玩法和 golden，不因补验擅自改变数值或视觉。
