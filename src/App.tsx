/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { DocType, DocumentData, CompanyProfile, DocItem } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  Database, PlusCircle, Settings, LayoutDashboard,
  Layers, ChevronRight, FileSpreadsheet, Info, CheckCircle2, Package
} from 'lucide-react';

// Lazy-load heavy components to reduce initial bundle size (mobile login page loads fast)
const DocumentList = lazy(() => import('./components/DocumentList'));
const DocumentEditor = lazy(() => import('./components/DocumentEditor'));
const DocumentPreview = lazy(() => import('./components/DocumentPreview'));
const CompanyProfileEditor = lazy(() => import('./components/CompanyProfileEditor'));
const StatsDashboard = lazy(() => import('./components/StatsDashboard'));
const ProductLibrary = lazy(() => import('./components/ProductLibrary'));

const LoadingFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="text-center">
      <div className="w-10 h-10 border-4 border-slate-200 border-t-sky-500 rounded-full animate-spin mx-auto mb-3" />
      <p className="text-sm text-slate-500">加载中...</p>
    </div>
  </div>
);

const STORAGE_KEYS = {
  DOCUMENTS: 'textile_dms_documents',
  PROFILE: 'textile_dms_company_profile',
};

// Realistic system defaults for Company Profile
const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  name: '织梦盛世面料品贸易有限公司',
  logoText: '织梦面料 · DREAM WEAVE',
  logoType: 'text',
  address: '浙江省绍兴市柯桥区中国轻纺城创意路88号3层',
  phone: '0575-81234567',
  issuerLabel: '开单人（签字）：',
  receiverLabel: '收货人（签收）：',
  defaultTerms: `1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。
2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。
3. 签收效力：开单人与收货人签字即具有同等合同效力，开单电话可作为业务沟通与对账的主要凭证。`
};

// Initial realistic default documents database
const INITIAL_DOCUMENTS_DB: DocumentData[] = [
  {
    id: 'init-doc-1',
    docNo: 'YB-20260706-001',
    type: DocType.SAMPLE,
    date: '2026-07-06',
    customerName: '江南针织时装有限公司',
    companyName: '织梦盛世面料品贸易有限公司',
    companyAddress: '浙江省绍兴市柯桥区中国轻纺城创意路88号3层',
    companyPhone: '0575-81234567',
    bottomPhone: '0575-81234567',
    receiverAddress: '',
    terms: `1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。\n2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。`,
    issuer: '张晓芬',
    receiver: '',
    items: [
      {
        id: 'init-it-1',
        itemNo: 'DF-8012',
        colorNo: '32# 藏青',
        productName: '双面奥黛尔罗马布',
        composition: '85%棉 15%聚酯纤维',
        weight: '320g/㎡',
        width: '185',
        meters: 15,
        price: 26.5,
        amount: 397.5,
        remark: '做样衣'
      },
      {
        id: 'init-it-2',
        itemNo: 'TR-503',
        colorNo: '08# 燕麦',
        productName: 'TR人棉空气层',
        composition: '65%涤 30%粘胶 5%氨纶',
        weight: '280g/㎡',
        width: '160',
        meters: 8.5,
        price: 18,
        amount: 153,
        remark: '水洗打样'
      }
    ],
    totalMeters: 23.5,
    totalRolls: 2,
    totalAmount: 550.5,
    receivableAmount: 550.5,
    createdAt: '2026-07-06T09:30:00.000Z',
    updatedAt: '2026-07-06T09:30:00.000Z'
  },
  {
    id: 'init-doc-2',
    docNo: 'XS-20260706-001',
    type: DocType.SALES,
    date: '2026-07-06',
    customerName: '盛虹时装出口贸易集团',
    companyName: '织梦盛世面料品贸易有限公司',
    companyAddress: '浙江省绍兴市柯桥区中国轻纺城创意路88号3层',
    companyPhone: '0575-81234567',
    bottomPhone: '0575-81234567',
    receiverAddress: '',
    terms: `1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。\n2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。`,
    issuer: '李建华',
    receiver: '王振华',
    items: [
      {
        id: 'init-it-3',
        itemNo: 'LN-108',
        colorNo: '12# 橄榄绿',
        productName: '水洗纯亚麻细布',
        rollNo: '26-C01-12',
        width: '145',
        meters: 42.5,
        price: 32,
        amount: 1360,
        remark: '大货一等品'
      },
      {
        id: 'init-it-4',
        itemNo: 'LN-108',
        colorNo: '12# 橄榄绿',
        productName: '水洗纯亚麻细布',
        rollNo: '26-C02-12',
        width: '145',
        meters: 41.2,
        price: 32,
        amount: 1318.4,
        remark: '出口订单'
      }
    ],
    totalMeters: 83.7,
    totalRolls: 2,
    totalAmount: 2678.4,
    receivableAmount: 2678.4,
    createdAt: '2026-07-06T14:15:00.000Z',
    updatedAt: '2026-07-06T14:15:00.000Z'
  }
];

type AppView = 'dashboard' | 'list' | 'create' | 'settings' | 'preview' | 'products';

// Helper: Map from Backend order model to Frontend DocumentData
function mapBackendOrderToDoc(order: any): DocumentData {
  const isSample = order.template_type === 'sample';
  const isDeposit = order.template_type === 'deposit';
  
  const mappedItems = (order.items || []).map((it: any) => {
    let rollNoStr = '';
    if (it.piece_meters) {
      try {
        const pm = typeof it.piece_meters === 'string' ? JSON.parse(it.piece_meters) : it.piece_meters;
        if (Array.isArray(pm)) {
          rollNoStr = pm.join(', ');
        }
      } catch (e) {
        rollNoStr = '';
      }
    }
    
    if (isSample) {
      return {
        id: String(it.id),
        itemNo: it.product_no || '',
        colorNo: it.color_no || '',
        productName: it.product_name || '',
        composition: it.composition || '',
        weight: String(it.weight || ''),
        width: String(it.width || ''),
        meters: parseFloat(it.meters || 0),
        price: parseFloat(it.unit_price || 0),
        amount: parseFloat(it.amount || 0),
        remark: it.remark || '',
      };
    } else if (isDeposit) {
      return {
        id: String(it.id),
        itemNo: it.product_no || '',
        colorNo: it.color_no || '',
        productName: it.product_name || '',
        meters: parseFloat(it.meters || 0),
        price: parseFloat(it.unit_price || 0),
        amount: parseFloat(it.amount || 0),
        remark: '',
      };
    } else {
      return {
        id: String(it.id),
        itemNo: it.product_no || '',
        colorNo: it.color_no || '',
        productName: it.product_name || '',
        rollNo: rollNoStr,
        width: String(it.width || ''),
        meters: parseFloat(it.meters || 0),
        price: parseFloat(it.unit_price || 0),
        amount: parseFloat(it.amount || 0),
        remark: it.remark || '',
      };
    }
  });

  return {
    id: String(order.id),
    docNo: order.order_no || '',
    type: isSample ? DocType.SAMPLE : (isDeposit ? DocType.DEPOSIT : DocType.SALES),
    date: order.order_date || '',
    customerName: order.receiving_unit || '',
    companyName: '织梦盛世面料品贸易有限公司',
    companyAddress: '浙江省绍兴市柯桥区中国轻纺城创意路88号3层',
    companyPhone: '0575-81234567',
    terms: (isSample ? `1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。\n2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。` : ''),
    issuer: order.sign_person || '',
    receiver: order.receiver || '',
    receiverAddress: order.receiver_address || '',
    bottomPhone: order.receiver_phone || '',
    items: mappedItems,
    totalMeters: parseFloat(order.total_meters || 0),
    totalRolls: parseInt(order.total_pieces || 0),
    totalAmount: parseFloat(order.total_amount || 0),
    receivableAmount: isDeposit
      ? parseFloat(order.total_amount || 0)
      : parseFloat(order.total_amount || 0) - parseFloat(order.deposit || 0),
    deposit: parseFloat(order.deposit || 0),
    createdAt: order.created_at || new Date().toISOString(),
    updatedAt: order.updated_at || new Date().toISOString()
  };
}

// Map from Frontend DocumentData to Backend Order Payload
function mapDocToBackendPayload(doc: DocumentData): any {
  const isSample = doc.type === DocType.SAMPLE;
  const isDeposit = doc.type === DocType.DEPOSIT;

  const itemsPayload = doc.items.map((it: any) => {
    let pieceMeters: number[] | null = null;
    if (!isSample && !isDeposit && it.rollNo) {
      pieceMeters = it.rollNo.split(/[,，\s]+/).map(parseFloat).filter(v => !isNaN(v) && v > 0);
    }

    return {
      product_no: it.itemNo || '',
      color_no: it.colorNo || '',
      product_name: it.productName || '',
      composition: isDeposit ? '' : ((it as any).composition || ''),
      weight: isDeposit ? '' : ((it as any).weight || ''),
      width: isDeposit ? '' : (it.width || ''),
      meters: parseFloat(it.meters || 0),
      unit_price: parseFloat(it.price || 0),
      amount: parseFloat(it.amount || 0),
      remark: it.remark || '',
      piece_meters: pieceMeters
    };
  });

  return {
    order_no: doc.docNo,
    order_date: doc.date,
    style_no: '',
    receiving_unit: doc.customerName,
    total_meters: doc.totalMeters || 0,
    total_pieces: doc.totalRolls || 0,
    total_amount: doc.totalAmount || 0,
    sign_person: doc.issuer,
    receiver: doc.receiver,
    receiver_phone: doc.bottomPhone || '',
    receiver_address: doc.receiverAddress || '',
    template_type: isSample ? 'sample' : (isDeposit ? 'deposit' : 'bulk'),
    deposit: isDeposit ? 0 : (doc.deposit || 0),
    items: itemsPayload
  };
}

export default function App() {
  // Auth state
  const [authToken, setAuthToken] = useState<string | null>(sessionStorage.getItem('fabric_auth_token'));
  const [loginError, setLoginError] = useState('');

  // Global App View Route
  const [currentView, setCurrentView] = useState<AppView>('dashboard');

  // Data State
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(DEFAULT_COMPANY_PROFILE);

  // Current Active Doc operations state
  const [selectedDoc, setSelectedDoc] = useState<DocumentData | null>(null);
  const [docToEdit, setDocToEdit] = useState<DocumentData | null>(null);

  // Auth-aware fetch wrapper
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      sessionStorage.removeItem('fabric_auth_token');
      setAuthToken(null);
    }
    return res;
  };

  const handleLogin = async (password: string) => {
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const { token } = await res.json();
        sessionStorage.setItem('fabric_auth_token', token);
        setAuthToken(token);
      } else {
        setLoginError('密码错误');
      }
    } catch {
      setLoginError('连接失败，请检查服务器');
    }
  };

  // Load from database/API with local storage fallback on mount
  const loadData = async () => {
    try {
      // 1. Load Company Profile
      const profileRes = await authFetch('/api/company');
      if (profileRes.ok) {
        const backendProfile = await profileRes.json();
        if (backendProfile && backendProfile.company_name) {
          setCompanyProfile({
            name: backendProfile.company_name,
            logoText: backendProfile.brand_name || '织梦面料 · DREAM WEAVE',
            logoType: backendProfile.brand_logo ? 'image' : 'text',
            logoUrl: backendProfile.brand_logo || '',
            address: backendProfile.address || '',
            phone: backendProfile.phone || '',
            defaultTerms: backendProfile.default_terms || DEFAULT_COMPANY_PROFILE.defaultTerms,
            issuerLabel: DEFAULT_COMPANY_PROFILE.issuerLabel,
            receiverLabel: DEFAULT_COMPANY_PROFILE.receiverLabel,
            weChatPayUrl: backendProfile.wechat_qr || '',
            aliPayUrl: backendProfile.alipay_qr || '',
          });
        }
      }

      // 2. Load Documents
      const docsRes = await authFetch('/api/orders?per_page=100');
      if (docsRes.ok) {
        const docsJson = await docsRes.json();
        // Support both unwrapped array and { data: [...] } formats
        const docsArray = Array.isArray(docsJson) ? docsJson : docsJson.data;
        if (Array.isArray(docsArray)) {
          const mapped = docsArray.map(mapBackendOrderToDoc);
          setDocuments(mapped);
          return;
        }
      }
    } catch (e) {
      console.warn('API connection failed. Using local storage fallback.', e);
    }

    // Fallback load
    const savedDocs = localStorage.getItem(STORAGE_KEYS.DOCUMENTS);
    const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);

    if (savedDocs) {
      setDocuments(JSON.parse(savedDocs));
    } else {
      setDocuments(INITIAL_DOCUMENTS_DB);
      localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(INITIAL_DOCUMENTS_DB));
    }

    if (savedProfile) {
      setCompanyProfile(JSON.parse(savedProfile));
    } else {
      setCompanyProfile(DEFAULT_COMPANY_PROFILE);
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(DEFAULT_COMPANY_PROFILE));
    }
  };

  useEffect(() => {
    if (authToken) loadData();
  }, [authToken]);

  // Update localStorage when documents list modifications occur
  const saveDocumentsToStorage = (updatedDocs: DocumentData[]) => {
    setDocuments(updatedDocs);
    localStorage.setItem(STORAGE_KEYS.DOCUMENTS, JSON.stringify(updatedDocs));
  };

  // Sync profile changes with backend
  const handleSaveProfile = async (updatedProfile: CompanyProfile) => {
    setCompanyProfile(updatedProfile);
    localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(updatedProfile));

    try {
      await authFetch('/api/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: updatedProfile.name,
          brand_name: updatedProfile.logoText,
          brand_logo: updatedProfile.logoUrl || '',
          address: updatedProfile.address,
          phone: updatedProfile.phone,
          wechat_qr: updatedProfile.weChatPayUrl || '',
          alipay_qr: updatedProfile.aliPayUrl || '',
          default_terms: updatedProfile.defaultTerms || ''
        })
      });
    } catch (e) {
      console.warn('Backend profile sync failed:', e);
    }
  };

  // Create or Update Document on backend
  const handleSaveDocument = async (savedDoc: DocumentData) => {
    let updatedDocId = savedDoc.id;

    try {
      const isEdit = documents.some(doc => doc.id === savedDoc.id) && !savedDoc.id.startsWith('new-') && !savedDoc.id.startsWith('init-');
      const url = isEdit ? `/api/orders/${savedDoc.id}` : '/api/orders';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapDocToBackendPayload(savedDoc))
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        if (res.status === 401) {
          sessionStorage.removeItem('fabric_auth_token');
          setAuthToken(null);
          alert('登录已过期，请重新登录');
          return;
        }
        alert(`保存失败 (${res.status})：${errText || '服务器错误，请重试'}`);
        return;
      }

      const json = await res.json();
      // Support both { id } and { data: { id } } response formats
      const returnedId = json.id ?? json.data?.id;
      if (returnedId != null) {
        updatedDocId = String(returnedId);
        savedDoc.id = updatedDocId;
      }
    } catch (e) {
      alert('连接服务器失败，请检查网络后重试');
      return;
    }

    let updatedDocs: DocumentData[];
    const exists = documents.some(doc => doc.id === savedDoc.id);
    if (exists) {
      updatedDocs = documents.map(doc => doc.id === savedDoc.id ? savedDoc : doc);
    } else {
      updatedDocs = [savedDoc, ...documents];
    }
    
    saveDocumentsToStorage(updatedDocs);
    setSelectedDoc(savedDoc); // Go straight to preview sheet
    setDocToEdit(null);
    setCurrentView('preview');
  };

  // Copy/Duplicate Document to start a new record easily
  const handleDuplicateDocument = (doc: DocumentData) => {
    const prefix = doc.type === DocType.SAMPLE ? 'YB' : (doc.type === DocType.DEPOSIT ? 'DJ' : 'XS');
    const d = new Date();
    const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cleanDate = localToday.replace(/-/g, '');
    const todayCount = documents.filter(d => d.type === doc.type && d.date === localToday).length;
    const sequence = String(todayCount + 1).padStart(3, '0');

    // Create cloned payload
    const duplicated: DocumentData = {
      ...doc,
      id: 'new-' + Math.random().toString(36).substring(2, 11),
      docNo: `${prefix}-${cleanDate}-${sequence}`,
      date: localToday, // Reset to today's date
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setDocToEdit(duplicated);
    setCurrentView('create');
  };

  // Delete document
  const handleDeleteDocument = async (id: string) => {
    if (confirm('警告：确定要从数据库永久删除此单据吗？操作不可撤销。')) {
      try {
        if (!id.startsWith('init-') && !id.startsWith('new-')) {
          await authFetch(`/api/orders/${id}`, { method: 'DELETE' });
        }
      } catch (e) {
        console.warn('Backend order delete failed, fallback local only:', e);
      }

      const remaining = documents.filter(doc => doc.id !== id);
      saveDocumentsToStorage(remaining);
    }
  };

  // Import full database from backup
  const handleImportBackup = (backupDocs: DocumentData[]) => {
    saveDocumentsToStorage(backupDocs);
  };

  // Login screen
  if (!authToken) {
    return (
      <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-sky-600 text-white flex items-center justify-center mx-auto mb-3">
              <Layers className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">单据管理系统</h2>
            <p className="text-sm text-slate-500 mt-1">请输入管理密码</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); handleLogin((e.target as any).password.value); }}>
            <input
              type="password"
              name="password"
              placeholder="密码"
              autoFocus
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm mb-3"
            />
            {loginError && <p className="text-red-500 text-xs mb-3">{loginError}</p>}
            <button
              type="submit"
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold cursor-pointer transition-colors"
            >
              登录
            </button>
          </form>
        </div>
      </div>
      </ErrorBoundary>
    );
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
    <ErrorBoundary>
    <div className="min-h-screen bg-slate-50/60 flex flex-col text-slate-800">
      
      {/* Dynamic top bar - hidden on print view */}
      <header className="no-print bg-white border-b border-slate-100 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo brand signature */}
            <div className="flex items-center gap-2.5">
              <div className="w-8.5 h-8.5 rounded-xl bg-linear-to-br from-sky-600 to-indigo-600 text-white flex items-center justify-center font-black shadow-md tracking-wider flex-shrink-0">
                <Layers className="w-4.5 h-4.5" />
              </div>
              <div>
                <h1 className="text-sm md:text-md font-extrabold text-slate-800 tracking-tight flex items-center gap-1">
                  单据管理系统
                  <span className="text-[9px] bg-slate-100 text-slate-500 font-bold px-1 py-0.2 rounded-xs">
                    面料版
                  </span>
                </h1>
                <p className="text-[9px] text-slate-400 font-medium">Fabric Invoicing Database</p>
              </div>
            </div>

            {/* Main Tabs Navigation - Hidden on mobile, shown on desktop & tablets */}
            <nav className="hidden md:flex space-x-1">
              <button
                type="button"
                id="nav-btn-dashboard"
                onClick={() => { setCurrentView('dashboard'); setDocToEdit(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  currentView === 'dashboard'
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                数据大盘
              </button>

              <button
                type="button"
                id="nav-btn-list"
                onClick={() => { setCurrentView('list'); setDocToEdit(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  currentView === 'list' || currentView === 'preview'
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Database className="w-4 h-4" />
                单据历史库
              </button>

              <button
                type="button"
                id="nav-btn-create"
                onClick={() => { setDocToEdit(null); setCurrentView('create'); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  currentView === 'create' && !docToEdit
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <PlusCircle className="w-4 h-4" />
                快速开单
              </button>

              <button
                type="button"
                id="nav-btn-products"
                onClick={() => { setCurrentView('products'); setDocToEdit(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  currentView === 'products'
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Package className="w-4 h-4" />
                产品库
              </button>

              <button
                type="button"
                id="nav-btn-settings"
                onClick={() => { setCurrentView('settings'); setDocToEdit(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  currentView === 'settings'
                    ? 'bg-sky-50 text-sky-700'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Settings className="w-4 h-4" />
                排版配置
              </button>
            </nav>
            
            {/* Quick access action on top right for mobile header */}
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => { setDocToEdit(null); setCurrentView('create'); }}
                className="p-2 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center cursor-pointer"
                title="快速开单"
              >
                <PlusCircle className="w-5 h-5" />
              </button>
            </div>
            
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 pb-28 md:pb-12">
        
        {/* Dynamic Route Rendering */}
        <div className="animate-fade-in duration-200">
          
          {/* Dashboard View */}
          {currentView === 'dashboard' && (
            <StatsDashboard 
              documents={documents}
              onViewDoc={(doc) => {
                setSelectedDoc(doc);
                setCurrentView('preview');
              }}
            />
          )}

          {/* Ledger List View */}
          {currentView === 'list' && (
            <DocumentList 
              documents={documents}
              onSelect={(doc) => {
                setSelectedDoc(doc);
                setCurrentView('preview');
              }}
              onEdit={(doc) => {
                setDocToEdit(doc);
                setCurrentView('create');
              }}
              onDelete={handleDeleteDocument}
              onDuplicate={handleDuplicateDocument}
              onCreateNew={() => {
                setDocToEdit(null);
                setCurrentView('create');
              }}
              onImportBackup={handleImportBackup}
            />
          )}

          {/* Document Editor View (Creates new or updates existing) */}
          {currentView === 'create' && (
            <DocumentEditor 
              key={docToEdit ? docToEdit.id : 'new-doc'}
              companyProfile={companyProfile}
              existingDocument={docToEdit}
              allSavedDocuments={documents}
              onSave={handleSaveDocument}
              onCancel={() => {
                setDocToEdit(null);
                setCurrentView('list');
              }}
            />
          )}

          {/* Settings / Company Layout view */}
          {currentView === 'settings' && (
            <CompanyProfileEditor
              profile={companyProfile}
              onSave={handleSaveProfile}
            />
          )}

          {/* Product Library */}
          {currentView === 'products' && (
            <ProductLibrary />
          )}

          {/* Invoice Preview Section */}
          {currentView === 'preview' && selectedDoc && (
            <DocumentPreview 
              document={selectedDoc}
              companyProfile={companyProfile}
              onEdit={() => {
                setDocToEdit(selectedDoc);
                setCurrentView('create');
              }}
              onBack={() => {
                setSelectedDoc(null);
                setCurrentView('list');
              }}
            />
          )}

        </div>
      </main>

      {/* Corporate footer - hidden on print */}
      <footer className="no-print border-t border-slate-100 bg-white py-6 mt-12 text-center text-xs text-slate-400 font-medium pb-24 md:pb-6">
        <div className="max-w-7xl mx-auto px-4 space-y-2">
          <div>面料行业单据数据库管理系统（样布码单 / 销售发货码单 / 定金单）</div>
          <div>本软件数据完全存储于您的浏览器本地沙箱，支持一键备份和恢复。</div>
        </div>
      </footer>

      {/* Modern bottom tab bar for mobile touch screens */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-200/80 shadow-lg px-2 py-2 flex justify-around no-print pb-safe">
        <button
          type="button"
          onClick={() => { setCurrentView('dashboard'); setDocToEdit(null); }}
          className={`flex flex-col items-center justify-center gap-1 text-center py-1 px-3 rounded-xl transition-all ${
            currentView === 'dashboard' ? 'text-sky-600 font-bold bg-sky-50/50' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] tracking-tight">数据大盘</span>
        </button>
        
        <button
          type="button"
          onClick={() => { setCurrentView('list'); setDocToEdit(null); }}
          className={`flex flex-col items-center justify-center gap-1 text-center py-1 px-3 rounded-xl transition-all ${
            currentView === 'list' || currentView === 'preview' ? 'text-sky-600 font-bold bg-sky-50/50' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Database className="w-5 h-5" />
          <span className="text-[10px] tracking-tight">单据历史</span>
        </button>

        <button
          type="button"
          onClick={() => { setCurrentView('products'); setDocToEdit(null); }}
          className={`flex flex-col items-center justify-center gap-1 text-center py-1 px-3 rounded-xl transition-all ${
            currentView === 'products' ? 'text-sky-600 font-bold bg-sky-50/50' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Package className="w-5 h-5" />
          <span className="text-[10px] tracking-tight">产品库</span>
        </button>

        <button
          type="button"
          onClick={() => { setDocToEdit(null); setCurrentView('create'); }}
          className={`flex flex-col items-center justify-center gap-1 text-center py-1 py-1 px-3 rounded-xl transition-all ${
            currentView === 'create' && !docToEdit ? 'text-sky-600 font-bold bg-sky-50/50' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <PlusCircle className="w-5 h-5" />
          <span className="text-[10px] tracking-tight">快速开单</span>
        </button>

        <button
          type="button"
          onClick={() => { setCurrentView('settings'); setDocToEdit(null); }}
          className={`flex flex-col items-center justify-center gap-1 text-center py-1 px-3 rounded-xl transition-all ${
            currentView === 'settings' ? 'text-sky-600 font-bold bg-sky-50/50' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] tracking-tight">排版配置</span>
        </button>
      </div>
      
    </div>
    </ErrorBoundary>
    </Suspense>
  );
}
