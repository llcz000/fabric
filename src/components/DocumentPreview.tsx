/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { DocumentData, DocType, SampleItem, SalesItem, CompanyProfile } from '../types';
import { Printer, ArrowLeft, Edit3, Scissors, Download, Landmark, PhoneCall, Image } from 'lucide-react';
import { toPng } from 'html-to-image';

interface DocumentPreviewProps {
  document: DocumentData;
  companyProfile: CompanyProfile;
  onEdit: () => void;
  onBack: () => void;
}

// Helper to parse individual roll numbers for Sales Delivery Slip
const getRollValues = (rollNoStr: string, totalMeters: number): number[] => {
  if (!rollNoStr) return [totalMeters];
  const tokens = rollNoStr.trim().split(/[,，\s]+/);
  const values: number[] = [];
  let isNumericList = true;
  for (const t of tokens) {
    if (!t) continue;
    if (!/^\d+(\.\d+)?$/.test(t)) {
      isNumericList = false;
      break;
    }
    const val = parseFloat(t);
    if (isNaN(val) || val <= 0) {
      isNumericList = false;
      break;
    }
    values.push(val);
  }
  if (isNumericList && values.length > 0) {
    return values;
  }
  return [totalMeters];
};

// Convert numbers to big Chinese financial characters (人民币大写)
function numberToChineseCapital(num: number): string {
  const fraction = ['角', '分'];
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const unit = [
    ['元', '万', '亿'],
    ['', '拾', '佰', '仟'],
  ];
  
  let s = '';
  // Handle decimal points up to 2 decimal places
  const val = Math.round(num * 100) / 100;
  const parts = String(val).split('.');
  let integerPart = parseInt(parts[0], 10);
  const decimalPart = parts[1] || '';

  // Handle integers
  if (isNaN(integerPart)) {
    return '零元整';
  }

  // Convert integer part
  let integerStr = '';
  if (integerPart === 0) {
    integerStr = '零';
  } else {
    let unitIndex = 0;
    while (integerPart > 0) {
      let section = integerPart % 10000;
      let sectionStr = '';
      let needZero = false;
      
      for (let i = 0; i < 4; i++) {
        const d = section % 10;
        if (d === 0) {
          if (needZero) {
            sectionStr = digit[0] + sectionStr;
          }
          needZero = false;
        } else {
          sectionStr = digit[d] + unit[1][i] + sectionStr;
          needZero = true;
        }
        section = Math.floor(section / 10);
      }
      
      // Remove trailing zeros in sections
      sectionStr = sectionStr.replace(/零+$/, '');
      if (sectionStr) {
        integerStr = sectionStr + unit[0][0][unitIndex] + integerStr;
      } else if (unitIndex === 0) {
        integerStr = '元';
      }
      
      unitIndex++;
      integerPart = Math.floor(integerPart / 10000);
    }
  }

  // Fix zeros formatting
  integerStr = integerStr.replace(/零+/g, '零');
  integerStr = integerStr.replace(/零元/, '元');
  integerStr = integerStr.replace(/零万/, '万');
  if (integerStr.startsWith('元') && integerStr.length > 1) {
    integerStr = integerStr.substring(1);
  }
  if (!integerStr.endsWith('元') && !integerStr.includes('元')) {
    integerStr += '元';
  }

  s = integerStr;

  // Convert decimal part
  let decimalStr = '';
  if (!decimalPart || decimalPart === '00' || decimalPart === '0') {
    decimalStr = '整';
  } else {
    const j = parseInt(decimalPart[0], 10) || 0;
    const f = parseInt(decimalPart[1], 10) || 0;
    
    if (j > 0) {
      decimalStr += digit[j] + fraction[0];
    } else if (f > 0) {
      decimalStr += digit[0]; // add zero if no corner
    }
    
    if (f > 0) {
      decimalStr += digit[f] + fraction[1];
    } else {
      decimalStr += '整';
    }
  }

  return s + decimalStr;
}

// Convert "2026-07-08" to "2026年7月8日"
function formatDateChinese(dateStr: string): string {
  const d = dateStr.substring(0, 10).split('-');
  if (d.length !== 3) return dateStr.substring(0, 10);
  return `${parseInt(d[0])}年${parseInt(d[1])}月${parseInt(d[2])}日`;
}

export default function DocumentPreview({ document, companyProfile, onEdit, onBack }: DocumentPreviewProps) {
  const isSample = document.type === DocType.SAMPLE;
  const printRef = useRef(null);
  const [generating, setGenerating] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const handlePrint = () => {
    window.print();
  };

  // Export current document as PNG image
  const handleExportImage = async () => {
    if (generating) return;
    const node = printRef.current;
    if (!node) return;
    setGenerating(true);
    try {
      // Convert external images to data URLs via proxy, then toPng
      const images = node.getElementsByTagName('img');
      const swaps: { img: HTMLImageElement; orig: string }[] = [];

      await Promise.all(Array.from(images).map(async (img) => {
        if (img.src && /^https?:\/\//.test(img.src) && !img.src.includes('/api/proxy-image')) {
          try {
            const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(img.src));
            if (res.ok) {
              const blob = await res.blob();
              const reader = new FileReader();
              const dataUrl: string = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
              });
              swaps.push({ img, orig: img.src });
              img.src = dataUrl;
            }
          } catch (_) {}
        }
      }));

      const dataUrl = await toPng(node, {
        quality: 0.9,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: false,
      });

      swaps.forEach(({ img, orig }) => { img.src = orig; });

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        setPreviewImage(dataUrl);
      } else {
        // Desktop: direct download
        const link = window.document.createElement('a');
        link.download = `${document.docNo}-${document.customerName}.png`;
        link.href = dataUrl;
        window.document.body.appendChild(link);
        link.click();
        window.document.body.removeChild(link);
      }
    } catch (err: any) {
      alert('生成图片失败: ' + (err instanceof Error ? err.stack || err.message : JSON.stringify(err)));
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  // Export current document as JSON
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(document, null, 2));
    const downloadAnchor = window.document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `${document.docNo}-${document.customerName}.json`);
    window.document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Export beautifully formatted template-based Excel via backend
  const handleExportExcel = async () => {
    try {
      const res = await fetch(`/api/export_template/${document.id}`);
      if (!res.ok) {
        throw new Error('导出失败');
      }
      const data = await res.json();
      if (data.excel) {
        const byteCharacters = atob(data.excel);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = url;
        a.download = data.filename || `${document.docNo}.xlsx`;
        window.document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else if (data.error) {
        alert(data.error);
      }
    } catch (e: any) {
      console.error('API Excel export failed:', e);
      alert('导出Excel单据失败，可能因为暂未上传对应单据类型的Excel模版文件，或者服务器端环境有配置限制。您可以继续使用在线直接打印。');
    }
  };

  return (
    <div className="space-y-6">
      <style>{`.qr-code-img{width:240px!important;height:240px!important}@media(max-width:768px){.qr-code-img{width:180px!important;height:180px!important}}`}</style>
      {/* Generating overlay */}
      {generating && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '36px 48px', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ width: 48, height: 48, border: '4px solid #e2e8f0', borderTopColor: '#0ea5e9', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }}></div>
            <p style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>正在生成图片</p>
            <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>请稍候...</p>
          </div>
        </div>
      )}

      {/* Image preview overlay (mobile) */}
      {previewImage && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: '#000', overflow: 'auto' }} onClick={() => setPreviewImage(null)}>
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewImage(null); }}
            style={{ position: 'fixed', top: 12, right: 12, zIndex: 1, background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: 20, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
          >
            关闭
          </button>
          <img src={previewImage} style={{ width: '100%', display: 'block' }} alt="单据截图" />
        </div>
      )}

      {/* Action Buttons */}
      <div className="no-print bg-white rounded-2xl border border-slate-100 shadow-xs p-4 flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          id="btn-preview-back"
          onClick={onBack}
          className="flex items-center gap-1.5 px-4 py-2 hover:bg-slate-100 text-slate-600 rounded-xl text-sm font-semibold cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          返回列表
        </button>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            id="btn-preview-json"
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            备份 (JSON)
          </button>

          <button
            type="button"
            id="btn-preview-excel"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-emerald-200 hover:border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors duration-150"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            导出Excel
          </button>

          <button
            type="button"
            id="btn-preview-edit"
            onClick={onEdit}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold cursor-pointer"
          >
            <Edit3 className="w-4 h-4" />
            修改单据
          </button>

          <button
            type="button"
            id="btn-preview-image"
            onClick={handleExportImage}
            className="flex items-center gap-1.5 px-3 py-2 border border-sky-200 hover:border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors duration-150"
          >
            <Image className="w-3.5 h-3.5 text-sky-600" />
            生成图片
          </button>

          <button
            type="button"
            id="btn-preview-print"
            onClick={handlePrint}
            className="flex items-center gap-2 px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-sm font-semibold shadow-md hover:shadow-lg cursor-pointer transition-all duration-150"
          >
            <Printer className="w-4.5 h-4.5" />
            打印单据 (A4排版)
          </button>
        </div>
      </div>

      {/* Invoice Page Sheet Wrapper: Designed to look like paper */}
      <div className="preview-wrapper bg-white rounded-3xl border border-slate-200 shadow-md max-w-[960px] mx-auto overflow-hidden">

        {/* Printable Section */}
        <div ref={printRef} className="print-container p-4 sm:p-6 space-y-1.5 bg-white text-slate-900 leading-normal select-text">
          
          {/* Header Block, Title & Metadata Grouped tightly to reduce vertical space */}
          <div className="space-y-0.5">
            {/* 1. Header Corporate Block */}
            <div className="border-b-2 border-slate-900 pb-1">
              <div className="flex justify-between items-start gap-4">
                {/* Left: Company Logo Image */}
                <div className="w-[120px] flex justify-start items-start h-12">
                  {companyProfile.logoUrl && (
                    <img src={companyProfile.logoUrl} className="max-h-12 max-w-full object-contain" alt="Logo" referrerPolicy="no-referrer" />
                  )}
                </div>

                {/* Right: Company Name, Address and Phone */}
                <div className="space-y-1 flex-1 text-right" style={{ fontFamily: 'SimSun, serif' }}>
                  <h1 className="text-lg sm:text-xl tracking-wide text-slate-900" style={{ fontFamily: 'SimHei, sans-serif' }}>
                    {companyProfile.name}
                  </h1>
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <p>地址：{companyProfile.address}</p>
                    <p>电话：{companyProfile.phone}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Document Title centered below the horizontal line */}
            <div className="text-center py-0">
              <h2 className="text-sm sm:text-base font-black tracking-[0.5em] text-slate-950 uppercase pl-[0.5em]">
                {isSample ? '样布码单' : '销售发货码单'}
              </h2>
            </div>

            {/* 2. Metadata Section: NO, 收货单位, Date above table */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2 pb-0.5 text-xs text-slate-800 border-b border-slate-400/60" style={{ fontFamily: 'SimSun, serif' }}>
              <div className="space-y-0.5">
                <div>
                  <span>NO：</span>
                  <span className="text-slate-900">{document.docNo}</span>
                </div>
                <div>
                  <span>收货单位：</span>
                  <span>{document.customerName}</span>
                </div>
              </div>
              <div className="text-[11px] leading-tight">
                <span>日期：</span>
                <span>{formatDateChinese(document.date)}</span>
              </div>
            </div>
          </div>

          {/* 3. Central Packing Grid Table */}
          <div className="overflow-hidden border border-slate-900 rounded-xs !mt-1">
            <table className="w-full border-collapse text-left text-[11px] text-slate-800 table-auto" style={{ fontFamily: 'SimSun, serif' }}>
              {isSample ? (
                <>
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-900 text-slate-900 font-semibold whitespace-nowrap">
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[40px] whitespace-nowrap">序号</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[70px] whitespace-nowrap">货号</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[60px] whitespace-nowrap">色号</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[80px] whitespace-nowrap">品名</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[75px] whitespace-nowrap">成分</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[55px] whitespace-nowrap">克重</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[70px] whitespace-nowrap">门幅 (cm)</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[65px] whitespace-nowrap">米数 (米)</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[65px] whitespace-nowrap">单价 (元)</th>
                      <th className="py-1.5 px-2 border-r border-slate-900 text-center w-[70px] whitespace-nowrap">金额 (元)</th>
                      <th className="py-1.5 px-2 text-center w-[65px] whitespace-nowrap">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {document.items.map((item, index) => {
                      const sample = item as SampleItem;
                      return (
                        <tr key={item.id} className="border-b border-slate-900">
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center text-slate-500">{index + 1}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center uppercase break-words">{item.itemNo}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center break-words">{item.colorNo || '-'}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center break-words">{item.productName}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center break-words">{sample.composition || '-'}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center font-bold text-slate-600 break-words">
                            {sample.weight || '-'}
                          </td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center font-bold break-words">{item.width || '-'}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center font-bold">{item.meters.toFixed(2)}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center font-bold">¥{item.price.toFixed(2)}</td>
                          <td className="py-1.5 px-2 border-r border-slate-900 text-center font-bold text-blue-600">¥{item.amount.toFixed(2)}</td>
                          <td className="py-1.5 px-2 text-center break-words">{item.remark || ''}</td>
                        </tr>
                      );
                    })}

                    {/* Summary Row 1: Total Meters & Total Amount */}
                    <tr className="border-b border-slate-900 text-slate-900 bg-slate-50/10">
                      <td colSpan={5} className="py-1.5 px-3 border-r border-slate-900 text-left">
                        总计数（米）：<span className="font-bold">{document.totalMeters.toFixed(2)}</span>
                      </td>
                      <td colSpan={6} className="py-1.5 px-3 text-left">
                        合计金额：<span className="text-blue-600 font-bold">¥{document.totalAmount.toFixed(2)}</span>
                        <span className="text-slate-900 text-[10px] ml-2">
                          （大写：{numberToChineseCapital(document.totalAmount)}）
                        </span>
                      </td>
                    </tr>

                    {/* Summary Row 2: Total Rolls & Receivable Amount */}
                    <tr className="text-slate-900 bg-slate-50/10">
                      <td colSpan={5} className="py-1.5 px-3 border-r border-slate-900 text-left">
                        实发总匹数：<span className="font-bold">{document.totalRolls}</span> 匹
                      </td>
                      <td colSpan={6} className="py-1.5 px-3 text-left">
                        应收金额：<span className="text-blue-600 font-bold">¥{document.totalAmount.toFixed(2)}</span>
                        <span className="text-slate-900 text-[10px] ml-2">
                          （大写：{numberToChineseCapital(document.totalAmount)}）
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-900 text-slate-900 font-semibold text-center whitespace-nowrap">
                      <th className="py-1 px-1 border-r border-slate-900 w-[30px]">#</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[60px]">货号</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[50px]">色号</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[70px]">品名</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">1</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">2</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">3</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">4</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">5</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">6</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">7</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">8</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">9</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[35px]">10</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[40px]">匹数</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[55px]">米数(米)</th>
                      <th className="py-1 px-1 border-r border-slate-900 w-[50px]">单价</th>
                      <th className="py-1 px-1 w-[65px]">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {document.items.map((item, index) => {
                      const sales = item as SalesItem;
                      const rolls = getRollValues(sales.rollNo, sales.meters);
                      const rowCount = Math.ceil(rolls.length / 10) || 1;
                      
                      const rows = [];
                      for (let r = 0; r < rowCount; r++) {
                        const chunkStart = r * 10;
                        const chunkRolls = rolls.slice(chunkStart, chunkStart + 10);
                        
                        if (r === 0) {
                          rows.push(
                            <tr key={`${item.id}-${r}`} className="border-b border-slate-900 text-center">
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center text-slate-500">
                                {index + 1}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center uppercase break-all">
                                {item.itemNo}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center break-all">
                                {item.colorNo || '-'}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center break-all">
                                {item.productName}
                              </td>

                              {Array.from({ length: 10 }).map((_, colIdx) => {
                                const rollVal = chunkRolls[colIdx];
                                return (
                                  <td key={colIdx} className="py-1.5 px-1 border-r border-slate-900 text-center font-bold">
                                    {rollVal !== undefined ? rollVal.toFixed(1) : ''}
                                  </td>
                                );
                              })}

                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center font-bold">
                                {rolls.length}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center font-bold">
                                {item.meters.toFixed(2)}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 border-r border-slate-900 text-center font-bold">
                                ¥{item.price.toFixed(2)}
                              </td>
                              <td rowSpan={rowCount} className="py-1.5 px-1 text-center font-bold text-blue-600">
                                ¥{item.amount.toFixed(2)}
                              </td>
                            </tr>
                          );
                        } else {
                          rows.push(
                            <tr key={`${item.id}-${r}`} className="border-b border-slate-900 text-center">
                              {Array.from({ length: 10 }).map((_, colIdx) => {
                                const rollVal = chunkRolls[colIdx];
                                return (
                                  <td key={colIdx} className="py-1.5 px-1 border-r border-slate-900 text-center font-bold">
                                    {rollVal !== undefined ? rollVal.toFixed(1) : ''}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        }
                      }
                      return <React.Fragment key={item.id}>{rows}</React.Fragment>;
                    })}

                    {/* Summary Row 1: Total Meters & Total Amount */}
                    <tr className="border-b border-slate-900 text-slate-900 bg-slate-50/10">
                      <td colSpan={10} className="py-1.5 px-3 border-r border-slate-900 text-left">
                        总匹数：<span className="font-bold">{document.totalRolls}</span> 匹 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 总计米数：<span className="font-bold">{document.totalMeters.toFixed(2)}</span> 米
                      </td>
                      <td colSpan={8} className="py-1.5 px-3 text-left">
                        合计金额：<span className="text-blue-600 font-bold">¥{document.totalAmount.toFixed(2)}</span>
                        <span className="text-slate-900 text-[10px] block sm:inline sm:ml-2">
                          （大写：{numberToChineseCapital(document.totalAmount)}）
                        </span>
                      </td>
                    </tr>

                    {/* Summary Row 2: Deposit (Sales only) & Net Receivable Amount */}
                    <tr className="text-slate-900 bg-slate-50/10">
                      {!isSample && (
                      <td colSpan={10} className="py-1.5 px-3 border-r border-slate-900 text-left">
                        预收订金：<span className="font-bold">¥{(document.deposit || 0).toFixed(2)}</span>
                        <span className="text-slate-900 text-[10px] block sm:inline sm:ml-2">
                          （大写：{numberToChineseCapital(document.deposit || 0)}）
                        </span>
                      </td>
                      )}
                      <td colSpan={isSample ? 18 : 8} className="py-1.5 px-3 text-left">
                        应付款：<span className="text-blue-600 font-bold">¥{document.receivableAmount.toFixed(2)}</span>
                        <span className="text-slate-900 text-[10px] block sm:inline sm:ml-2">
                          （大写：{numberToChineseCapital(document.receivableAmount)}）
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </>
              )}
            </table>
          </div>

          {/* 4. Terms and Liability Statement */}
          <div className="bg-slate-50/80 border border-slate-300 rounded-sm p-2 text-[11px] leading-relaxed text-slate-700" style={{ fontFamily: 'SimSun, serif' }}>
            <span>备注条款：</span>
            <span className="whitespace-pre-wrap">{companyProfile.defaultTerms || '无备注条款。'}</span>
          </div>

          {/* 5. Bottom Signatures and Contact Block */}
          <div className="signature-section flex flex-col sm:flex-row justify-between items-start gap-2 pt-1 border-t border-dashed border-slate-400" style={{ fontFamily: 'SimSun, serif', marginTop: 20 }}>
            {/* Left: Signatures inline on one row */}
            <div className="flex flex-wrap items-center gap-x-8 sm:gap-x-12 gap-y-4 text-xs text-slate-800">
              <div>
                <span>开单人签字：</span>
                <span className="underline underline-offset-4 pl-1">
                  {document.issuer || '        '}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 sm:gap-x-8">
                <div>
                  <span>收货人签字：</span>
                  <span className="underline underline-offset-4 pl-1">
                    {document.receiver || '        '}
                  </span>
                </div>
                <div>
                  <span>电话：</span>
                  <span className="underline underline-offset-4">
                    {document.bottomPhone || '        '}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Payment QRCodes (WeChat & Alipay) - Only shown for Sample Slip */}
            {isSample && (
              <div className="flex items-center ml-auto" style={{ marginTop: 2 }}>
                  {companyProfile.weChatPayUrl && (
                    <div className="flex flex-col items-center" style={{ marginRight: 32 }}>
                      <img src={companyProfile.weChatPayUrl} style={{ width: 80, height: 80, minWidth: 80, minHeight: 80, border: '1px solid #e2e8f0', borderRadius: 4, padding: 2, background: '#fff' }} alt="微信收款" referrerPolicy="no-referrer" />
                      <span className="text-[9px] text-slate-500 font-bold mt-1">微信收款</span>
                    </div>
                  )}
                  {companyProfile.aliPayUrl && (
                    <div className="flex flex-col items-center">
                      <img src={companyProfile.aliPayUrl} style={{ width: 80, height: 80, minWidth: 80, minHeight: 80, border: '1px solid #e2e8f0', borderRadius: 4, padding: 2, background: '#fff' }} alt="支付宝收款" referrerPolicy="no-referrer" />
                      <span className="text-[9px] text-slate-500 font-bold mt-1">支付宝收款</span>
                    </div>
                  )}
                </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
