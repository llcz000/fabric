# 单据预览布局分析文档

## 布局层级结构

```
<div className="preview-wrapper max-w-[960px] mx-auto overflow-hidden"> ← 外层容器
  <div ref={printRef} className="print-container p-4 sm:p-6 space-y-1.5"> ← 打印区域
    │  space-y-1.5: 所有子元素之间垂直间距 6px
    │
    ├── Block 1: <div className="space-y-0.5"> 头部(Logo+公司名+元数据)
    │
    ├── Block 2: <div className="overflow-hidden"> 表格
    │
    ├── Block 3: <div className="bg-slate-50/80..."> 备注条款
    │
    └── Block 4: <div className="signature-section flex flex-col sm:flex-row
                   justify-between items-start gap-2 pt-5
                   border-t border-dashed border-slate-400">
         │  ┌──────────────────────────────────────────────────────┐
         │  │                   虚线 (border-t)                     │
         │  │  pt-5: padding-top: 20px (内容→虚线距离)              │
         │  ├──────────────────────────────────────────────────────┤
         │  │                                                      │
         │  ├── 签字文字区 (flex-wrap, gap-x-8, gap-y-4)           │
         │  │    开单人签字 / 收货人签字 / 电话                      │
         │  │                                                      │
         │  └── 二维码区 (flex, ml-auto, marginTop: -20)           │
         │       微信收款码 / 支付宝收款码                           │
         └──────────────────────────────────────────────────────────┘
```

## 手机端 vs 桌面端关键属性对比

| 属性 | 桌面端 (sm: ≥640px) | 手机端 (<640px) |
|------|---------------------|------------------|
| flex-direction | `flex-row` | `flex-col` (默认) |
| justify-between | 水平推开签字区和QR | **垂直推开签字区和QR** ← 问题！ |
| gap-2 | 水平间距 8px | **垂直间距 8px** ← 增加额外间距 |
| items-start | 顶部对齐 | 顶部对齐 |
| pt-5 | 虚线→内容 20px | 虚线→内容 20px |
| QR marginTop | -20px | -20px |

## 问题根因分析

### 1. `justify-between` — 手机端罪魁祸首

- **桌面端 (flex-row)**：`justify-between` 把签字区推到左侧，二维码推到右侧。正确！
- **手机端 (flex-col)**：`justify-between` 把签字区推到顶部，**二维码推到底部**。如果容器高度 > 内容高度，二维码会被推得很远。

### 2. `gap-2` — 手机端增加额外垂直间距

- **桌面端 (flex-row)**：两个孩子之间水平间距 8px。没有问题！
- **手机端 (flex-col)**：两个孩子之间**垂直间距 8px**。虚线到二维码 = pt-5 (20px) + 签字区内容高度 + gap-2 (8px) + QR marginTop(-20px)

### 3. `pt-5` + QR `marginTop: -20` — 互相抵消但只对 QR 有效

- `pt-5`(20px) 对**所有子元素**生效：签字区和 QR 都被推下 20px
- QR `marginTop: -20` 只拉回 QR：QR 抵消了 20px，但签字区还是被推下 20px
- **结论**：虚线到 QR 的距离 = 20 - 20 = 0（理论），但 `justify-between` 和 `gap-2` 捣乱

### 4. 手机端虚线→QR 实际间距计算

```
虚线位置
  │
  ├─ pt-5 (20px padding)
  │
  ├─ 签字文字区 (高度 = 内容+折行)
  │
  ├─ gap-2 (8px flex间隙)
  │
  ├─ QR marginTop: -20 (上拉20px)
  │
  └─ QR 实际位置：取决于 justify-between 怎么分配空间
     - 如果容器高度刚好等于内容：QR紧贴签字区下方
     - 如果容器高度 > 内容：justify-between 把QR推到底
```

## 修复方案

### 方案 A（推荐）：手机端去掉 justify-between 和 gap-2

```diff
- flex flex-col sm:flex-row justify-between items-start gap-2 pt-5
+ flex flex-col sm:flex-row sm:justify-between items-start sm:gap-2 pt-5
```

即将 `justify-between → sm:justify-between`、`gap-2 → sm:gap-2`。

效果：
- 桌面端：不变
- 手机端：签字区和QR自然堆叠，间距 = pt-5(padding) + QR marginTop

### 方案 B：用 order 调换顺序

给QR加 `order-first sm:order-none`，手机端QR出现在签字区上方（紧贴虚线）。

```diff
- <div className="flex items-center ml-auto" style={{ marginTop: -20 }}>
+ <div className="flex items-center ml-auto order-first sm:order-none">
```

### 方案 C：去掉 pt-5，单独给签字区加 margin

把整个区域的 padding 去掉，只给签字文字区加 marginTop。

```diff
- pt-5  (signature-section上)
+ pt-0  (signature-section上)
+ 签字区加 style={{ marginTop: 16 }}
```

虚线→签字区 = 16px，虚线→QR = 0px。

## 推荐执行顺序

1. **先试试方案 A**：最简单，只改两个属性（justify-between→sm、gap-2→sm）
2. 如果方案 A 不够，再叠加方案 C 微调间距
3. 方案 B（order）留作兜底

## 验证方法

1. 桌面端打开样布码单预览 → 签字区和 QR 左右分布，水平间距 8px
2. 手机端打开同样单据 → QR 紧贴虚线下方，签字区在 QR 下方一定距离
3. 打印预览 → 格式不变
