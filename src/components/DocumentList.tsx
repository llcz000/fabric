/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { DocumentData, DocType } from '../types';
import { 
  Search, Filter, Calendar, Trash2, Edit2, Eye, Copy, 
  Upload, Download, FileSpreadsheet, PlusCircle, RefreshCw, 
  Database, Tag, ChevronRight, AlertCircle, TrendingUp
} from 'lucide-react';

interface DocumentListProps {
  documents: DocumentData[];
  onSelect: (doc: DocumentData) => void;
  onEdit: (doc: DocumentData) => void;
  onDelete: (id: string) => void;
  onDuplicate: (doc: DocumentData) => void;
  onCreateNew: () => void;
  onImportBackup: (backupDocs: DocumentData[]) => void;
}

export default function DocumentList({
  documents,
  onSelect,
  onEdit,
  onDelete,
  onDuplicate,
  onCreateNew,
  onImportBackup,
}: DocumentListProps) {
  // Filters state
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterItemNo, setFilterItemNo] = useState('');
  const [filterColorNo, setFilterColorNo] = useState('');
  const [filterProductName, setFilterProductName] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | DocType>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Flat item rows representing individual record rows
  const allItems = React.useMemo(() => {
    const rows: {
      id: string;
      docId: string;
      docNo: string;
      date: string;
      type: DocType;
      customerName: string;
      itemNo: string;
      colorNo: string;
      productName: string;
      composition: string;
      weight: string;
      width: string;
      meters: number;
      price: number;
      amount: number;
      rollNo?: string;
      remark: string;
      doc: DocumentData;
    }[] = [];

    documents.forEach((doc) => {
      doc.items.forEach((item) => {
        rows.push({
          id: item.id,
          docId: doc.id,
          docNo: doc.docNo,
          date: doc.date,
          type: doc.type,
          customerName: doc.customerName,
          itemNo: item.itemNo || '',
          colorNo: item.colorNo || '',
          productName: item.productName || '',
          composition: 'composition' in item ? (item as any).composition || '' : '',
          weight: 'weight' in item ? (item as any).weight || '' : '',
          width: item.width || '',
          meters: item.meters || 0,
          price: item.price || 0,
          amount: item.amount || 0,
          rollNo: 'rollNo' in item ? (item as any).rollNo || '' : '',
          remark: item.remark || '',
          doc: doc,
        });
      });
    });

    return rows;
  }, [documents]);

  // Filter logic on individual item records
  const filteredItems = React.useMemo(() => {
    return allItems.filter((item) => {
      const matchesCustomer = !filterCustomer || item.customerName.toLowerCase().includes(filterCustomer.toLowerCase());
      const matchesItemNo = !filterItemNo || item.itemNo.toLowerCase().includes(filterItemNo.toLowerCase());
      const matchesColorNo = !filterColorNo || item.colorNo.toLowerCase().includes(filterColorNo.toLowerCase());
      const matchesProductName = !filterProductName || item.productName.toLowerCase().includes(filterProductName.toLowerCase());
      
      const matchesType = typeFilter === 'all' || item.type === typeFilter;
      const matchesStartDate = !startDate || item.date >= startDate;
      const matchesEndDate = !endDate || item.date <= endDate;

      return matchesCustomer && matchesItemNo && matchesColorNo && matchesProductName && matchesType && matchesStartDate && matchesEndDate;
    });
  }, [allItems, filterCustomer, filterItemNo, filterColorNo, filterProductName, typeFilter, startDate, endDate]);

  // Helper to calculate roll count for a single record row
  const getRollCount = (item: { type: DocType; rollNo?: string; meters: number }) => {
    if (item.type === DocType.SAMPLE) {
      return 1;
    }
    const rollNoStr = item.rollNo;
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

  // Calculate stats on the filtered subset of individual item records
  const totalMeters = filteredItems.reduce((sum, item) => sum + item.meters, 0);
  const totalAmount = filteredItems.reduce((sum, item) => sum + item.amount, 0);
  const totalRollsCount = React.useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + getRollCount(item), 0);
  }, [filteredItems]);

  // Backup exporter
  const handleExportBackup = () => {
    if (documents.length === 0) {
      alert('数据库中暂无单据可导出备份。');
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(documents, null, 2));
    const downloadAnchor = window.document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `面料单据数据库备份-${new Date().toISOString().split('T')[0]}.json`);
    window.document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Backup importer
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);

        if (Array.isArray(parsed)) {
          const looksValid = parsed.every(d => d.id && 'docNo' in d && d.items && Array.isArray(d.items));
          if (looksValid) {
            onImportBackup(parsed);
            alert(`成功导入！共 ${parsed.length} 张单据。`);
          } else {
            alert('格式错误，请使用「导出备份」生成的文件。');
          }
        } else {
          alert('格式错误，请使用「导出备份」生成的文件。');
        }
      } catch (err) {
        alert('无法解析文件。');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // reset
  };

  // Reset filters
  const resetFilters = () => {
    setFilterCustomer('');
    setFilterItemNo('');
    setFilterColorNo('');
    setFilterProductName('');
    setTypeFilter('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div id="document-list-container" className="space-y-6">
      
      {/* 1. Header with Stats Metrics bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Metric 1 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              单据库存储总量
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-extrabold text-slate-800">{documents.length}</span>
              <span className="text-xs text-slate-500 font-medium">份单据</span>
            </div>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              筛选结果总计数
            </span>
            <div className="flex items-center gap-4 mt-1">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-slate-800">{totalMeters.toFixed(1)}</span>
                <span className="text-xs text-teal-600 font-bold">米 (Meters)</span>
              </div>
              <div className="border-l border-slate-200 h-6"></div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-indigo-600">{totalRollsCount}</span>
                <span className="text-xs text-slate-500 font-bold">匹 (Rolls)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
            <FileSpreadsheet className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-400 block uppercase tracking-wider">
              筛选账目应收合计
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-extrabold text-rose-600">¥{totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Database Filter & Search Toolkit */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-sky-600" />
            快速检索与数据库归档过滤
          </h3>
          
          {/* Data import/export panel */}
          <div className="flex items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              type="button"
              id="btn-import-backup"
              onClick={handleImportClick}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors"
              title="从备份的JSON文件中恢复完整的单据数据库"
            >
              <Upload className="w-3.5 h-3.5" />
              导入备份
            </button>
            
            <button
              type="button"
              id="btn-export-backup"
              onClick={handleExportBackup}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors"
              title="下载整个本地单据库的备份副本"
            >
              <Download className="w-3.5 h-3.5" />
              导出备份
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Customer filter */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">客户</div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                id="db-search-customer"
                value={filterCustomer}
                onChange={(e) => setFilterCustomer(e.target.value)}
                placeholder="检索客户..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-700 font-medium placeholder-slate-400 bg-slate-50/50"
              />
            </div>
          </div>

          {/* Item no filter */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">货号 (Item No)</div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                id="db-search-item-no"
                value={filterItemNo}
                onChange={(e) => setFilterItemNo(e.target.value)}
                placeholder="检索货号..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-700 font-medium placeholder-slate-400 bg-slate-50/50"
              />
            </div>
          </div>

          {/* Color no filter */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">色号</div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                id="db-search-color-no"
                value={filterColorNo}
                onChange={(e) => setFilterColorNo(e.target.value)}
                placeholder="检索色号..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-700 font-medium placeholder-slate-400 bg-slate-50/50"
              />
            </div>
          </div>

          {/* Product name filter */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">品名</div>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                id="db-search-product-name"
                value={filterProductName}
                onChange={(e) => setFilterProductName(e.target.value)}
                placeholder="检索品名..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-700 font-medium placeholder-slate-400 bg-slate-50/50"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
          {/* Doc Type Selection */}
          <div>
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">单据类型</div>
            <select
              id="db-type-filter"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 bg-white cursor-pointer"
            >
              <option value="all">全部类型</option>
              <option value={DocType.SAMPLE}>样布码单</option>
              <option value={DocType.SALES}>销售发货码单</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="relative">
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">起始日期</div>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                id="db-start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 bg-white"
              />
            </div>
          </div>

          {/* End Date */}
          <div className="relative">
            <div className="text-xs font-bold text-slate-500 mb-1.5 ml-1">截止日期</div>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                id="db-end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Clear filters trigger */}
        {(filterCustomer || filterItemNo || filterColorNo || filterProductName || typeFilter !== 'all' || startDate || endDate) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              id="btn-clear-filters"
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-sky-600 font-medium cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              清空搜索与过滤条件
            </button>
          </div>
        )}
      </div>

      {/* 3. Document Data Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-12 text-center max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 text-slate-400 flex items-center justify-center mx-auto border border-slate-100">
              <Database className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-base font-bold text-slate-700">没有查找到匹配的明细记录</h4>
              <p className="text-sm text-slate-400 mt-1">
                数据库中暂无符合当前筛选条件的货品或明细记录。请调整过滤检索词，或重新录入新单据。
              </p>
            </div>
            
            <button
              type="button"
              id="btn-create-initial-doc"
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold cursor-pointer shadow-sm hover:shadow-md transition-all duration-150"
            >
              <PlusCircle className="w-4 h-4" />
              立即录入新单据
            </button>
          </div>
        ) : (
          <div>
            {/* Desktop Table View (hidden on mobile, shown on md and larger) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-700 text-xs font-bold uppercase tracking-wider border-b border-slate-100">
                    <th className="py-3.5 px-4">开单日期</th>
                    <th className="py-3.5 px-4">单据编号</th>
                    <th className="py-3.5 px-4">客户</th>
                    <th className="py-3.5 px-3">货号</th>
                    <th className="py-3.5 px-3">色号</th>
                    <th className="py-3.5 px-3">品名</th>
                    <th className="py-3.5 px-3 text-right">米数</th>
                    <th className="py-3.5 px-3 text-right">单价</th>
                    <th className="py-3.5 px-3 text-right">合计金额</th>
                    <th className="py-3.5 px-4">备注</th>
                    <th className="py-3.5 px-4 text-center w-[150px]">系统操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredItems.map((item, index) => {
                    const isSample = item.type === DocType.SAMPLE;
                    return (
                      <tr key={`${item.docId}-${item.id}-${index}`} className="hover:bg-slate-50/40 transition-colors group">
                        {/* Date */}
                        <td className="py-3 px-4 text-slate-500 text-xs whitespace-nowrap">
                          {item.date.substring(0, 10)}
                        </td>

                        {/* Doc No */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-800 text-xs">
                              {item.docNo}
                            </span>
                            <span className="text-[9px] text-slate-400 mt-0.5">
                              {isSample ? '样布码单' : '发货码单'}
                            </span>
                          </div>
                        </td>

                        {/* Customer */}
                        <td className="py-3 px-4 font-extrabold text-slate-700 max-w-[140px] truncate">
                          {item.customerName}
                        </td>

                        {/* Item No (货号) */}
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          {item.itemNo || '-'}
                        </td>

                        {/* Color No (色号) */}
                        <td className="py-3 px-3">
                          {item.colorNo ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 ">
                              {item.colorNo}
                            </span>
                          ) : '-'}
                        </td>

                        {/* Product Name (品名) */}
                        <td className="py-3 px-3 font-medium text-slate-600 max-w-[120px] truncate">
                          {item.productName || '-'}
                        </td>

                        {/* Meters (米数) */}
                        <td className="py-3 px-3 text-right text-sky-700 font-extrabold text-xs">
                          {item.meters.toFixed(2)} 米
                        </td>

                        {/* Price (单价) */}
                        <td className="py-3 px-3 text-right text-slate-500 font-medium text-xs">
                          ¥{item.price.toFixed(2)}
                        </td>

                        {/* Amount (金额) */}
                        <td className="py-3 px-3 text-right text-rose-600 font-extrabold text-xs">
                          ¥{item.amount.toFixed(2)}
                        </td>

                        {/* Remark (备注) */}
                        <td className="py-3 px-4 text-slate-500 text-xs max-w-[150px] truncate">
                          <span>{item.remark || item.composition || item.weight || '-'}</span>
                        </td>

                        {/* Actions toolbox */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1">
                            
                            {/* Preview / View */}
                            <button
                              type="button"
                              id={`btn-list-view-${item.id}`}
                              onClick={() => onSelect(item.doc)}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-sky-600 rounded-lg cursor-pointer transition-colors"
                              title="查看排版预览及打印"
                            >
                              <Eye className="w-4 h-4" />
                            </button>

                            {/* Edit */}
                            <button
                              type="button"
                              id={`btn-list-edit-${item.id}`}
                              onClick={() => onEdit(item.doc)}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-amber-600 rounded-lg cursor-pointer transition-colors"
                              title="编辑此单"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {/* Duplicate */}
                            <button
                              type="button"
                              id={`btn-list-duplicate-${item.id}`}
                              onClick={() => onDuplicate(item.doc)}
                              className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-teal-600 rounded-lg cursor-pointer transition-colors"
                              title="复制并以此创建新单 (快捷模板)"
                            >
                              <Copy className="w-4 h-4" />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              id={`btn-list-delete-${item.id}`}
                              onClick={() => onDelete(item.docId)}
                              className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer transition-colors"
                              title="删除整个单据"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (shown on screens smaller than md) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredItems.map((item, index) => {
                const isSample = item.type === DocType.SAMPLE;
                return (
                  <div key={`${item.docId}-${item.id}-${index}`} className="p-5 space-y-3 hover:bg-slate-50/40 transition-colors">
                    {/* Card Header: DocNo and Type Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-sm">
                          {item.docNo}
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          日期: {item.date.substring(0, 10)}
                        </span>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                        isSample 
                          ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}>
                        <Tag className="w-3 h-3" />
                        {isSample ? '样布' : '发货'}
                      </span>
                    </div>

                    {/* Customer Unit */}
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">客户</span>
                      <span className="text-sm font-extrabold text-slate-700">{item.customerName}</span>
                    </div>

                    {/* Product Details Row */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50/70 p-2.5 rounded-xl border border-slate-100 text-center">
                      <div>
                        <div className="text-[10px] text-slate-400 font-medium">货号</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">{item.itemNo || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 font-medium">色号</div>
                        <div className="text-xs font-bold text-indigo-600 mt-0.5">{item.colorNo || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 font-medium">品名</div>
                        <div className="text-xs font-medium text-slate-700 truncate mt-0.5">{item.productName || '-'}</div>
                      </div>
                    </div>

                    {/* Metrics/Math Row */}
                    <div className="grid grid-cols-3 gap-2 text-center pt-1">
                      <div>
                        <span className="text-[9px] text-slate-400 block">实发米数</span>
                        <span className="text-xs font-extrabold text-sky-700">{item.meters.toFixed(2)} m</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block">发货单价</span>
                        <span className="text-xs font-medium text-slate-500">¥{item.price.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-400 block">结算金额</span>
                        <span className="text-xs font-extrabold text-rose-600">¥{item.amount.toFixed(2)}</span>
                      </div>
                    </div>

                    {item.rollNo || item.remark ? (
                      <div className="text-xs bg-slate-50/40 p-2 rounded-lg border border-slate-100 text-slate-500">
                        {item.rollNo && <span className="text-teal-600 font-bold mr-1">[匹号: {item.rollNo}]</span>}
                        {item.remark || item.composition || item.weight}
                      </div>
                    ) : null}

                    {/* Card Footer Actions Row - Touch optimized size */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100/60">
                      <button
                        type="button"
                        onClick={() => onSelect(item.doc)}
                        className="flex-1 py-2 text-xs font-semibold text-sky-600 hover:bg-sky-50 rounded-xl flex items-center justify-center gap-1 transition-colors"
                      >
                        <Eye className="w-4 h-4" />
                        查看单据
                      </button>

                      <button
                        type="button"
                        onClick={() => onEdit(item.doc)}
                        className="flex-1 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50/50 rounded-xl flex items-center justify-center gap-1 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                        修改单据
                      </button>

                      <button
                        type="button"
                        onClick={() => onDuplicate(item.doc)}
                        className="flex-1 py-2 text-xs font-semibold text-teal-600 hover:bg-teal-50/50 rounded-xl flex items-center justify-center gap-1 transition-colors"
                      >
                        <Copy className="w-4 h-4" />
                        复制模板
                      </button>

                      <button
                        type="button"
                        onClick={() => onDelete(item.docId)}
                        className="px-3 py-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl flex items-center justify-center transition-colors"
                        title="删除整个单据"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
