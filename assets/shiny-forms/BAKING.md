# 异色底色烘焙

在已安装项目依赖的仓库根目录运行，最后一个参数为输出目录。

```sh
python3 assets/shiny-forms/bake-base-color.py "${TMPDIR%/}/opencode/shiny-bake-repro"
```

复现环境为 Apple Silicon macOS、Bun 1.4.4、Blender 5.3.0（构建 `02f0899d78e3`，内置 NumPy 2.3.4）、Python 3.15.2、NumPy 2.5.4 和 Pillow 13.0.0。文件 SHA 受编码器影响，本环境使用 libwebp 1.6.0、libjpeg-turbo 3.2.0 和 zlib-ng 2.3.3。

入口读取 `texture-recipes.json` 的 `forms`，通过 Bun 从 `src/run/view/shiny.ts` 导出正式的 `shinyPalettes`。Blender 从每个 `public/models/<form>.glb` 提取静止网格世界坐标、原 UV 和内嵌底图。烘焙使用 sRGB 原图。侧视沿 −Y 方向，世界 X 朝右、Z 朝上，画幅 448 像素，取景宽度为最大投影边长的 1.12 倍。UV 遮罩向未占用区域外扩 3 个纹素。提取数据在输出目录内临时生成，退出时自动清理。安装依赖后可离线执行。

`spatial_bake.py` 对八种伙伴的底图与头像使用相同的局部配色规则。鬼斯通与快龙在共享配色上处理口腔与皮肤，哈克龙采用共享表的身体交换，再对颈珠与尾珠作局部处理。小拳石与隆隆石的眼区在底图上由侧视投影，在立绘上使用各自的多边形。其余部位按源图色相、饱和度和明度选区。每个区域的 `tones` 记录目标 HSV 及两份原图的亮度基准。`modelTexel` 为原底图像素，`portraitPixel300` 与 `homePixel300` 按 300 像素方图标注，换算到原尺寸后向下取整。HOME 参考版本和来源见 `provenance.json`。哈克龙两组珠子共用依颈珠样点微调的浅橙色。眼区多边形与宝珠椭圆来自普通伙伴的 448 像素侧视和 320 像素头像，椭圆依次记录中心与两轴半径。

每个形态输出 `candidates/<form>-baseColor.png`，与生产底图同尺寸。替换时沿用原采样器与 `TEXCOORD_0`，按 sRGB 读取并沿用 glTF 方向。`forms` 中标记 `bakedPortrait: true` 的形态还输出 `candidates/<form>-portrait.webp`，以 320×320 无损 WebP 保存原头像的透明通道。原火系和水系五种形态继续由 TypeScript 生成头像。

将烘焙输出目录作为 `scripts/shiny-portraits.mjs` 的第二个位置参数。同级 `verification.json` 按形态记录 `modelSha256` 与 `candidateSha256`，对应生产 GLB 和输出 PNG。带烘焙头像的形态同时记录 `portraitSourceSha256` 与 `portraitSha256`，对应普通 WebP 和输出 WebP。
