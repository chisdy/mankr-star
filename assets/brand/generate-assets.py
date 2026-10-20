#!/usr/bin/env python3
"""Render release logo assets from apps/web/src/assets/brand-mark.json.

Requires the locally available cairosvg and Pillow packages; it adds no app dependency.
Run from any directory. Pass --export-dir to create a preview and a ZIP package.
"""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import zipfile

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'assets/brand'
SOURCE = ROOT / 'apps/web/src/assets/brand-mark.json'
AMBER = '#d97706'
GRAY = '#737373'
COLORS = {'black': '#000000', 'white': '#ffffff', 'amber': AMBER}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-dir', type=Path)
    args = parser.parse_args()
    mark = json.loads(SOURCE.read_text())
    assert mark['viewBox'] == '100 100 872 750'
    assert mark['strokeWidth'] == 36 and mark['strokeLinejoin'] == 'bevel'
    outputs: list[Path] = []

    def write(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        outputs.append(path)

    def path_element() -> str:
        return (f'<path d="{html.escape(mark["path"], quote=True)}" '
                f'fill="currentColor" fill-rule="evenodd" stroke="currentColor" '
                f'stroke-width="{mark["strokeWidth"]}" '
                f'stroke-linejoin="{mark["strokeLinejoin"]}"/>')

    def transparent(color: str | None = None) -> str:
        color_attribute = f' color="{color}"' if color else ''
        return (f'<svg xmlns="http://www.w3.org/2000/svg" '
                f'viewBox="{mark["viewBox"]}" preserveAspectRatio="xMidYMid meet"'
                f'{color_attribute} role="img" aria-labelledby="brand-title">\n'
                f'  <title id="brand-title">Mankr Star</title>\n'
                f'  {path_element()}\n</svg>\n')

    def application(background: str) -> str:
        return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" '
                'color="#ffffff" role="img" aria-labelledby="brand-title">\n'
                '  <title id="brand-title">Mankr Star</title>\n'
                f'  <rect width="32" height="32" rx="8" fill="{background}"/>\n'
                f'  <svg x="3" y="3" width="26" height="26" '
                f'viewBox="{mark["viewBox"]}" preserveAspectRatio="xMidYMid meet">\n'
                f'    {path_element()}\n  </svg>\n</svg>\n')

    def png(svg: str, path: Path, size: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(path),
                        output_width=size, output_height=size)
        outputs.append(path)

    master = transparent()
    app = application(AMBER)
    gray = application(GRAY)
    write(ROOT / 'apps/web/public/logo.svg', master)
    write(ROOT / 'apps/web/public/favicon.svg', app)
    for size in (192, 512):
        png(app, ROOT / f'apps/web/public/icon-{size}.png', size)
    png(app, ROOT / 'apps/web/public/apple-touch-icon.png', 180)

    manifest_path = ROOT / 'apps/web/public/manifest.webmanifest'
    manifest = json.loads(manifest_path.read_text())
    manifest['icons'] = [icon for icon in manifest.get('icons', [])
                         if icon.get('src') not in ('/icon-192.png', '/icon-512.png')]
    manifest['icons'].extend({'src': f'/icon-{size}.png', 'sizes': f'{size}x{size}',
                              'type': 'image/png', 'purpose': 'any'}
                             for size in (192, 512))
    write(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    index_path = ROOT / 'apps/web/index.html'
    index = index_path.read_text()
    if 'rel="apple-touch-icon"' not in index:
        index = index.replace('    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
                              '    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n'
                              '    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />', 1)
        index_path.write_text(index)

    for state, svg in (('icon', gray), ('icon-saved', app)):
        write(ROOT / f'apps/extension/icons/{state}.svg', svg)
        for size in (16, 32, 48, 128):
            png(svg, ROOT / f'apps/extension/icons/{state}-{size}.png', size)

    write(BRAND / 'logo.svg', master)
    write(BRAND / 'app-icon.svg', app)
    for name, color in COLORS.items():
        svg = transparent(color)
        write(BRAND / f'logo-{name}.svg', svg)
        for size in (256, 512, 1024):
            png(svg, BRAND / f'png/logo-{name}-{size}.png', size)
    png(app, BRAND / 'app-icon.png', 512)
    write(BRAND / 'README.md', '''# Mankr Star 定稿资产

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
''')

    if args.export_dir:
        export = args.export_dir.resolve()
        export.mkdir(parents=True, exist_ok=True)
        preview = Image.new('RGB', (1600, 1040), '#f7f5ef')
        draw = ImageDraw.Draw(preview)
        font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
        try:
            title_font = ImageFont.truetype(font_path, 40)
            label_font = ImageFont.truetype(font_path, 21)
            small_font = ImageFont.truetype(font_path, 17)
        except OSError:
            title_font = label_font = small_font = ImageFont.load_default()
        draw.text((64, 42), 'Mankr Star', font=title_font, fill='#24221e')
        draw.text((66, 100), 'R2 B  /  Final logo  /  Bold weight', font=label_font, fill='#786f62')
        for i, (name, label, background) in enumerate((
                ('black', 'Black / transparent', '#fffdf8'),
                ('white', 'White / transparent', '#24221e'),
                ('amber', 'Amber / transparent', '#fff9ef'))):
            x = 64 + 496 * i
            draw.rounded_rectangle((x, 162, x + 480, 532), radius=16, fill=background)
            logo = Image.open(BRAND / f'png/logo-{name}-256.png').convert('RGBA')
            preview.paste(logo, (x + 112, 190), logo)
            draw.text((x + 26, 485), label, font=small_font,
                      fill='#d8d0c4' if name == 'white' else '#786f62')
        draw.text((66, 588), 'Application icons', font=label_font, fill='#24221e')
        app_preview = Image.open(BRAND / 'app-icon.png').convert('RGBA')
        app_preview = app_preview.resize((256, 256), Image.Resampling.LANCZOS)
        preview.paste(app_preview, (80, 658), app_preview)
        draw.text((80, 942), 'Web / PWA / Apple', font=small_font, fill='#786f62')
        for state, x, label in (('icon', 570, 'Extension / default'),
                                 ('icon-saved', 1060, 'Extension / saved')):
            icon = Image.open(ROOT / f'apps/extension/icons/{state}-128.png').convert('RGBA')
            preview.paste(icon, (x, 694), icon)
            for i, size in enumerate((16, 32, 48)):
                small = Image.open(ROOT / f'apps/extension/icons/{state}-{size}.png').convert('RGBA')
                preview.paste(small, (x + i * 72, 858 + (48 - size) // 2), small)
                draw.text((x + i * 72, 917), str(size) + 'px', font=small_font, fill='#786f62')
            draw.text((x, 978), label, font=small_font, fill='#786f62')
        preview_path = export / 'mankr-star-final-preview.png'
        preview.save(preview_path)
        archive_path = export / 'mankr-star-logo-final.zip'
        package_files = set(outputs) | {Path(__file__).resolve(), SOURCE}
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(package_files):
                archive.write(path, path.relative_to(ROOT))
            archive.write(preview_path, 'preview.png')
        print('Preview:', preview_path)
        print('ZIP:', archive_path)
    print(f'Generated {len(outputs)} static assets from {SOURCE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
