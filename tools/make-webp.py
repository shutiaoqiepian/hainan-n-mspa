#!/usr/bin/env python3
"""
把作品墙的两档 JPG 缩略图转成同尺寸 WebP。

用法（在仓库根目录）：
    python tools/make-webp.py            # 只补缺的，已有就跳过
    python tools/make-webp.py --force    # 全部重转

输入 / 输出：
    images/thumbs/      *.jpg  →  images/thumbs-webp/      *.webp   (宽 800, q75)
    images/thumbs-400/  *.jpg  →  images/thumbs-400-webp/  *.webp   (宽 400, q78)

为什么不上 q82：这批 jpg 本身就是高强度压缩过的，q82 只能省 24%；
q75 能省 43%，暗部细节肉眼看不出差别（2026-11-29 对比过 800px 三张样片）。

新增照片的流程不变：先按 tools/make-thumb-400.ps1 出 jpg 两档，
再跑这个脚本出 WebP，最后 npm run check:webp 确认没有漏的。
"""

import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit('缺少 Pillow：python -m pip install pillow')

ROOT = Path(__file__).resolve().parent.parent
JOBS = [
    ('images/thumbs', 'images/thumbs-webp', 800, 75),
    ('images/thumbs-400', 'images/thumbs-400-webp', 400, 78),
]
FORCE = '--force' in sys.argv


def main() -> None:
    total_src = total_dst = 0
    for src_rel, dst_rel, max_w, quality in JOBS:
        src = ROOT / src_rel
        dst = ROOT / dst_rel
        if not src.is_dir():
            print(f'跳过 {src_rel}（目录不存在）')
            continue
        dst.mkdir(parents=True, exist_ok=True)

        done = skipped = 0
        size_src = size_dst = 0
        for f in sorted(os.listdir(src)):
            if not f.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            sp = src / f
            out = dst / (Path(f).stem + '.webp')
            if out.exists() and not FORCE and out.stat().st_mtime >= sp.stat().st_mtime:
                skipped += 1
                continue
            im = Image.open(sp).convert('RGB')
            if im.width > max_w:
                im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
            im.save(out, 'WEBP', quality=quality, method=6)
            done += 1
            size_src += sp.stat().st_size
            size_dst += out.stat().st_size

        print(f'{src_rel}: 转换 {done} 张，跳过 {skipped} 张'
              f'（本次 {size_src // 1024}KB → {size_dst // 1024}KB）')
        total_src += size_src
        total_dst += size_dst

    if total_src:
        print(f'合计 {total_src // 1024}KB → {total_dst // 1024}KB'
              f'，节省 {100 - total_dst * 100 // total_src}%')


if __name__ == '__main__':
    main()
