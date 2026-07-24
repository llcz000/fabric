# 面料印花以图搜图 — 当前算法文档

## 概述

以图搜图功能使用 **CLIP ViT-Base-Patch32 图像语义特征** + **HSV 2D 颜色直方图** 的多模态融合方案，对产品库中的图片进行相似度检索。

## 算法流程

```
上传查询图 → 特征提取 → 与库中所有特征计算距离 → 排序 → 去重 → 返回 Top 50
```

---

## 1. 特征提取 (computeFeature)

代码位置: `server.ts:1008-1041`

### 1.1 CLIP 语义特征 (512维)

| 项目 | 内容 |
|------|------|
| 模型 | `Xenova/clip-vit-base-patch32` |
| 运行时 | `@xenova/transformers` (ONNX Runtime) |
| 缓存 | `.transformers_cache/` |
| 镜像 | `https://hf-mirror.com` (HF_REMOTE_HOST 可配置) |
| 维度 | 512 |
| 预处理 | 写入临时文件 → pipeline 推理 |
| 后处理 | L2 归一化 (确保 dot product = cosine similarity) |

**CLIP 特点**:
- 在 4 亿图文对上训练，学习到通用视觉语义
- 对"类别层面"的语义敏感(如"这是一块面料")，但对细粒度花纹纹理区分能力弱
- 固定输入分辨率 224×224，对大尺寸图片会丢失细节

### 1.2 HSV 2D 颜色直方图 (64维)

代码位置: `server.ts:952-1006`

| 项目 | 内容 |
|------|------|
| 输入 | 原图 resize 到 180×180 |
| 颜色空间 | HSV (Hue-Saturation-Value) |
| 直方图结构 | 16 个色相(H) × 4 个饱和度(S) = 64 维 |
| 归一化 | L1 归一化 (所有 bin 之和 = 1) |

**V 通道均衡化 (抑制光照差异)**:
1. 计算每个像素的 Value = max(R, G, B)
2. 对 V 通道做直方图均衡化 (CDF 映射)
3. 用均衡后的 V 缩放原始 RGB: `RGB_new = RGB × (V_eq / V_orig)`
4. 对缩放后的 RGB 计算 Hue 和 Saturation

**H/S 量化**:
```
Hue:        [0, 360°) → 16 bins (每 bin 22.5°)
Saturation: [0, 1]    →  4 bins (每 bin 0.25)
Bin Index = hBin × 4 + sBin
```

**HSV 特点**:
- 捕获颜色分布，对光照变化有鲁棒性
- 全局直方图，**丢失所有空间信息** (不知道颜色在图像的哪个位置)
- 对颜色相近但花纹不同的面料可能产生误判

### 1.3 特征存储格式

两个特征向量拼接为十六进制字符串存储:

```
CLIP 512d (float32 LE) + "|" + HSV 64d (float32 LE)
```

具体编码:
- CLIP: 512 × 4 bytes = 2048 bytes → 4096 hex chars
- HSV:   64 × 4 bytes =  256 bytes →  512 hex chars
- 分隔符: `|` (1 char)
- 总计: 4609 字符

旧格式 (纯 CLIP, 无 `|` 分隔符) 兼容读取。

---

## 2. 距离计算 (featureDistance)

代码位置: `server.ts:1086-1106`

### 2.1 CLIP 距离

```
CLIP_dist = 1 - cosine_similarity(A, B)
          = 1 - Σ(Ai × Bi)
```

范围: `[0, 1]`, 0 = 完全相同, 1 = 完全无关。

### 2.2 HSV 距离

使用 **卡方距离 (Chi-Square Distance)**:

```
chiSq = 0.5 × Σ((Ai - Bi)² / (Ai + Bi))
```

范围: `[0, 1]`。

卡方距离对直方图分布差异更敏感，适合比较概率分布。

### 2.3 融合距离

```
Fused_dist = 0.3 × CLIP_dist + 0.7 × HSV_dist
```

**权重设计意图**: HSV 权重 0.7 > CLIP 权重 0.3，表示算法更偏重颜色特征。这是因为：
- 面料花型的首要区分维度是颜色
- HSV 在原型验证中 WorstGap=+13.9%，CLIP 仅为 -1.1%

---

## 3. 搜索过程

代码位置: `server.ts:1792-1849`

```
POST /api/products/search/similar
Content-Type: multipart/form-data
参数: file (图片文件)
```

```
1. 用 multer 接收上传的查询图片
2. computeFeature() 计算查询图的 CLIP + HSV 特征
3. 从数据库加载所有 product_images 的 embedding
4. 逐条计算 featureDistance(query, db_image)
5. 过滤: score ≤ 0.5 (距离 ≤ 阈值)
6. 按 score 升序排列 (越相似越靠前)
7. 按 productId 去重 (同一产品只保留最相似的图片)
8. 返回 Top 50 结果
```

---

## 4. 已知问题

| 问题 | 影响 | 原因 |
|------|------|------|
| **CLIP 区分力弱** | 对不同面料都给 ~80% 相似度 | CLIP 在自然图像上训练，对细粒度纹理不敏感 |
| **HSV 丢失空间信息** | 颜色相同但花纹不同的面料得分高 | 全局直方图不知道颜色在空间上怎么分布 |
| **图片分辨率不统一** | 小图(如162×247)resize后细节丢失 | 产品库图片来源不同，没有最低分辨率要求 |
| **阈值 0.5 太宽松** | 无关图片可能进入结果 | 距离 0.5 对应的相似度为 50% |
| **全库遍历** | 产品库增大时性能下降 | 没有向量索引/ANN |

---

## 5. 原型验证结论

在 9 张面料图片上验证 (3 张同花型正例 + 5 张不同花型负例):

| 方法 | 正例均值 | 负例均值 | WorstGap | 状态 |
|------|---------|---------|----------|------|
| CLIP32 单独 | 79.3% | 62.3% | -1.1% | 失败 |
| HSV 单独 | 29.1% | 3.6% | +13.9% | 有效 |
| **生产融合 0.3×CLIP+0.7×HSV** | **44.2%** | **21.2%** | **+9.4%** | **有效** |
| Color Correlogram (新) | 50.5% | 9.6% | +16.7% | 更优 |

**改进方向**: Color Correlogram (颜色空间相关性) 单特征即可达 WorstGap=+16.7%，优于当前生产融合方案 +9.4%。详见 `tmp/search_test/` 目录下的原型代码。

---

## 6. 相关文件

| 文件 | 说明 |
|------|------|
| `server.ts:919-1106` | 特征提取、解析、距离计算 |
| `server.ts:1792-1849` | 相似搜索 API 端点 |
| `server.ts:1852-1906` | 重建特征向量管理 API |
| `tmp/search_test/prototype.js` | 原型验证脚本 |
| `tmp/search_test/extract_features_v2.js` | 改进特征提取(含Correlogram) |
| `tmp/search_test/analyze_v2.js` | 改进特征分析脚本 |
