# Mankr Star 定稿资产

定稿：**R2 B 明显加粗，描边 36，转角 bevel**。

唯一几何来源：`apps/web/src/assets/brand-mark.json`。所有输出使用同一路径、
`viewBox="100 100 872 750"`、`fill-rule="evenodd"` 和相同颜色的填充与描边。
这份轮廓以认可的 R2 重绘，已统一几何；没有从概念图逐像素描摹。

- `logo.svg`：透明 `currentColor` 母版，无背景；自然比例 872:750。
- `logo-black.svg`、`logo-white.svg`、`logo-amber.svg`：透明黑、白、琥珀 SVG。
- `png/`：三种颜色各 256、512、1024 像素的透明正方形画布 PNG，图形等比居中。
- `app-icon.svg` / `app-icon.png`：琥珀圆角底、白色标记，PNG 为 512×512。
- Web：`apps/web/public/` 中的 favicon、192/512 PWA 图标和 180 像素 Apple 图标。
- 扩展：`apps/extension/icons/` 中灰底常态、琥珀底已收藏态，各含 16/32/48/128 PNG。

## 重复生成

在项目根目录执行：

```sh
python3 assets/brand/generate-assets.py
```

导出预览与 ZIP 时可加 `--export-dir /绝对路径/输出目录`。
脚本使用本机已有的 Python、CairoSVG 和 Pillow，不加入应用构建依赖。
图标使用 32×32 圆角底，内部 26×26 的嵌套 SVG 保留原 viewBox、等比留白。
所有图形版本共享定稿几何；不要单独修改导出的路径。
