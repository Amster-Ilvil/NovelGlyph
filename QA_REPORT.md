# NovelGlyph v1.2 QA / 2026-11-03

## 变更

- 保留 v1.1 手框、重合、覆盖、字位库和人工审校。新增 `hybrid.js` 与 `hybrid_ui.js`，以导入的逐字 OCR 原始像素矩形匹配字位。
- 每来源独立；同来源重复不重复计票。低 IoU/歧义配准不关联；不执行 OCR 模型、不自动给形状组批准。
- 针对 v1.1 严重风险：已批准组内一旦出现人工确认异码，整组未确认位置进入 `group_conflict_hold`。两来源高置信度共同否认已批准标签时也进入停用状态，避免 OCR 证据与人工批准互相覆盖。

## 单元验证

- 原有 `tests/test_*.cjs` 回归通过。
- `tests/test_hybrid.cjs`：单字几何、3 来源共识、同源重复、重导替换、OCR 分歧、人工异码阻断、两来源否认组标签、人工重切自动清除旧证据、保存恢复、恶意 source 输入，以及「多个 OCR 一致认错只生成建议，0 自动写回」。

## 浏览器 E2E

- `tests/browser_hybrid_e2e.py`：4 页演示扫描，三来源每来源 4 条 OCR JSON，全部坐标匹配；复核组出现但仍 `approved=false`、`draft.resolved=0`；JSON 审计导出、工作区 ZIP 导出、恢复后证据一致；页面 JS 错误 0。
- 既有 v1.1 浏览器测试仍使用原有相容模块；新功能测试使用 `hybrid.js`/`hybrid_ui.js`。

## Ground-truth fixture

| 度量 | Clean typeset 8 pages | JPEG55 degradation |
|---|---:|---:|
| Gold glyphs | 2208 | 2208 |
| Detected segments | 2314 | 2326 |
| Strict one-to-one geometry matches | 2185 | 2182 |
| One-to-one recall | 98.958% | 98.822% |
| Exact-shape groups | 127 | 1419 |
| Purity only on correctly geometry-matched glyphs | 100% | 100% |
| OCR sources | 3 simulated | 3 simulated |
| Review-only groups | 25 | 162 |
| Proposed positions with gold reference | 200 | 497 |
| Proposed labels matching gold within these subsets | 200 | 497 |

**Do not interpret these as actual Novel-formatter OCR results**. Glyphs are generated with Pillow from a single CJK font at fixed dimensions, and OCR error labels are simulated with seeded random corruption. No 407-page actual scan validation or human reviewer timing study is possible with the present fixture. Pixels covered are not text accuracy. JPEG fragmentation is an important current weakness.

## Deployment and data

- No remote imaging/telemetry/API usage added; production ZIP does not contain `original_pages/`, workspace, OCR datasets or private test results.
- Chromium browser E2E used local static injection since browser navigation to local HTTP is administratively blocked by this container. Static packaging integrity and JS syntax checked. Live GitHub Pages publication **not tested**.
