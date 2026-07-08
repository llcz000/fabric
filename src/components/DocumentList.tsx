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

  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  // Filter documents: whether any item matches AND doc-level fields match
  const filteredDocs = React.useMemo(() => {
    return documents.filter((doc) => {
      // Doc-level filters
      const matchesType = typeFilter === 'all' || doc.type === typeFilter;
      const matchesStartDate = !startDate || doc.date >= startDate;
      const matchesEndDate = !endDate || doc.date <= endDate;

      if (!matchesType || !matchesStartDate || !matchesEndDate) return false;

      // If no item-level filters, include all docs matching doc-level filters
      const hasItemFilters = filterCustomer || filterItemNo || filterColorNo || filterProductName;

      if (!hasItemFilters) return true;

      // Check if any item matches item-level filters
      return doc.items.some((item) => {
        const matchesCustomer = !filterCustomer || (doc.customerName || '').toLowerCase().includes(filterCustomer.toLowerCase());
        const matchesItemNo = !filterItemNo || (item.itemNo || '').toLowerCase().includes(filterItemNo.toLowerCase());
        const matchesColorNo = !filterColorNo || (item.colorNo || '').toLowerCase().includes(filterColorNo.toLowerCase());
        const matchesProductName = !filterProductName || (item.productName || '').toLowerCase().includes(filterProductName.toLowerCase());
        return matchesCustomer && matchesItemNo && matchesColorNo && matchesProductName;
      });
    });
  }, [documents, filterCustomer, filterItemNo, filterColorNo, filterProductName, typeFilter, startDate, endDate]);

  // Expand all matching docs by default when filters change
  React.useEffect(() => {
    const ids = filteredDocs.map(d => d.id).join(',');
    setExpandedDocs(new Set(filteredDocs.map(d => d.id)));
  }, [documents.length, filterCustomer, filterItemNo, filterColorNo, filterProductName, typeFilter, startDate, endDate]); // eslint-disable-line

  const toggleExpand = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  // Get matching items for a document
  const getDocMatchingItems = (doc: DocumentData) => {
    const hasFilters = filterCustomer || filterItemNo || filterColorNo || filterProductName;
    if (!hasFilters) return doc.items;
    return doc.items.filter((item) => {
      const matchesCustomer = !filterCustomer || (doc.customerName || '').toLowerCase().includes(filterCustomer.toLowerCase());
      const matchesItemNo = !filterItemNo || (item.itemNo || '').toLowerCase().includes(filterItemNo.toLowerCase());
      const matchesColorNo = !filterColorNo || (item.colorNo || '').toLowerCase().includes(filterColorNo.toLowerCase());
      const matchesProductName = !filterProductName || (item.productName || '').toLowerCase().includes(filterProductName.toLowerCase());
      return matchesCustomer && matchesItemNo && matchesColorNo && matchesProductName;
    });
  };

  // Stats based on filtered matching items (not whole docs)
  const statsItems = React.useMemo(() => {
    const items: { meters: number; amount: number; type: DocType; rollNo?: string }[] = [];
    filteredDocs.forEach(doc => {
      getDocMatchingItems(doc).forEach(item => {
        items.push({ meters: item.meters, amount: item.amount, type: doc.type, rollNo: (item as any).rollNo });
      });
    });
    return items;
  }, [filteredDocs, filterCustomer, filterItemNo, filterColorNo, filterProductName]); // eslint-disable-line

  const totalMeters = statsItems.reduce((sum, item) => sum + (item.meters || 0), 0);
  const totalAmount = statsItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const totalRollsCount = statsItems.reduce((sum, item) => {
    if (item.type === DocType.SAMPLE) return sum + 1;
    const rollStr = item.rollNo || '';
    const count = rollStr.trim().split(/[,，\s]+/).filter((t: string) => /^\d+(\.\d+)?$/.test(t) && parseFloat(t) > 0).length || 0;
    return sum + count;
  }, 0);

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
        {filteredDocs.length === 0 ? (
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
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-xs text-slate-500">
                  {filteredDocs.length} 张单据
                  {filterCustomer || filterItemNo || filterColorNo || filterProductName ? ' (已筛选)' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const allExpanded = filteredDocs.every(d => expandedDocs.has(d.id));
                    if (allExpanded) {
                      setExpandedDocs(new Set());
                    } else {
                      setExpandedDocs(new Set(filteredDocs.map(d => d.id)));
                    }
                  }}
                  className="text-xs text-sky-600 hover:text-sky-800 font-medium cursor-pointer"
                >
                  {filteredDocs.length > 0 && filteredDocs.every(d => expandedDocs.has(d.id)) ? '收起全部' : '展开全部'}
                </button>
              </div>
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="bg-slate-50/80 text-slate-700 text-xs font-bold uppercase tracking-wider border-b border-slate-100">
                    <th className="py-3.5 px-2 text-center w-[30px]"></th>
                    <th className="py-3.5 px-2" style={{ width: '14%' }}>开单日期</th>
                    <th className="py-3.5 px-2" style={{ width: '14%' }}>单据编号</th>
                    <th className="py-3.5 px-1 text-center" style={{ width: '8%' }}>类型</th>
                    <th className="py-3.5 px-2" style={{ width: '14%' }}>客户</th>
                    <th className="py-3.5 px-2 text-right" style={{ width: '14%' }}>总计米数</th>
                    <th className="py-3.5 px-2 text-right" style={{ width: '14%' }}>合计金额</th>
                    <th className="py-3.5 px-2 text-center w-[160px]" style={{ width: '160px' }}>操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredDocs.map((doc) => {
                    const isSample = doc.type === DocType.SAMPLE;
                    const isExpanded = expandedDocs.has(doc.id);
                    const matchingItems = getDocMatchingItems(doc);

                    return (
                      <React.Fragment key={doc.id}>
                        {/* Document summary row */}
                        <tr
                          className="hover:bg-slate-50/60 transition-colors cursor-pointer group"
                          onClick={() => toggleExpand(doc.id)}
                        >
                          <td className="py-3 px-2 text-center text-slate-400 text-xs">
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td className="py-3 px-2 text-slate-500 text-xs whitespace-nowrap">
                            {doc.date.substring(0, 10)}
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-800 text-xs">{doc.docNo || '-'}</span>
                              <span className="text-[9px] text-slate-400 mt-0.5">{matchingItems.length} 条记录</span>
                            </div>
                          </td>
                          <td className="py-3 px-1 text-center">
                            <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold ${
                              isSample
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                            }`}>
                              {isSample ? '样布' : '发货'}
                            </span>
                          </td>
                          <td className="py-3 px-2 font-extrabold text-slate-700 max-w-[100px] truncate text-xs">
                            {doc.customerName}
                          </td>
                          <td className="py-3 px-2 text-right text-sky-700 font-extrabold text-xs">
                            {doc.totalMeters.toFixed(2)} 米
                          </td>
                          <td className="py-3 px-2 text-right text-rose-600 font-extrabold text-xs">
                            ¥{doc.totalAmount.toFixed(2)}
                          </td>
                          <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              <button type="button" onClick={() => onSelect(doc)}
                                className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-sky-600 rounded-lg" title="查看">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => onEdit(doc)}
                                className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-amber-600 rounded-lg" title="编辑">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => onDuplicate(doc)}
                                className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-teal-600 rounded-lg" title="复制">
                                <Copy className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => onDelete(doc.id)}
                                className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg" title="删除">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded item rows */}
                        {isExpanded && (
                          <>
                            <tr className="bg-slate-100/60 text-[10px] font-bold text-slate-500 uppercase">
                              <td className="py-1.5 px-1 text-center"></td>
                              <td className="py-1.5 px-1">货号</td>
                              <td className="py-1.5 px-1 text-center">色号</td>
                              <td className="py-1.5 px-1">品名</td>
                              <td className="py-1.5 px-1 text-center">匹数</td>
                              <td className="py-1.5 px-1 text-right">米数</td>
                              <td className="py-1.5 px-1 text-right">单价</td>
                              <td className="py-1.5 px-1 text-right">金额</td>
                            </tr>
                            {matchingItems.map((item, idx) => {
                              const rollCount = doc.type === DocType.SAMPLE ? 1 :
                                ((item.rollNo || '').trim().split(/[,，\s]+/).filter((t: string) => /^\d+(\.\d+)?$/.test(t) && parseFloat(t) > 0).length || 0);
                              return (
                              <tr key={item.id} className="bg-blue-50/20 border-b border-blue-50 text-xs">
                                <td className="py-2 px-1 text-center text-slate-300">{idx + 1}</td>
                                <td className="py-2 px-1 font-semibold text-slate-700">{item.itemNo || '-'}</td>
                                <td className="py-2 px-1 text-center text-slate-600 font-medium">{item.colorNo || '-'}</td>
                                <td className="py-2 px-1 text-slate-600 font-medium max-w-[120px] truncate">{item.productName || '-'}</td>
                                <td className="py-2 px-1 text-center text-xs font-bold text-slate-600">{rollCount}</td>
                                <td className="py-2 px-1 text-right text-xs font-extrabold text-sky-700">{item.meters.toFixed(2)} 米</td>
                                <td className="py-2 px-1 text-right text-xs font-medium text-slate-500">¥{item.price.toFixed(2)}</td>
                                <td className="py-2 px-1 text-right text-xs font-extrabold text-rose-600">¥{item.amount.toFixed(2)}</td>
                              </tr>
                            )})}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredDocs.map((doc) => {
                const isSample = doc.type === DocType.SAMPLE;
                const isExpanded = expandedDocs.has(doc.id);
                const matchingItems = getDocMatchingItems(doc);

                return (
                  <div key={doc.id} className="p-4 space-y-3">
                    {/* Card Header */}
                    <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(doc.id)}>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800 text-sm">{doc.docNo || '-'}</span>
                          <span className="text-[10px] text-slate-400">日期: {doc.date.substring(0, 10)}</span>
                        </div>
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

                    {/* Summary */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400">客户</span>
                        <div className="font-extrabold text-slate-700">{doc.customerName}</div>
                      </div>
                      <div>
                        <span className="text-slate-400">记录数</span>
                        <div className="font-bold text-slate-700">{matchingItems.length} 条</div>
                      </div>
                      <div>
                        <span className="text-slate-400">总计米数</span>
                        <div className="font-extrabold text-sky-700">{doc.totalMeters.toFixed(2)} 米</div>
                      </div>
                      <div>
                        <span className="text-slate-400">合计金额</span>
                        <div className="font-extrabold text-rose-600">¥{doc.totalAmount.toFixed(2)}</div>
                      </div>
                    </div>

                    {/* Expanded Items */}
                    {isExpanded && matchingItems.map((item, idx) => (
                      <div key={item.id} className="bg-slate-50/70 p-2.5 rounded-xl border border-slate-100 text-xs space-y-1.5">
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-700">#{idx + 1} {item.itemNo || '-'}</span>
                          {item.colorNo && <span className="text-slate-400">色号: {item.colorNo}</span>}
                        </div>
                        {item.productName && <div className="text-slate-500">{item.productName}</div>}
                        <div className="flex justify-between font-bold">
                          <span className="text-sky-600">{item.meters.toFixed(2)} 米</span>
                          <span>¥{item.price.toFixed(2)}</span>
                          <span className="text-rose-600">¥{item.amount.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100/60">
                      <button type="button" onClick={() => onSelect(doc)}
                        className="flex-1 py-2 text-xs font-semibold text-sky-600 hover:bg-sky-50 rounded-xl flex items-center justify-center gap-1">
                        <Eye className="w-4 h-4" />查看
                      </button>
                      <button type="button" onClick={() => onEdit(doc)}
                        className="flex-1 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 rounded-xl flex items-center justify-center gap-1">
                        <Edit2 className="w-4 h-4" />修改
                      </button>
                      <button type="button" onClick={() => onDuplicate(doc)}
                        className="flex-1 py-2 text-xs font-semibold text-teal-600 hover:bg-teal-50 rounded-xl flex items-center justify-center gap-1">
                        <Copy className="w-4 h-4" />复制
                      </button>
                      <button type="button" onClick={() => onDelete(doc.id)}
                        className="px-3 py-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl">
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
