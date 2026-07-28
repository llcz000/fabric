/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { InventoryEntry, InventoryRecord } from '../types';
import { Plus, Trash2, Save, Search, RefreshCw, Package } from 'lucide-react';

interface InventoryManagerProps {
  entries: InventoryEntry[];
  ledger: InventoryRecord[];
  ledgerLoading: boolean;
  onSaveEntries: (rows: { entryDate: string; productName: string; rolls: number; meters: number; remark: string }[]) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onRefreshLedger: () => void;
}

export default function InventoryManager({
  entries,
  ledger,
  ledgerLoading,
  onSaveEntries,
  onDeleteEntry,
  onRefreshLedger,
}: InventoryManagerProps) {
  const [tab, setTab] = useState<'entry' | 'ledger'>('entry');
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().substring(0, 10);
  const [formRows, setFormRows] = useState<{ entryDate: string; productName: string; rolls: number; meters: number; remark: string }[]>([
    { entryDate: today, productName: '', rolls: 0, meters: 0, remark: '' }
  ]);

  const addFormRow = () => {
    setFormRows([...formRows, { entryDate: today, productName: '', rolls: 0, meters: 0, remark: '' }]);
  };

  const removeFormRow = (index: number) => {
    if (formRows.length <= 1) return;
    setFormRows(formRows.filter((_, i) => i !== index));
  };

  const updateFormRow = (index: number, field: string, value: any) => {
    const updated = [...formRows];
    (updated[index] as any)[field] = field === 'rolls' || field === 'meters' ? (parseFloat(value) || 0) : value;
    setFormRows(updated);
  };

  const clearForm = () => {
    setFormRows([{ entryDate: today, productName: '', rolls: 0, meters: 0, remark: '' }]);
  };

  const handleSave = async () => {
    const validRows = formRows.filter(r => r.productName.trim());
    if (validRows.length === 0) {
      alert('请至少录入一条包含品名的记录。');
      return;
    }
    setSaving(true);
    try {
      await onSaveEntries(validRows);
      clearForm();
      setTab('ledger');
    } catch {
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此入库记录？')) return;
    try {
      await onDeleteEntry(id);
    } catch {
      alert('删除失败');
    }
  };

  const filteredLedger = ledgerSearch
    ? ledger.filter(r => r.productName.toLowerCase().includes(ledgerSearch.toLowerCase()))
    : ledger;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Package className="w-6 h-6 text-slate-700" />
            库存管理
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">录入面料入库记录，查看库存台账。</p>
        </div>

        <div className="flex bg-slate-100/90 border border-slate-200/60 p-1.5 rounded-xl w-fit shadow-inner">
          <button
            type="button"
            onClick={() => setTab('entry')}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === 'entry'
                ? 'bg-sky-600 text-white shadow-md scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            库存录入
          </button>
          <button
            type="button"
            onClick={() => { setTab('ledger'); onRefreshLedger(); }}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
              tab === 'ledger'
                ? 'bg-sky-600 text-white shadow-md scale-[1.02]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            库存台账
          </button>
        </div>
      </div>

      {/* Entry Form Tab */}
      {tab === 'entry' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 space-y-4">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-100">
                  <th className="py-2 px-3 text-xs font-bold text-center w-12">序号</th>
                  <th className="py-2 px-2 text-xs font-bold w-[140px]">入库日期 <span className="text-rose-400">*</span></th>
                  <th className="py-2 px-2 text-xs font-bold w-[200px]">品名 <span className="text-rose-400">*</span></th>
                  <th className="py-2 px-2 text-xs font-bold w-[100px]">匹数</th>
                  <th className="py-2 px-2 text-xs font-bold w-[120px]">米数</th>
                  <th className="py-2 px-2 text-xs font-bold min-w-[160px]">备注</th>
                  <th className="py-2 px-3 text-xs font-bold text-center w-12">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {formRows.map((row, index) => (
                  <tr key={index} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-2 px-3 text-xs text-slate-400 text-center font-medium">{index + 1}</td>
                    <td className="py-2 px-1">
                      <input
                        type="date"
                        value={row.entryDate}
                        onChange={(e) => updateFormRow(index, 'entryDate', e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <input
                        type="text"
                        value={row.productName}
                        onChange={(e) => updateFormRow(index, 'productName', e.target.value)}
                        placeholder="请输入品名"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-medium"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={row.rolls || ''}
                        onChange={(e) => updateFormRow(index, 'rolls', e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 text-right"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={row.meters || ''}
                        onChange={(e) => updateFormRow(index, 'meters', e.target.value)}
                        placeholder="0.0"
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 text-right"
                      />
                    </td>
                    <td className="py-2 px-1">
                      <input
                        type="text"
                        value={row.remark || ''}
                        onChange={(e) => updateFormRow(index, 'remark', e.target.value)}
                        placeholder="备注..."
                        className="w-full px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-500"
                      />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeFormRow(index)}
                        className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-md cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="block md:hidden space-y-3">
            {formRows.map((row, index) => (
              <div key={index} className="bg-slate-50/50 rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">#{index + 1}</span>
                  <button type="button" onClick={() => removeFormRow(index)}
                    className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block">入库日期</label>
                    <input type="date" value={row.entryDate}
                      onChange={(e) => updateFormRow(index, 'entryDate', e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-600 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block">品名</label>
                    <input type="text" value={row.productName}
                      onChange={(e) => updateFormRow(index, 'productName', e.target.value)}
                      placeholder="请输入品名"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-medium bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block">匹数</label>
                    <input type="number" min="0" step="1" value={row.rolls || ''}
                      onChange={(e) => updateFormRow(index, 'rolls', e.target.value)}
                      placeholder="0"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 bg-white" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block">米数</label>
                    <input type="number" step="any" min="0" value={row.meters || ''}
                      onChange={(e) => updateFormRow(index, 'meters', e.target.value)}
                      placeholder="0.0"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs font-mono text-slate-700 bg-white" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 block">备注</label>
                    <input type="text" value={row.remark || ''}
                      onChange={(e) => updateFormRow(index, 'remark', e.target.value)}
                      placeholder="备注..."
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500 text-xs text-slate-500 bg-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button type="button" onClick={addFormRow}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <Plus className="w-4 h-4" />追加一行
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={clearForm}
                className="px-3 py-2 border border-slate-200 hover:border-slate-300 text-slate-500 rounded-lg text-xs font-medium cursor-pointer">
                清空
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold shadow-md hover:shadow-lg flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50">
                <Save className="w-4 h-4" />
                {saving ? '保存中...' : '保存入库'}
              </button>
            </div>
          </div>

          {/* Existing entries list */}
          {entries.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">
                最近入库记录（{entries.length} 条）
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/60 text-slate-500 border-b border-slate-100">
                      <th className="py-1.5 px-2">入库日期</th>
                      <th className="py-1.5 px-2">品名</th>
                      <th className="py-1.5 px-2 text-right">匹数</th>
                      <th className="py-1.5 px-2 text-right">米数</th>
                      <th className="py-1.5 px-2">备注</th>
                      <th className="py-1.5 px-2 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {entries.slice(0, 20).map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/40">
                        <td className="py-1.5 px-2 text-slate-500">{e.entryDate}</td>
                        <td className="py-1.5 px-2 font-medium text-slate-700">{e.productName}</td>
                        <td className="py-1.5 px-2 text-right font-bold text-slate-600">{e.rolls}</td>
                        <td className="py-1.5 px-2 text-right font-bold text-sky-700">{e.meters.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-slate-400 text-[11px] max-w-[150px] truncate">{e.remark || '-'}</td>
                        <td className="py-1.5 px-2 text-center">
                          <button type="button" onClick={() => handleDelete(e.id)}
                            className="p-0.5 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ledger Tab */}
      {tab === 'ledger' && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-xs p-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input type="text" value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="搜索品名..."
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-700 bg-slate-50/50" />
            </div>
            <button type="button" onClick={onRefreshLedger}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${ledgerLoading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {filteredLedger.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">{ledgerLoading ? '加载中...' : '暂无库存数据，请先录入入库记录。'}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-sky-50 rounded-xl p-4">
                  <span className="text-xs text-sky-500 font-bold uppercase">总入库米数</span>
                  <div className="text-2xl font-extrabold text-sky-700 mt-1">
                    {filteredLedger.reduce((s, r) => s + r.totalInMeters, 0).toFixed(1)} 米
                  </div>
                </div>
                <div className="bg-amber-50 rounded-xl p-4">
                  <span className="text-xs text-amber-500 font-bold uppercase">总出库米数</span>
                  <div className="text-2xl font-extrabold text-amber-700 mt-1">
                    {filteredLedger.reduce((s, r) => s + r.totalOutMeters, 0).toFixed(1)} 米
                  </div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4">
                  <span className="text-xs text-emerald-500 font-bold uppercase">总剩余米数</span>
                  <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                    {filteredLedger.reduce((s, r) => s + r.remainingMeters, 0).toFixed(1)} 米
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 border-b border-slate-100">
                      <th className="py-2 px-3 font-bold">品名</th>
                      <th className="py-2 px-2 text-right font-bold">入库匹数</th>
                      <th className="py-2 px-2 text-right font-bold">入库米数</th>
                      <th className="py-2 px-2 text-right font-bold">出库匹数</th>
                      <th className="py-2 px-2 text-right font-bold">出库米数</th>
                      <th className="py-2 px-2 text-right font-bold">剩余匹数</th>
                      <th className="py-2 px-2 text-right font-bold">剩余米数</th>
                      <th className="py-2 px-2 font-bold">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredLedger.map((r, i) => (
                      <tr key={i} className={`hover:bg-slate-50/40 ${r.remainingMeters < 0 ? 'bg-rose-50/30' : ''}`}>
                        <td className="py-2 px-3 font-semibold text-slate-800">{r.productName}</td>
                        <td className="py-2 px-2 text-right font-bold text-slate-600">{r.totalInRolls}</td>
                        <td className="py-2 px-2 text-right font-bold text-sky-700">{r.totalInMeters.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-bold text-amber-700">{r.totalOutRolls}</td>
                        <td className="py-2 px-2 text-right font-bold text-amber-700">{r.totalOutMeters.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right font-extrabold text-slate-800">{r.remainingRolls}</td>
                        <td className="py-2 px-2 text-right font-extrabold text-emerald-700">{r.remainingMeters.toFixed(2)}</td>
                        <td className="py-2 px-2 text-slate-400 text-[11px] max-w-[180px] truncate">{r.remark || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
