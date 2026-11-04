# NovelGlyph

**[打开网页版](https://amster-ilvil.github.io/NovelGlyph/)** · [GitHub 源码](https://github.com/Amster-Ilvil/NovelGlyph)

轻量级日文扫描书**字形归组与人工审校工具**。直接在浏览器中处理扫描图片，无需安装软件或 OCR 模型。

## 主要功能

- 导入 PNG、JPG、WebP、图片文件夹或 ZIP/CBZ 扫描书。
- 自动检测竖排文字列、发现候选字位，跨页查找相同字形。
- 手动框选、切分／合并、确认单字，并检查 Ruby、标点和漏切区域。
- 可导入带**逐字原图坐标**的 OCR JSON，交叉核对多个来源；OCR 建议不会自动变成人工确认。
- 导出文字草稿、审核数据和完整工作区 ZIP，下次可恢复继续处理。

## 快速开始

1. 打开 **[NovelGlyph 网页版](https://amster-ilvil.github.io/NovelGlyph/)**。
2. 上传扫描书 ZIP/图片，进入「全书字位库」，运行字位发现；或选择「恢复已有工作区 ZIP」直接加载进度。
3. 选中候选字形，对照原图人工确认或修正切分。未知字符保留占位符。
4. 使用「保存工作区」备份进度，或导出 TXT／JSON 草稿。

> 注意：本项目是审校原型，不保证自动切字和文字识别准确。网页**不会运行** Hayai、NDLOCR-Lite、48px 等 OCR 模型；导入 OCR 时需要每个字符的文本及原图像素坐标。

## 本地数据与清理

书页和工作区在当前网页内存中处理，不会自动上传到服务器或永久保存；关闭页面或点击「清空当前项目」可释放当前项目数据。浏览器可能缓存网站脚本和演示素材。

演示样本的人工审核记录会保存在浏览器 `localStorage` 的 `novelglyph-demo-decisions-v01` 项中。需要清除时，可在浏览器开发者工具的 **Application → Local Storage** 删除该项；`清空当前项目` 不会删除它。清除整个 `amster-ilvil.github.io` 域名的网站数据也会影响该域名下的其他应用。

手动导出的 ZIP／JSON／TXT 保存在电脑上，需自行删除。公开 GitHub 仓库不包含用户的扫描书和私人工作区。
