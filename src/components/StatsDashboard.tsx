/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DocumentData, DocType } from '../types';
import { TrendingUp, FileText, BarChart3, Package, Sparkles, Receipt, ArrowUpRight } from 'lucide-react';

interface StatsDashboardProps {
  documents: DocumentData[];
  onViewDoc: (doc: DocumentData) => void;
}

export default function StatsDashboard({ documents, onViewDoc }: StatsDashboardProps) {
  // Aggregate stats
  const sampleDocs = documents.filter(d => d.type === DocType.SAMPLE);
  const salesDocs = documents.filter(d => d.type === DocType.SALES);

  const totalMeters = documents.reduce((sum, d) => sum + d.totalMeters, 0);
  const totalAmount = documents.reduce((sum, d) => sum + d.totalAmount, 0);

  const sampleMeters = sampleDocs.reduce((sum, d) => sum + d.totalMeters, 0);
  const salesMeters = salesDocs.reduce((sum, d) => sum + d.totalMeters, 0);

  const sampleAmount = sampleDocs.reduce((sum, d) => sum + d.totalAmount, 0);
  const salesAmount = salesDocs.reduce((sum, d) => sum + d.totalAmount, 0);

  // Top products ranking
  const productMetersMap: { [product: string]: number } = {};
  documents.forEach(doc => {
    doc.items.forEach(item => {
      const name = item.productName.trim() || '未命名的面料';
      productMetersMap[name] = (productMetersMap[name] || 0) + item.meters;
    });
  });

  const sortedProducts = Object.entries(productMetersMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const maxProductMeters = sortedProducts.length > 0 ? sortedProducts[0][1] : 1;

  // Recent 4 documents
  const recentDocs = [...documents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);

  return (
    <div id="stats-dashboard-container" className="space-y-6">
      
      {/* 1. Header Hero row */}
      <div className="bg-linear-to-r from-sky-900 via-sky-800 to-indigo-900 rounded-3xl text-white p-6 sm:p-8 shadow-md">
        <div className="max-w-2xl space-y-2">
          <span className="text-xs font-semibold uppercase tracking-widest bg-sky-500/25 text-sky-200 px-3 py-1 rounded-full border border-sky-400/20">
            DASHBOARD · 数据看板
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            面料业务数字化管理大盘
          </h2>
          <p className="text-sm text-sky-100/80 leading-relaxed font-normal">
            实时汇总样布打样与销售发货账目指标。支持通过本地数据库，全方位掌握客户流向、畅销品类与财务汇总。
          </p>
        </div>
      </div>

      {/* 2. Visual Split Analysis card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Sampling volume card */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-full">
                打样专属指标 · 样布码单
              </span>
              <h3 className="text-lg font-bold text-slate-800 pt-1">样品发货统计</h3>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
              <Package className="w-5 h-5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4">
            <div>
              <span className="text-xs text-slate-400 block font-medium">样布总数</span>
              <span className="text-lg font-extrabold text-slate-700">{sampleDocs.length} 份</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">寄出米数</span>
              <span className="text-lg font-extrabold text-indigo-600">{sampleMeters.toFixed(1)} 米</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">样品货值</span>
              <span className="text-lg font-extrabold text-slate-700">¥{sampleAmount.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">平均单价</span>
              <span className="text-lg font-extrabold text-slate-700">
                ¥{sampleMeters > 0 ? (sampleAmount / sampleMeters).toFixed(1) : '0.0'}/米
              </span>
            </div>
          </div>
        </div>

        {/* Sales volume card */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-emerald-500 bg-emerald-50 px-2.5 py-1 rounded-full">
                营销主权指标 · 发货码单
              </span>
              <h3 className="text-lg font-bold text-slate-800 pt-1">发货销售统计</h3>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
              <Receipt className="w-5 h-5" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-50 pt-4">
            <div>
              <span className="text-xs text-slate-400 block font-medium">成交单数</span>
              <span className="text-lg font-extrabold text-slate-700">{salesDocs.length} 份</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">发货米数</span>
              <span className="text-lg font-extrabold text-emerald-600">{salesMeters.toFixed(1)} 米</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">成交金额</span>
              <span className="text-lg font-extrabold text-rose-600">¥{salesAmount.toLocaleString('en-US', {maximumFractionDigits:0})}</span>
            </div>
            <div>
              <span className="text-xs text-slate-400 block font-medium">平均单价</span>
              <span className="text-lg font-extrabold text-slate-700">
                ¥{salesMeters > 0 ? (salesAmount / salesMeters).toFixed(1) : '0.0'}/米
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* 3. Hot Fabric Ranking & History log */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left: Top Fabric rank list */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs lg:col-span-3 space-y-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
            <BarChart3 className="w-5 h-5 text-sky-600" />
            面料畅销度排行榜 (Top 5 Fabric Types)
          </h3>
          
          {sortedProducts.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              暂无面料发货记录，请先录入单据。
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {sortedProducts.map(([name, meters], i) => {
                const percent = Math.max(10, Math.round((meters / maxProductMeters) * 100));
                return (
                  <div key={name} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold text-slate-600">
                      <span className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] text-white ${
                          i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-slate-300'
                        }`}>
                          {i + 1}
                        </span>
                        {name}
                      </span>
                      <span>{meters.toFixed(1)} 米</span>
                    </div>
                    {/* Visual Bar */}
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-sky-500' : 'bg-slate-500'
                        }`}
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Recent activity logs list */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs lg:col-span-2 space-y-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
            <Sparkles className="w-5 h-5 text-indigo-500" />
            最新开单动态
          </h3>

          {recentDocs.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              暂无最新动态。
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {recentDocs.map((doc) => {
                const isSample = doc.type === DocType.SAMPLE;
                return (
                  <div 
                    key={doc.id}
                    onClick={() => onViewDoc(doc)}
                    className="flex items-center justify-between p-3 border border-slate-50 rounded-xl hover:bg-slate-50 cursor-pointer transition-all group"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-slate-800">{doc.docNo}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-semibold ${
                          isSample ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'
                        }`}>
                          {isSample ? '样布' : '发货'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-500 truncate max-w-[150px]">
                        客户: {doc.customerName}
                      </p>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <div className="text-xs font-bold text-rose-600 font-mono">¥{doc.totalAmount.toFixed(1)}</div>
                        <div className="text-[9px] text-slate-400">{doc.date.substring(0, 10)}</div>
                      </div>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition-colors" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
