/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { DocumentData, DocType, SampleItem, SalesItem, CompanyProfile } from '../types';
import { Printer, ArrowLeft, Edit3, Scissors, Download, Landmark, PhoneCall, Image } from 'lucide-react';
import html2canvas from 'html2canvas-pro';

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
        integerStr = sectionStr + unit[0][unitIndex] + integerStr;
      } else if (unitIndex === 0) {
        integerStr = '元';
      }
      
      unitIndex++;
      integerPart = Math.floor(integerPart / 10000);
    }
  }

  // Fix zeros formatting
  integerStr = integerStr.replace(/零+/g, '零');
  integerStr = integerStr.replace(/^零(?!元)(?=.)/, '');
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
  const isDeposit = document.type === DocType.DEPOSIT;
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
      // Convert external images to data URLs via proxy, then html2canvas
      const images = node.getElementsByTagName('img');
      const swaps: { img: HTMLImageElement; orig: string }[] = [];

      await Promise.all(Array.from(images).map(async (img, idx) => {
        if (img.src && /^https?:\/\//.test(img.src) && !img.src.includes('/api/proxy-image')) {
          try {
            const res = await fetch('/api/proxy-image?url=' + encodeURIComponent(img.src));
            if (res.ok) {
              const blob = await res.blob();
              const dataUrl: string = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('FileReader failed'));
                reader.readAsDataURL(blob);
              });
              swaps.push({ img, orig: img.src });
              await new Promise<void>((resolve) => {
                const pre = window.document.createElement('img');
                pre.onload = () => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                  img.src = dataUrl;
                };
                pre.onerror = () => resolve();
                pre.src = dataUrl;
              });
            }
          } catch (_) {}
        }
      }));

      await new Promise(r => setTimeout(r, 200));

      // Temporarily force full-width desktop layout for image capture on mobile
      const wrapper = node.closest('.preview-wrapper') as HTMLElement;
      const origWrapWidth = wrapper?.style.width || '';
      const origWrapMaxW = wrapper?.style.maxWidth || '';
      const origWrapOverflow = wrapper?.style.overflowX || '';
      if (wrapper) {
        wrapper.style.width = '900px';
        wrapper.style.maxWidth = 'none';
        wrapper.style.overflowX = 'visible';
      }

      // Force desktop layout on signature section (flex-row, QR codes on right)
      const sigSection = node.querySelector('.signature-section') as HTMLElement;
      const origSigDisplay = sigSection?.style.display || '';
      const origSigFlexDir = sigSection?.style.flexDirection || '';
      const origSigJustify = sigSection?.style.justifyContent || '';
      const origQrOrder = sigSection?.querySelector('[class*="order-first"]')?.getAttribute('style') || '';
      if (sigSection) {
        sigSection.style.display = 'flex';
        sigSection.style.flexDirection = 'row';
        sigSection.style.justifyContent = 'space-between';
        sigSection.style.alignItems = 'flex-start';
      }
      const qrDiv = sigSection?.querySelector('[class*="order-first"]') as HTMLElement;
      if (qrDiv) qrDiv.style.order = '0';

      // Force reflow before capture
      await new Promise(r => requestAnimationFrame(r));

      const canvas = await html2canvas(node, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: false,
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');

      // Restore
      if (wrapper) {
        wrapper.style.width = origWrapWidth;
        wrapper.style.maxWidth = origWrapMaxW;
        wrapper.style.overflowX = origWrapOverflow;
      }
      if (sigSection) {
        sigSection.style.display = origSigDisplay;
        sigSection.style.flexDirection = origSigFlexDir;
        sigSection.style.justifyContent = origSigJustify;
      }
      if (qrDiv) qrDiv.style.order = '';

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
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Image export failed:', err);
      alert('生成图片失败: ' + errMsg);
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
      const token = sessionStorage.getItem('fabric_auth_token');
      const headers: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`/api/export_template/${document.id}`, { headers });
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
      <style>{`
        .qr-code-img{width:240px!important;height:240px!important}
        @media(max-width:768px){.qr-code-img{width:180px!important;height:180px!important}}
        .preview-wrapper .terms-box { background-color: #f8fafc !important; border-color: #cbd5e1 !important; }
      `}</style>
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
      <div className="preview-wrapper bg-white rounded-3xl border border-slate-200 shadow-md mx-auto" style={{ width: 'fit-content' }}>

        {/* Printable Section */}
        <div ref={printRef} className="print-container p-4 sm:p-6 bg-white text-slate-900 leading-normal select-text" style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: 'fit-content' }}>

          {/* Header Block, Title & Metadata Grouped tightly to reduce vertical space */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
            {/* 1. Header Corporate Block */}
            <div style={{ borderBottom: '2px solid #000', paddingBottom: '4px', position: 'relative' }}>
              {/* Left: Company Logo Image - absolutely positioned to not affect width */}
              {companyProfile.logoUrl && (
                <div className="absolute left-0 top-0 h-12 flex items-start" style={{ zIndex: 1 }}>
                  <img src={companyProfile.logoUrl} className="max-h-12 max-w-[80px] object-contain" alt="Logo" referrerPolicy="no-referrer" />
                </div>
              )}
              {/* Right: Company Name, Address and Phone - determines container width */}
              <div className="text-right" style={{ fontFamily: 'SimSun, serif', minHeight: companyProfile.logoUrl ? '3rem' : 'auto' }}>
                  <h1 className="text-lg sm:text-xl tracking-wide text-slate-900" style={{ fontFamily: 'SimHei, sans-serif' }}>
                    {companyProfile.name}
                  </h1>
                  <div className="text-[11px] text-slate-500" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <p>地址：{companyProfile.address}</p>
                    <p>电话：{companyProfile.phone}</p>
                  </div>
                </div>
            </div>
            <div className="text-center py-0">
              <h2 className="text-sm sm:text-base font-black tracking-[0.5em] text-slate-950 uppercase pl-[0.5em]">
                {isSample ? '样布码单' : (isDeposit ? '定金单' : '销售发货码单')}
              </h2>
            </div>

            {/* 2. Metadata Section: NO, 收货单位, Date above table */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-2 pb-0.5 text-xs text-slate-800" style={{ fontFamily: 'SimSun, serif' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
          <div style={{ border: '1px solid #000', marginTop: '4px', fontFamily: 'SimSun, serif', fontSize: '11px', color: '#1e293b', width: 'fit-content' }}>
            {isSample ? (
              <div className="print-grid" style={{ display: 'grid', gap: '1px', background: '#000', gridTemplateColumns: '94px 78px 78px 78px 78px 78px 78px 78px 94px 46px' }}>
                {/* Header */}
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>货号</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>色号</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>品名</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>成分</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>克重</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>门幅(cm)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>米数(米)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>单价(元)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>金额(元)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>备注</div>

                {/* Data rows */}
                {document.items.map((item) => {
                  const sample = item as SampleItem;
                  return (
                    <React.Fragment key={item.id}>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.itemNo}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.colorNo || '-'}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.productName}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{sample.composition || '-'}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700, wordBreak: 'break-all' }}>{sample.weight || '-'}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700, wordBreak: 'break-all' }}>{(item as SampleItem).width || '-'}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>{item.meters.toFixed(2)}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>¥{item.price.toFixed(2)}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700, color: '#2563eb' }}>¥{item.amount.toFixed(2)}</div>
                      <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.remark || ''}</div>
                    </React.Fragment>
                  );
                })}

                {/* Summary Row 1: Total Meters & Total Amount */}
                <div style={{ gridColumn: 'span 5', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  总计数（米）：<span style={{ fontWeight: 700 }}>{document.totalMeters.toFixed(2)}</span>
                </div>
                <div style={{ gridColumn: 'span 5', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  合计金额：<span style={{ color: '#2563eb', fontWeight: 700 }}>¥{document.totalAmount.toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.totalAmount)}）
                  </span>
                </div>

                {/* Summary Row 2: Total Rolls & Receivable Amount */}
                <div style={{ gridColumn: 'span 5', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  实发总匹数：<span style={{ fontWeight: 700 }}>{document.totalRolls}</span> 匹
                </div>
                <div style={{ gridColumn: 'span 5', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  应收金额：<span style={{ color: '#2563eb', fontWeight: 700 }}>¥{document.totalAmount.toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.totalAmount)}）
                  </span>
                </div>
              </div>
            ) : isDeposit ? (
              <div className="print-grid" style={{ display: 'grid', gap: '1px', background: '#000', gridTemplateColumns: '94px 78px 130px 80px 80px 94px' }}>
                {/* Header */}
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>货号</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>色号</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>品名</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>米数(米)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>单价(元)</div>
                <div style={{ padding: '6px 4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>金额(元)</div>

                {/* Data rows */}
                {document.items.map((item) => (
                  <React.Fragment key={item.id}>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.itemNo}</div>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.colorNo || '-'}</div>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', wordBreak: 'break-all' }}>{item.productName}</div>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>{item.meters.toFixed(2)}</div>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>¥{item.price.toFixed(2)}</div>
                    <div style={{ padding: '6px 8px', background: '#fff', textAlign: 'center', fontWeight: 700, color: '#2563eb' }}>¥{item.amount.toFixed(2)}</div>
                  </React.Fragment>
                ))}

                {/* Summary Row */}
                <div style={{ gridColumn: 'span 3', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  合计米数：<span style={{ fontWeight: 700 }}>{document.totalMeters.toFixed(2)}</span>
                </div>
                <div style={{ gridColumn: 'span 3', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  合计金额：<span style={{ color: '#2563eb', fontWeight: 700 }}>¥{document.totalAmount.toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.totalAmount)}）
                  </span>
                </div>

                {/* Deposit Amount Row (only for deposit) */}
                {(() => {
                  const depositPercent = document.deposit || 0;
                  const depositAmount = document.totalAmount * depositPercent / 100;
                  return (
                    <>
                      <div style={{ gridColumn: 'span 3', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                        定金金额：<span style={{ fontWeight: 700 }}>{depositPercent}%</span>
                        <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                          （大写：{numberToChineseCapital(depositAmount)}）
                        </span>
                      </div>
                      <div style={{ gridColumn: 'span 3', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                        <span style={{ color: '#2563eb', fontWeight: 700 }}>¥{depositAmount.toFixed(2)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : (
              <div className="print-grid" style={{ display: 'grid', gap: '1px', background: '#000', gridTemplateColumns: '65px 60px 70px 50px 50px 50px 50px 50px 50px 50px 50px 50px 50px 50px 65px 60px 70px' }}>
                {/* Header */}
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>货号</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>色号</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>品名</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>1</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>2</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>3</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>4</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>5</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>6</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>7</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>8</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>9</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>10</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>匹数</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>米数(米)</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>单价(元)</div>
                <div style={{ padding: '4px', textAlign: 'center', fontWeight: 600, backgroundColor: '#f1f5f9', whiteSpace: 'nowrap' }}>金额(元)</div>

                {/* Data rows with rowspan */}
                {document.items.map((item) => {
                  const sales = item as SalesItem;
                  const rolls = getRollValues(sales.rollNo, sales.meters);
                  const rowCount = Math.ceil(rolls.length / 10) || 1;

                  const cells: React.ReactNode[] = [];
                  const rowSpan = rowCount > 1 ? { gridRow: `span ${rowCount}` } as React.CSSProperties : {};

                  for (let r = 0; r < rowCount; r++) {
                    const chunkStart = r * 10;
                    const chunkRolls = rolls.slice(chunkStart, chunkStart + 10);

                    if (r === 0) {
                      cells.push(
                        <React.Fragment key={`${item.id}-${r}`}>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', wordBreak: 'break-all', ...rowSpan }}>{item.itemNo}</div>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', wordBreak: 'break-all', ...rowSpan }}>{item.colorNo || '-'}</div>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', wordBreak: 'break-all', ...rowSpan }}>{item.productName}</div>
                          {Array.from({ length: 10 }).map((_, ci) => {
                            const rv = chunkRolls[ci];
                            return (
                              <div key={ci} style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>
                                {rv !== undefined ? rv.toFixed(1) : ''}
                              </div>
                            );
                          })}
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700, ...rowSpan }}>{rolls.length}</div>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700, ...rowSpan }}>{item.meters.toFixed(2)}</div>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700, ...rowSpan }}>¥{item.price.toFixed(2)}</div>
                          <div style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700, color: '#2563eb', ...rowSpan }}>¥{item.amount.toFixed(2)}</div>
                        </React.Fragment>
                      );
                    } else {
                      cells.push(
                        <React.Fragment key={`${item.id}-${r}`}>
                          {Array.from({ length: 10 }).map((_, ci) => {
                            const rv = chunkRolls[ci];
                            return (
                              <div key={ci} style={{ padding: '6px 4px', background: '#fff', textAlign: 'center', fontWeight: 700 }}>
                                {rv !== undefined ? rv.toFixed(1) : ''}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      );
                    }
                  }
                  return <React.Fragment key={item.id}>{cells}</React.Fragment>;
                })}

                {/* Summary Row 1: Total Rolls/Meters & Total Amount */}
                <div style={{ gridColumn: 'span 9', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  总匹数：<span style={{ fontWeight: 700 }}>{document.totalRolls}</span> 匹 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 总计米数：<span style={{ fontWeight: 700 }}>{document.totalMeters.toFixed(2)}</span> 米
                </div>
                <div style={{ gridColumn: 'span 8', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  合计金额：<span style={{ color: '#2563eb', fontWeight: 700 }}>¥{document.totalAmount.toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.totalAmount)}）
                  </span>
                </div>

                {/* Summary Row 2: Deposit & Receivable Amount */}
                <div style={{ gridColumn: 'span 9', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  预收订金：<span style={{ fontWeight: 700 }}>¥{(document.deposit || 0).toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.deposit || 0)}）
                  </span>
                </div>
                <div style={{ gridColumn: 'span 8', padding: '6px 12px', backgroundColor: '#f8fafc' }}>
                  应付款：<span style={{ color: '#2563eb', fontWeight: 700 }}>¥{document.receivableAmount.toFixed(2)}</span>
                  <span style={{ fontSize: '10px', marginLeft: '8px' }}>
                    （大写：{numberToChineseCapital(document.receivableAmount)}）
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 4. Terms and Liability Statement */}
          <div className="terms-box border rounded-sm p-2 text-[11px] leading-relaxed" style={{ fontFamily: 'SimSun, serif', backgroundColor: '#f8fafc', borderColor: '#cbd5e1', color: '#334155', minWidth: 0, overflowWrap: 'break-word' }}>
            <span>备注条款：</span>
            <span className="whitespace-pre-wrap">
              {isDeposit
                ? (document.terms || companyProfile.depositTerms || '无备注条款。')
                : (document.terms || companyProfile.defaultTerms || '无备注条款。')}
            </span>
          </div>

          {/* 5. Bottom Signatures and Contact Block */}
          <div className="signature-section flex flex-col sm:flex-row sm:justify-between items-start sm:gap-2 pt-0" style={{ fontFamily: 'SimSun, serif', minWidth: 0 }}>
            {/* Left: Signatures inline on one row */}
            <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-2 text-xs text-slate-800">
              <div>
                <span>开单人签字：</span>
                <span className="underline underline-offset-4 pl-1">
                  {document.issuer || '        '}
                </span>
              </div>
              <div className="flex items-center gap-x-3 sm:gap-x-5">
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
              {isDeposit && (
              <div className="w-full text-xs text-slate-800 mt-1">
                <span>收货地址：</span>
                <span className="underline underline-offset-4">
                  {document.receiverAddress || '        '}
                </span>
              </div>
              )}
            </div>

            {/* Right: Payment QRCodes (WeChat & Alipay) - Only shown for Sample Slip */}
            {isSample && (
              <div className="flex items-center ml-auto order-first sm:order-none">
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
