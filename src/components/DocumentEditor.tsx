/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { DocType, DocumentData, DocItem, CompanyProfile, SampleItem, SalesItem, DepositItem } from '../types';
import { Plus, Trash2, Save, FileText, Calendar, User, Hash, AlertTriangle } from 'lucide-react';

interface DocumentEditorProps {
  key?: string;
  companyProfile: CompanyProfile;
  existingDocument?: DocumentData | null;
  allSavedDocuments: DocumentData[];
  onSave: (document: DocumentData) => void;
  onCancel: () => void;
}

export default function DocumentEditor({
  companyProfile,
  existingDocument,
  allSavedDocuments,
  onSave,
  onCancel,
}: DocumentEditorProps) {
  // Set up document type
  const [docType, setDocType] = useState<DocType>(existingDocument?.type || DocType.SAMPLE);
  
  // Basic metadata fields
  const [customerName, setCustomerName] = useState(existingDocument?.customerName || '');
  const [customerFocused, setCustomerFocused] = useState(false);

  // Customer autocomplete from history
  const customerHistory = React.useMemo(() => {
    const names = new Set<string>();
    for (const doc of allSavedDocuments) {
      const name = (doc.customerName || '').trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [allSavedDocuments]);

  const customerSuggestions = React.useMemo(() => {
    if (!customerName.trim()) return customerHistory.slice(0, 8);
    const lower = customerName.toLowerCase();
    return customerHistory.filter(n => n.toLowerCase().includes(lower)).slice(0, 8);
  }, [customerName, customerHistory]);
  const [date, setDate] = useState(() => {
    if (existingDocument?.date) return existingDocument.date;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Generate default docNo: PREFIX-YYYYMMDD-NNN
  const generateDocNo = (type: DocType, dateStr: string): string => {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = type === DocType.SAMPLE ? 'YB' : (type === DocType.DEPOSIT ? 'DJ' : 'XS');
    let maxSeq = 0;
    for (const doc of allSavedDocuments) {
      if (doc.docNo && doc.docNo.startsWith(`${prefix}-${datePart}-`)) {
        const seq = parseInt(doc.docNo.split('-').pop() || '0', 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
    return `${prefix}-${datePart}-${String(maxSeq + 1).padStart(3, '0')}`;
  };

  const [docNo, setDocNo] = useState(() => {
    if (existingDocument?.docNo) return existingDocument.docNo;
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return generateDocNo(existingDocument?.type || DocType.SAMPLE, dateStr);
  });

  // Auto-update docNo when type/date changes for new documents (unless manually edited)
  const docNoManualRef = useRef(false);
  React.useEffect(() => {
    if (!existingDocument && !docNoManualRef.current) {
      setDocNo(generateDocNo(docType, date));
    }
  }, [docType, date]);
  
  // Company info (stored but preview uses companyProfile directly)
  const [companyName, setCompanyName] = useState(existingDocument?.companyName || '');
  const [companyAddress, setCompanyAddress] = useState(existingDocument?.companyAddress || '');
  const [companyPhone, setCompanyPhone] = useState(existingDocument?.companyPhone || '');
  const [terms, setTerms] = useState('');
  const [issuer, setIssuer] = useState(existingDocument?.issuer || '');
  const [receiver, setReceiver] = useState(existingDocument?.receiver || '');
  const [receiverAddress, setReceiverAddress] = useState(existingDocument?.receiverAddress || '');
  const [bottomPhone, setBottomPhone] = useState(existingDocument?.bottomPhone || '');
  const [deposit, setDeposit] = useState<number>(existingDocument?.deposit || 0);
  const [part3Open, setPart3Open] = useState(false);

  // Custom number of inputs for piece meters (sales documents)
  const [rollInputsCount, setRollInputsCount] = useState<Record<string, number>>({});

  const getInputsCountForItem = (itemId: string, rollNoStr: string | undefined): number => {
    const currentCount = rollInputsCount[itemId];
    if (currentCount !== undefined) {
      return currentCount;
    }
    const tokens = rollNoStr ? rollNoStr.trim().split(/[,，\s]+/).filter(Boolean) : [];
    const initialCount = Math.max(5, tokens.length);
    return initialCount;
  };

  const handleAddMoreRollInputs = (itemId: string, currentCount: number) => {
    setRollInputsCount(prev => ({
      ...prev,
      [itemId]: currentCount + 5
    }));
  };

  // Detail Items list
  const [items, setItems] = useState<DocItem[]>([]);

  // Generate doc number prefix hint only, not auto-fill
  const docNoPrefix = docType === DocType.SAMPLE ? 'YB' : (docType === DocType.DEPOSIT ? 'DJ' : 'XS');


  // Initialize items
  useEffect(() => {
    if (existingDocument) {
      setItems(existingDocument.items);
    } else {
      // Start with 3 empty rows
      setItems([createEmptyItem(docType), createEmptyItem(docType), createEmptyItem(docType)]);
    }
  }, [existingDocument, docType]);

  // Handle doc type shift
  const handleDocTypeChange = (newType: DocType) => {
    if (items.some(item => item.itemNo || item.productName)) {
      if (!confirm('切换单据类型将重置当前已录入的明细数据，是否确认？')) {
        return;
      }
    }
    setDocType(newType);
    setItems([createEmptyItem(newType), createEmptyItem(newType), createEmptyItem(newType)]);
  };

  // Helper to create empty item
  function createEmptyItem(type: DocType): DocItem {
    const id = Math.random().toString(36).substring(2, 9);
    if (type === DocType.SAMPLE) {
      return {
        id,
        itemNo: '',
        colorNo: '',
        productName: '',
        composition: '',
        weight: '',
        width: '',
        meters: 0,
        price: 0,
        amount: 0,
        remark: '',
      } as SampleItem;
    } else if (type === DocType.DEPOSIT) {
      return {
        id,
        itemNo: '',
        colorNo: '',
        productName: '',
        meters: 0,
        price: 0,
        amount: 0,
        remark: '',
      } as DepositItem;
    } else {
      return {
        id,
        itemNo: '',
        colorNo: '',
        productName: '',
        rollNo: '',
        width: '',
        meters: 0,
        price: 0,
        amount: 0,
        deductionMeters: 0,
        remark: '',
      } as SalesItem;
    }
  }

  // Handle cell changes
  const handleCellChange = (index: number, field: string, value: any) => {
    const updatedItems = [...items];
    const currentItem = { ...updatedItems[index] } as any;

    if (field === 'meters' || field === 'price' || field === 'deductionMeters') {
      const numValue = value === '' ? 0 : parseFloat(value);
      currentItem[field] = isNaN(numValue) ? 0 : numValue;

      // Auto-calculate amount using net meters (meters - deductionMeters)
      const m = field === 'meters' ? (isNaN(parseFloat(value)) ? 0 : parseFloat(value)) : (currentItem.meters || 0);
      const d = field === 'deductionMeters' ? (isNaN(parseFloat(value)) ? 0 : parseFloat(value)) : (currentItem.deductionMeters || 0);
      const p = field === 'price' ? (isNaN(parseFloat(value)) ? 0 : parseFloat(value)) : (currentItem.price || 0);
      const netMeters = Math.max(0, m - d);
      currentItem.amount = parseFloat((netMeters * p).toFixed(2));
    } else {
      currentItem[field] = value;
    }

    if (docType === DocType.SALES && field === 'rollNo' && value) {
      // Split the rolls and parse them
      const tokens = value.trim().split(/[,，\s]+/);
      let totalM = 0;
      let hasValidNumbers = false;
      for (const t of tokens) {
        if (!t) continue;
        const val = parseFloat(t);
        if (!isNaN(val) && val > 0 && /^\d+(\.\d+)?$/.test(t)) {
          totalM += val;
          hasValidNumbers = true;
        }
      }
      if (hasValidNumbers) {
        currentItem.meters = parseFloat(totalM.toFixed(2));
        const netM = Math.max(0, currentItem.meters - (currentItem.deductionMeters || 0));
        currentItem.amount = parseFloat((netM * currentItem.price).toFixed(2));
      }
    }

    updatedItems[index] = currentItem;
    setItems(updatedItems);
  };

  // Add line
  const addRow = () => {
    setItems([...items, createEmptyItem(docType)]);
  };

  // Delete line
  const deleteRow = (index: number) => {
    if (items.length <= 1) {
      alert('单据必须至少包含一条明细记录。');
      return;
    }
    const updated = items.filter((_, i) => i !== index);
    setItems(updated);
  };

  // Clear rows
  const clearAllRows = () => {
    if (confirm('是否确认清空当前所有明细？')) {
      setItems([createEmptyItem(docType)]);
    }
  };

  // Sum calculations
  const getRollValuesCount = (rollNoStr: string, totalMeters: number): number => {
    if (!rollNoStr) return 0;
    const tokens = rollNoStr.trim().split(/[,，\s]+/).filter(Boolean);
    let count = 0;
    for (const t of tokens) {
      if (!/^\d+(\.\d+)?$/.test(t)) continue;
      const val = parseFloat(t);
      if (isNaN(val) || val <= 0) continue;
      count++;
    }
    return count > 0 ? count : 0;
  };

  // Filter valid items (non-empty rows)
  const validItems = items.filter(item => item.itemNo.trim() !== '' || item.productName.trim() !== '');

  const totalMetersRaw = validItems.reduce((sum, item) => sum + (item.meters || 0), 0);
  const totalDeduction = validItems.reduce((sum, item) => sum + ((item as any).deductionMeters || 0), 0);
  const totalMeters = parseFloat((totalMetersRaw - totalDeduction).toFixed(2));
  const totalRolls = (docType === DocType.SAMPLE || docType === DocType.DEPOSIT)
    ? validItems.length
    : validItems.reduce((sum, item) => sum + getRollValuesCount((item as SalesItem).rollNo, item.meters), 0);
  const totalAmount = parseFloat(validItems.reduce((sum, item) => sum + (item.amount || 0), 0).toFixed(2));
  const receivableAmount = docType === DocType.DEPOSIT
    ? parseFloat((totalAmount * (1 - deposit / 100)).toFixed(2))
    : parseFloat((totalAmount - deposit).toFixed(2));

  // Handle save
  const handleSave = () => {
    // Basic validation
    if (!customerName.trim()) {
      alert('请输入客户。');
      return;
    }

    if (validItems.length === 0) {
      alert('请至少录入一条包含货号或品名的有效明细。');
      return;
    }

    const payload: DocumentData = {
      id: existingDocument?.id || Math.random().toString(36).substring(2, 11),
      docNo,
      type: docType,
      date,
      customerName: customerName.trim(),
      items: validItems,
      companyName,
      companyAddress,
      companyPhone,
      terms,
      issuer: issuer.trim(),
      receiver: receiver.trim(),
      receiverAddress: receiverAddress.trim(),
      bottomPhone: bottomPhone.trim(),
      totalMeters: parseFloat(totalMeters.toFixed(2)),
      totalRolls,
      totalAmount,
      receivableAmount,
      deposit,
      deductionMeters: docType === DocType.SALES ? totalDeduction : 0,
      createdAt: existingDocument?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(payload);
  };

  return (
    <div id="document-editor" className="space-y-3">
      {/* Upper header action selection */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <span className="text-xs font-semibold text-sky-600 bg-sky-50 px-2.5 py-1 rounded-full uppercase tracking-wider">
            {existingDocument ? '编辑单据模式' : '创建新单据'}
          </span>
          <h2 className="text-xl font-bold text-slate-800 mt-1 flex items-center gap-2">
            <FileText className="w-6 h-6 text-slate-700" />
            {existingDocument ? '修改单据内容' : '录入新纺织单据'}
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            输入各项基础指标，系统将实时计算明细金额及合计数，并生成高分辨率排版账单。
          </p>
        </div>

        {/* Tab selection for document category */}
        <div className="flex bg-slate-100/90 border border-slate-200/60 p-1.5 rounded-xl w-fit shadow-inner">
          <button
            type="button"
            id="tab-select-sample"
            onClick={() => handleDocTypeChange(DocType.SAMPLE)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              docType === DocType.SAMPLE
                ? 'bg-sky-600 text-white shadow-md scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            样布码单 (Sample)
          </button>
          <button
            type="button"
            id="tab-select-sales"
            onClick={() => handleDocTypeChange(DocType.SALES)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              docType === DocType.SALES
                ? 'bg-sky-600 text-white shadow-md scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            销售发货码单 (Sales)
          </button>
          <button
            type="button"
            id="tab-select-deposit"
            onClick={() => handleDocTypeChange(DocType.DEPOSIT)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              docType === DocType.DEPOSIT
                ? 'bg-sky-600 text-white shadow-md scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            定金单 (Deposit)
          </button>
        </div>
      </div>

      {/* Main Form Fields */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider border-l-3 border-sky-500 pl-3">
          第一部分：单据基本信息 (Metadata)
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              客户 <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                id="doc-customer-input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onFocus={() => setCustomerFocused(true)}
                onBlur={() => setTimeout(() => setCustomerFocused(false), 200)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium"
                placeholder="请输入客户"
                autoComplete="off"
                required
              />
              {customerFocused && customerSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {customerSuggestions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); setCustomerName(name); setCustomerFocused(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors ${
                        name === customerName ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-700'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              开单日期
            </label>
            <input
              type="date"
              id="doc-date-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600"
            />
          </div>

          {docType === DocType.SALES && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <span className="text-amber-500 font-bold">¥</span>
              预收订金 (元)
            </label>
            <input
              type="number"
              step="any"
              id="doc-deposit-input"
              value={deposit || ''}
              onChange={(e) => setDeposit(e.target.value === '' ? 0 : parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-mono text-slate-700"
              placeholder="0.00"
            />
          </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-slate-400" />
              单据编号 <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.2 rounded-xs">手动</span>
            </label>
            <input
              type="text"
              id="doc-no-input"
              value={docNo}
              onChange={(e) => { setDocNo(e.target.value); docNoManualRef.current = true; }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-mono text-slate-700"
              placeholder={`如 ${docNoPrefix}-20260708-001`}
            />
          </div>

        </div>
      </div>

      {/* Grid Entries Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-3 space-y-2 overflow-hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider border-l-3 border-sky-500 pl-3">
            第二部分：多记录明细录入表 (Rows Details)
          </h3>
          <span className="text-xs text-slate-400">
            金额将自动计算：金额 = 米数 × 单价。输入已知货号可快捷带出品名参数。
          </span>
        </div>

        {/* Desktop-specific Grid Table (hidden on mobile, shown on md and larger) */}
        <div className="hidden md:block overflow-x-auto border border-slate-100 rounded-xl">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-slate-50 text-slate-700 border-b border-slate-100">
                <th className="py-1.5 px-3 text-xs font-bold text-center w-12">序号</th>
                <th className="py-1.5 px-2 text-xs font-bold w-[110px]">货号 <span className="text-rose-400">*</span></th>
                <th className="py-1.5 px-2 text-xs font-bold w-[100px]">色号</th>
                <th className="py-1.5 px-3 text-xs font-bold w-[160px]">品名</th>
                
                {/* Condition Columns */}
                {docType === DocType.SAMPLE ? (
                  <>
                    <th className="py-1.5 px-2 text-xs font-bold w-[130px]">成分</th>
                    <th className="py-1.5 px-2 text-xs font-bold w-[90px]">克重</th>
                    <th className="py-1.5 px-2 text-xs font-bold w-[90px]">门幅 (cm)</th>
                  </>
                ) : docType === DocType.SALES ? (
                  <th className="py-1.5 px-2 text-xs font-bold w-[280px]">各匹米数 (米数)</th>
                ) : null}

                <th className="py-1.5 px-2 text-xs font-bold w-[90px]">米数 (米)</th>
                {docType === DocType.SALES && (
                <th className="py-1.5 px-2 text-xs font-bold w-[80px]">扣损 (米)</th>
                )}
                <th className="py-1.5 px-2 text-xs font-bold w-[90px]">单价 (元)</th>
                <th className="py-1.5 px-3 text-xs font-bold w-[110px]">金额 (元)</th>
                {docType !== DocType.DEPOSIT && (
                <th className="py-1.5 px-2 text-xs font-bold min-w-[120px]">备注</th>
                )}
                <th className="py-1.5 px-3 text-xs font-bold text-center w-12">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((item, index) => {
                const sample = item as SampleItem;
                const sales = item as SalesItem;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-1.5 px-3 text-xs text-slate-400 text-center font-medium">
                      {index + 1}
                    </td>
                    
                    {/* Item No */}
                    <td className="py-1.5 px-1">
                      <input
                        type="text"
                        value={item.itemNo}
                        onChange={(e) => handleCellChange(index, 'itemNo', e.target.value)}
                        placeholder="如 DF-801"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-medium"
                        id={`input-itemNo-${index}`}
                      />
                    </td>

                    {/* Color No */}
                    <td className="py-1.5 px-1">
                      <input
                        type="text"
                        value={item.colorNo}
                        onChange={(e) => handleCellChange(index, 'colorNo', e.target.value)}
                        placeholder="12# 藏蓝"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600"
                        id={`input-colorNo-${index}`}
                      />
                    </td>

                    {/* Product Name */}
                    <td className="py-1.5 px-1">
                      <input
                        type="text"
                        value={item.productName}
                        onChange={(e) => handleCellChange(index, 'productName', e.target.value)}
                        placeholder="精梳纯棉面料"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-700"
                        id={`input-productName-${index}`}
                      />
                    </td>

                    {/* Conditional Fields */}
                    {docType === DocType.SAMPLE ? (
                      <>
                        <td className="py-1.5 px-1">
                          <input
                            type="text"
                            value={sample.composition || ''}
                            onChange={(e) => handleCellChange(index, 'composition', e.target.value)}
                            placeholder="如 100%棉"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600"
                            id={`input-composition-${index}`}
                          />
                        </td>
                        <td className="py-1.5 px-1">
                          <input
                            type="text"
                            value={sample.weight || ''}
                            onChange={(e) => handleCellChange(index, 'weight', e.target.value)}
                            placeholder="210"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-600"
                            id={`input-weight-${index}`}
                          />
                        </td>
                        {/* Width */}
                        <td className="py-1.5 px-1">
                          <input
                            type="text"
                            value={(item as SampleItem).width}
                            onChange={(e) => handleCellChange(index, 'width', e.target.value)}
                            placeholder="180"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600"
                            id={`input-width-${index}`}
                          />
                        </td>
                      </>
                    ) : docType === DocType.SALES ? (
                      <td className="py-1.5 px-1">
                        <div className="grid grid-cols-5 gap-1 max-w-[280px]">
                          {(() => {
                            const count = getInputsCountForItem(item.id, sales.rollNo);
                            const tokens = sales.rollNo ? sales.rollNo.trim().split(/[,，\s]+/) : [];
                            const inputValues = Array.from({ length: count }).map((_, rIdx) => tokens[rIdx] || '');
                            return (
                              <>
                                {inputValues.map((val, rIdx) => (
                                  <input
                                    key={rIdx}
                                    type="text"
                                    value={val}
                                    placeholder={`#${rIdx + 1}`}
                                    onChange={(e) => {
                                      const rawVal = e.target.value;
                                      if (rawVal === '' || /^\d*\.?\d*$/.test(rawVal)) {
                                        const newTokens = [...tokens];
                                        while (newTokens.length <= rIdx) {
                                          newTokens.push('');
                                        }
                                        newTokens[rIdx] = rawVal.trim();
                                        const rollNoStr = newTokens.join(' ');

                                        // Recalculate meters
                                        let totalM = 0;
                                        for (const t of newTokens) {
                                          if (!t) continue;
                                          const v = parseFloat(t);
                                          if (!isNaN(v) && v > 0) {
                                            totalM += v;
                                          }
                                        }

                                        const updatedItems = [...items];
                                        const currentItem = { ...updatedItems[index] } as any;
                                        currentItem.rollNo = rollNoStr;
                                        currentItem.meters = parseFloat(totalM.toFixed(2));
                                        const netMeters = Math.max(0, currentItem.meters - (currentItem.deductionMeters || 0));
                                        currentItem.amount = parseFloat((netMeters * currentItem.price).toFixed(2));
                                        updatedItems[index] = currentItem;
                                        setItems(updatedItems);
                                      }
                                    }}
                                    className="w-full h-7 border border-slate-200 rounded text-center text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-sky-500 font-semibold text-slate-800"
                                  />
                                ))}
                                <button
                                  type="button"
                                  onClick={() => handleAddMoreRollInputs(item.id, count)}
                                  className="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[10px] font-bold border border-sky-100 transition-colors cursor-pointer whitespace-nowrap h-7 flex items-center justify-center"
                                  title="一次增加5个输入框"
                                >
                                  +5匹
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    ) : null}

                    {/* Meters (米数) */}
                    <td className="py-1.5 px-1">
                      <input
                        type="number"
                        step="any"
                        value={item.meters || ''}
                        onChange={(e) => handleCellChange(index, 'meters', e.target.value)}
                        placeholder="0.0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 text-right"
                        id={`input-meters-${index}`}
                      />
                    </td>

                    {/* Deduction Meters (Sales only) */}
                    {docType === DocType.SALES && (
                    <td className="py-1.5 px-1">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={(item as SalesItem).deductionMeters || ''}
                        onChange={(e) => handleCellChange(index, 'deductionMeters', e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-amber-200 rounded-md focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-mono text-amber-700 text-right"
                        id={`input-deduction-${index}`}
                      />
                    </td>
                    )}

                    {/* Price (单价) */}
                    <td className="py-1.5 px-1">
                      <input
                        type="number"
                        step="any"
                        value={item.price || ''}
                        onChange={(e) => handleCellChange(index, 'price', e.target.value)}
                        placeholder="0.0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 text-right"
                        id={`input-price-${index}`}
                      />
                    </td>

                    {/* Amount (金额, read-only) */}
                    <td className="py-1.5 px-3 text-xs font-mono text-right text-slate-800 font-bold bg-slate-50/30">
                      {item.amount > 0 ? `¥${item.amount.toFixed(2)}` : '¥0.00'}
                    </td>

                    {/* Remark */}
                    {docType !== DocType.DEPOSIT && (
                    <td className="py-1.5 px-1">
                      <input
                        type="text"
                        value={item.remark}
                        onChange={(e) => handleCellChange(index, 'remark', e.target.value)}
                        placeholder="附加备注..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-500"
                        id={`input-remark-${index}`}
                      />
                    </td>
                    )}

                    {/* Row Delete Action */}
                    <td className="py-1.5 px-3 text-center">
                      <button
                        type="button"
                        id={`btn-delete-row-${index}`}
                        onClick={() => deleteRow(index)}
                        className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                        title="删除此行"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile-optimized interactive card layout (hidden on md and larger) */}
        <div className="block md:hidden space-y-4">
          {items.map((item, index) => {
            const sample = item as SampleItem;
            const sales = item as SalesItem;
            return (
              <div key={item.id} className="bg-slate-50/50 rounded-2xl border border-slate-200 p-4 space-y-4 relative">
                {/* Header of mobile card */}
                <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5">
                  <span className="text-xs font-bold text-slate-500">
                    明细项目 #{index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteRow(index)}
                    className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                    title="删除此行"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Form fields grid */}
                <div className="grid grid-cols-2 gap-3.5">
                  
                  {/* Item No */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">
                      货号 <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={item.itemNo}
                      onChange={(e) => handleCellChange(index, 'itemNo', e.target.value)}
                      placeholder="如 DF-801"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-medium uppercase bg-white"
                    />
                  </div>

                  {/* Color No */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">色号</label>
                    <input
                      type="text"
                      value={item.colorNo}
                      onChange={(e) => handleCellChange(index, 'colorNo', e.target.value)}
                      placeholder="12# 藏蓝"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600 bg-white"
                    />
                  </div>

                  {/* Product Name */}
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">品名</label>
                    <input
                      type="text"
                      value={item.productName}
                      onChange={(e) => handleCellChange(index, 'productName', e.target.value)}
                      placeholder="精梳纯棉面料"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-700 bg-white"
                    />
                  </div>

                  {/* Conditionals */}
                  {docType === DocType.SAMPLE ? (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 block">成分</label>
                        <input
                          type="text"
                          value={sample.composition || ''}
                          onChange={(e) => handleCellChange(index, 'composition', e.target.value)}
                          placeholder="如 100%棉"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600 bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 block">克重</label>
                        <input
                          type="text"
                          value={sample.weight || ''}
                          onChange={(e) => handleCellChange(index, 'weight', e.target.value)}
                          placeholder="210"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-600 bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 block">门幅 (cm)</label>
                        <input
                          type="text"
                          value={sample.width}
                          onChange={(e) => handleCellChange(index, 'width', e.target.value)}
                          placeholder="180"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600 bg-white"
                        />
                      </div>
                    </>
                  ) : docType === DocType.SALES ? (
                    <div className="col-span-2 space-y-1 bg-slate-100/50 p-2.5 rounded-xl border border-slate-200">
                      <label className="text-[10px] font-bold text-slate-500 block">各匹米数 (数值自动累加到下方米数)</label>
                      <div className="grid grid-cols-5 gap-1 mt-1">
                        {(() => {
                          const count = getInputsCountForItem(item.id, sales.rollNo);
                          const tokens = sales.rollNo ? sales.rollNo.trim().split(/[,，\s]+/) : [];
                          const inputValues = Array.from({ length: count }).map((_, rIdx) => tokens[rIdx] || '');
                          return (
                            <>
                              {inputValues.map((val, rIdx) => (
                                <input
                                  key={rIdx}
                                  type="text"
                                  value={val}
                                  placeholder={`#${rIdx + 1}`}
                                  onChange={(e) => {
                                    const rawVal = e.target.value;
                                    if (rawVal === '' || /^\d*\.?\d*$/.test(rawVal)) {
                                      const newTokens = [...tokens];
                                      while (newTokens.length <= rIdx) {
                                        newTokens.push('');
                                      }
                                      newTokens[rIdx] = rawVal.trim();
                                      const rollNoStr = newTokens.join(' ');

                                      // Recalculate meters
                                      let totalM = 0;
                                      for (const t of newTokens) {
                                        if (!t) continue;
                                        const v = parseFloat(t);
                                        if (!isNaN(v) && v > 0) {
                                          totalM += v;
                                        }
                                      }

                                      const updatedItems = [...items];
                                      const currentItem = { ...updatedItems[index] } as any;
                                      currentItem.rollNo = rollNoStr;
                                      currentItem.meters = parseFloat(totalM.toFixed(2));
                                      currentItem.amount = parseFloat((currentItem.meters * currentItem.price).toFixed(2));
                                      updatedItems[index] = currentItem;
                                      setItems(updatedItems);
                                    }
                                  }}
                                  className="w-full h-7 border border-slate-200 rounded text-center text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-sky-500 font-semibold text-slate-800 bg-white"
                                />
                              ))}
                              <button
                                type="button"
                                onClick={() => handleAddMoreRollInputs(item.id, count)}
                                className="px-2 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[10px] font-bold border border-sky-100 transition-colors cursor-pointer whitespace-nowrap h-7 flex items-center justify-center"
                                title="一次增加5个输入框"
                              >
                                +5匹
                              </button>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">米数 (米)</label>
                    <input
                      type="number"
                      step="any"
                      value={item.meters || ''}
                      onChange={(e) => handleCellChange(index, 'meters', e.target.value)}
                      placeholder="0.0"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 bg-white"
                    />
                  </div>

                  {/* Deduction Meters (Sales mobile) */}
                  {docType === DocType.SALES && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-amber-500 block">扣损 (米)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={(item as SalesItem).deductionMeters || ''}
                      onChange={(e) => handleCellChange(index, 'deductionMeters', e.target.value)}
                      placeholder="0"
                      className="w-full px-2.5 py-1.5 border border-amber-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs font-mono text-amber-700 bg-white"
                    />
                  </div>
                  )}

                  {/* Price & Amount */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">单价 (元/米)</label>
                    <input
                      type="number"
                      step="any"
                      value={item.price || ''}
                      onChange={(e) => handleCellChange(index, 'price', e.target.value)}
                      placeholder="0.0"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">自动算得金额</label>
                    <div className="px-2.5 py-1.5 border border-slate-200/60 bg-slate-100/60 rounded-lg text-xs font-mono font-bold text-slate-700 h-[34px] flex items-center">
                      {item.amount > 0 ? `¥${item.amount.toFixed(2)}` : '¥0.00'}
                    </div>
                  </div>

                  {/* Remark */}
                  {docType !== DocType.DEPOSIT && (
                  <div className="col-span-2 space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 block">备注</label>
                    <input
                      type="text"
                      value={item.remark}
                      onChange={(e) => handleCellChange(index, 'remark', e.target.value)}
                      placeholder="附加备注..."
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-500 bg-white"
                    />
                  </div>
                  )}

                </div>
              </div>
            );
          })}
        </div>

        {/* Row Operations Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex gap-2.5">
            <button
              type="button"
              id="btn-add-detail-row"
              onClick={addRow}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs"
            >
              <Plus className="w-4 h-4" />
              追加一行
            </button>
            
            <button
              type="button"
              id="btn-clear-detail-rows"
              onClick={clearAllRows}
              className="px-3 py-2 border border-slate-200 hover:border-slate-300 text-slate-500 hover:text-slate-800 rounded-lg text-xs font-medium cursor-pointer"
            >
              清空明细
            </button>
          </div>

          {/* Quick-Sum Visual Panel */}
          <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-2 flex flex-wrap items-center gap-4 text-sm text-slate-600 font-medium">
            <div className="flex items-center gap-1">
              <span>总匹数：</span>
              <strong className="text-slate-800 font-bold">{totalRolls} 匹</strong>
            </div>
            <div className="flex items-center gap-1">
              <span>总计米数：</span>
              <strong className="text-sky-700 font-extrabold">{totalMeters.toFixed(2)} 米</strong>
            </div>
            {docType === DocType.SALES && totalDeduction > 0 && (
            <div className="flex items-center gap-1 bg-amber-50/60 px-2 py-0.5 rounded-md">
              <span className="text-amber-600 text-xs">扣损合计：</span>
              <strong className="text-amber-700 font-bold text-xs">-{totalDeduction.toFixed(2)} 米</strong>
            </div>
            )}
            <div className="flex items-center gap-1">
              <span>合计金额：</span>
              <strong className="text-rose-600 font-bold">¥{totalAmount.toFixed(2)}</strong>
            </div>
            {docType === DocType.DEPOSIT ? (
              <div className="flex items-center gap-2 border-l border-slate-200 pl-4 bg-sky-50/40 px-2 py-0.5 rounded-md">
                <span className="text-sky-700 text-sm whitespace-nowrap">定金比例</span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  value={deposit || ''}
                  onChange={(e) => setDeposit(parseFloat(e.target.value) || 0)}
                  className="w-16 px-2 py-0.5 border border-slate-200 rounded-md text-center text-sm font-bold text-sky-700"
                />
                <span className="text-sky-600 text-sm">%</span>
                <span className="text-sky-800 text-xs ml-1">
                  = ¥{((totalAmount * (deposit || 0)) / 100).toFixed(2)}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1 border-l border-slate-200 pl-4 bg-amber-50/40 px-2 py-0.5 rounded-md">
                <span className="text-amber-800">应付款：</span>
                <strong className="text-amber-700 font-extrabold text-base">¥{receivableAmount.toFixed(2)}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Part 3: Signature & Contact Info */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4">
        <h3
          className="text-sm font-semibold text-slate-800 uppercase tracking-wider border-l-3 border-sky-500 pl-3 cursor-pointer flex items-center justify-between"
          onClick={() => setPart3Open(!part3Open)}
        >
          <span>第三部分：单据签署与联系信息</span>
          <span className="text-slate-400 text-xs normal-case">{part3Open ? '收起 ▲' : '展开 ▼'}</span>
        </h3>
        {part3Open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              开单人（签字）
            </label>
            <input
              type="text"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              placeholder="开单人姓名"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              收货人（签字）
            </label>
            <input
              type="text"
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              placeholder="收货人姓名"
            />
          </div>
          {docType === DocType.DEPOSIT && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              收货地址
            </label>
            <input
              type="text"
              value={receiverAddress}
              onChange={(e) => setReceiverAddress(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              placeholder="请输入收货地址"
            />
          </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              底部联系电话
            </label>
            <input
              type="text"
              value={bottomPhone}
              onChange={(e) => setBottomPhone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              placeholder="如 0575-81234567"
            />
          </div>
        </div>
        )}
      </div>

      {/* Save / Cancel Action Bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex items-center justify-end gap-3">
        <button
          type="button"
          id="btn-cancel-doc-editing"
          onClick={onCancel}
          className="px-5 py-2.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold cursor-pointer"
        >
          取消返回
        </button>

        <button
          type="button"
          id="btn-submit-save-doc"
          onClick={handleSave}
          className="px-6 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all duration-150"
        >
          <Save className="w-4.5 h-4.5" />
          {existingDocument ? '保存修改并更新' : '完成录入并保存到数据库'}
        </button>
      </div>
    </div>
  );
}
