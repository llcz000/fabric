/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum DocType {
  SAMPLE = 'sample', // 样布码单
  SALES = 'sales',   // 销售发货码单
  DEPOSIT = 'deposit', // 定金单
}

export interface SampleItem {
  id: string;
  itemNo: string;       // 货号
  colorNo: string;      // 色号
  productName: string;  // 品名
  composition: string;  // 成分
  weight: string;       // 克重
  width: string;        // 门幅（cm）
  meters: number;       // 米数（米）
  price: number;        // 单价（元）
  amount: number;       // 金额（元），金额 = 米数 * 单价
  remark: string;       // 备注
}

export interface SalesItem {
  id: string;
  itemNo: string;       // 货号
  colorNo: string;      // 色号
  productName: string;  // 品名
  rollNo: string;       // 匹号/箱号
  width: string;        // 门幅（cm）
  meters: number;       // 米数（米）
  price: number;        // 单价（元）
  amount: number;       // 金额（元），金额 = 米数 * 单价
  deductionMeters?: number; // 扣损米数（米）
  remark: string;       // 备注
}

export interface DepositItem {
  id: string;
  itemNo: string;       // 货号
  colorNo: string;      // 色号
  productName: string;  // 品名
  meters: number;       // 米数（米）
  price: number;        // 单价（元）
  amount: number;       // 金额（元），金额 = 米数 * 单价
  remark: string;       // 备注（定金单不使用）
}

export type DocItem = SampleItem | SalesItem | DepositItem;

export interface CompanyProfile {
  name: string;         // 公司名称
  logoText: string;     // 公司Logo文本/字标
  logoType: 'text' | 'icon' | 'image';
  logoUrl?: string;     // 自定义Logo图片地址
  address: string;      // 公司地址
  phone: string;        // 公司电话
  defaultTerms: string; // 默认备注条款/免责声明（样布码单 & 销售发货码单）
  depositTerms: string; // 定金单备注条款
  issuerLabel: string;  // 开单人签字栏文案（如：开单人（签字））
  receiverLabel: string; // 收货人签字栏文案（如：收货人（签字））
  weChatPayUrl?: string; // 微信收款码 Base64/URL
  aliPayUrl?: string;    // 支付宝收款码 Base64/URL
}

export interface DocumentData {
  id: string;
  docNo: string;        // 单据编号 (自动生成，如 YB-20260707-001)
  type: DocType;        // 单据类型
  date: string;         // 开单日期
  customerName: string; // 客户
  items: DocItem[];     // 明细记录列表

  // 单个单据可以覆盖公司默认设置
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  terms: string;        // 备注条款
  issuer: string;       // 开单人/经手人名字或留白
  receiver: string;     // 收货人名字或留白
  receiverAddress: string; // 收货地址（定金单使用）
  bottomPhone: string;  // 底部展示电话

  // 汇总数据
  totalMeters: number;  // 总计数（米）
  totalRolls: number;   // 实发总匹数（即记录数）
  totalAmount: number;  // 合计总额（元）
  receivableAmount: number; // 应收金额（元）
  deposit?: number;     // 预收订金（元）
  deductionMeters?: number; // 扣损米数（米），仅销售发货码单使用
  settled?: boolean;   // 是否结清，样布码单 & 销售发货码单使用

  createdAt: string;    // 创建时间戳
  updatedAt: string;    // 修改时间戳
}

// ==================== Product Library ====================

export interface ProductItem {
  id: string;
  itemNo: string;       // 货号
  productName: string;  // 品名
  composition: string;  // 成分
  weight: string;       // 克重
  width: string;        // 门幅
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  productId: string;
  order: number;
  url: string;           // COS or local URL
  thumbnailUrl: string;
}

// ==================== Inventory ====================

export interface InventoryEntry {
  id: string;
  entryDate: string;
  productName: string;
  rolls: number;
  meters: number;
  createdAt: string;
}

export interface InventoryRecord {
  productName: string;
  totalInRolls: number;
  totalInMeters: number;
  totalOutRolls: number;
  totalOutMeters: number;
  remainingRolls: number;
  remainingMeters: number;
}
