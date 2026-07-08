# 手机端二维码尺寸不生效 - 调试记录

## 现象
- 桌面端：所有尺寸/间距修改正常生效
- 手机端：间距修改生效，但图片尺寸从未变化（从 100px → 120px → 240px 都没反应）

## 已尝试的方案（共 5 种）

| # | 方案 | 效果(桌面) | 效果(手机) |
|---|------|-----------|-----------|
| 1 | Tailwind `className="w-[120px] h-[120px]"` | ✅ | ❌ |
| 2 | 内联 `style={{ width: 120, height: 120 }}` | ✅ | ❌ |
| 3 | 内联 `style={{ width: 240, height: 240 }}` | ✅ | ❌ |
| 4 | CSS 类 `.qr-code-img { width: 240px !important }` | ✅ | ❌ |
| 5 | JSX `<style>` 标签内联 `!important` | ✅ | ❌ |

## 排查结论
- 所有 CSS 方案（Tailwind/内联style/独立CSS/JSX内联style）桌面端有效、手机端无效
- 间距 `marginRight` 使用内联 style 手机端有效，说明 style 属性本身没有被忽略
- `rm -rf dist` 重建、无痕模式均无效
- **可能原因**：手机端有某种机制阻止了 img 元素的宽高样式生效（如 CSP、图片服务端根据 UA 返回不同尺寸、或浏览器对 object-contain 的特殊处理）
