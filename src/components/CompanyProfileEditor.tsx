/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { CompanyProfile } from '../types';
import { Save, RefreshCw, Landmark, Phone, MapPin, ClipboardList, PenTool, Upload, Image as ImageIcon } from 'lucide-react';

interface CompanyProfileEditorProps {
  profile: CompanyProfile;
  onSave: (updatedProfile: CompanyProfile) => void;
}

export default function CompanyProfileEditor({ profile, onSave }: CompanyProfileEditorProps) {
  const [name, setName] = useState(profile.name);
  const [logoText, setLogoText] = useState(profile.logoText);
  const [address, setAddress] = useState(profile.address);
  const [phone, setPhone] = useState(profile.phone);
  const [defaultTerms, setDefaultTerms] = useState(profile.defaultTerms);
  const [depositTerms, setDepositTerms] = useState(profile.depositTerms || '');
  const [issuerLabel, setIssuerLabel] = useState(profile.issuerLabel);
  const [receiverLabel, setReceiverLabel] = useState(profile.receiverLabel);
  const [isSaved, setIsSaved] = useState(false);
  
  const [logoUrl, setLogoUrl] = useState(profile.logoUrl || '');
  const [weChatPayUrl, setWeChatPayUrl] = useState(profile.weChatPayUrl || '');
  const [aliPayUrl, setAliPayUrl] = useState(profile.aliPayUrl || '');

  useEffect(() => {
    setName(profile.name);
    setLogoText(profile.logoText);
    setAddress(profile.address);
    setPhone(profile.phone);
    setDefaultTerms(profile.defaultTerms);
    setDepositTerms(profile.depositTerms || '');
    setIssuerLabel(profile.issuerLabel);
    setReceiverLabel(profile.receiverLabel);
    setLogoUrl(profile.logoUrl || '');
    setWeChatPayUrl(profile.weChatPayUrl || '');
    setAliPayUrl(profile.aliPayUrl || '');
  }, [profile]);

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (value: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('图片文件大小不能超过 2MB，请选择压缩后的图片！');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setter(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      logoText,
      logoType: logoUrl ? 'image' : 'text',
      logoUrl,
      address,
      phone,
      defaultTerms,
      depositTerms,
      issuerLabel,
      receiverLabel,
      weChatPayUrl,
      aliPayUrl,
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const resetToDefault = () => {
    if (confirm('确认恢复系统默认设置吗？已修改的信息将会被覆盖。')) {
      setName('织梦盛世面料品贸易有限公司');
      setLogoText('织梦面料 · DREAM WEAVE');
      setAddress('浙江省绍兴市柯桥区中国轻纺城创意路88号3层');
      setPhone('0575-81234567');
      setIssuerLabel('开单人（签字）：');
      setReceiverLabel('收货人（签收）：');
      setDefaultTerms(
        '1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。\n2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。\n3. 签收效力：开单人与收货人签字即具有同等合同效力，开单电话可作为业务沟通与对账的主要凭证。'
      );
      setDepositTerms('');
      setLogoUrl('');
      setWeChatPayUrl('');
      setAliPayUrl('');
    }
  };

  return (
    <div id="company-profile-editor" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-linear-to-r from-sky-50 to-white">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-sky-600" />
          公司及单据排版信息配置
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          设置打印单据顶部及底部的基本展示信息，新建单据时将默认加载此配置。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              公司名称
            </label>
            <input
              type="text"
              id="company-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm font-medium"
              required
              placeholder="请输入要在单据顶部显示的公司名称"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              公司地址
            </label>
            <input
              type="text"
              id="company-address-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600"
              required
              placeholder="请输入公司详细地址"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              公司电话
            </label>
            <input
              type="text"
              id="company-phone-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600"
              required
              placeholder="请输入公司电话"
            />
          </div>
        </div>

        {/* Company Logo and Payment QR Code uploads */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
            <ImageIcon className="w-4 h-4 text-sky-600" />
            Logo图片与支付收款码（图片可配置）
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Logo Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                单据右上角Logo图片
              </label>
              <div className="flex flex-col items-center justify-center border border-dashed border-slate-200 hover:border-sky-500 rounded-xl p-4 bg-slate-50/50 transition-colors relative min-h-[140px]">
                {logoUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={logoUrl} className="max-h-20 max-w-full object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs" alt="Logo预览" referrerPolicy="no-referrer" />
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold"
                    >
                      删除Logo图片
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center gap-1.5 text-center w-full">
                    <span className="p-2 bg-white rounded-full shadow-xs text-sky-600">
                      <Upload className="w-5 h-5" />
                    </span>
                    <span className="text-xs text-slate-500 font-medium">点击上传公司Logo</span>
                    <span className="text-[10px] text-slate-400">支持 2MB 以内的图片</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setLogoUrl)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* WeChat QR Code Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                微信收款码 (右下角展示)
              </label>
              <div className="flex flex-col items-center justify-center border border-dashed border-slate-200 hover:border-sky-500 rounded-xl p-4 bg-slate-50/50 transition-colors relative min-h-[140px]">
                {weChatPayUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={weChatPayUrl} className="max-h-20 max-w-full object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs" alt="微信收款码预览" referrerPolicy="no-referrer" />
                    <button
                      type="button"
                      onClick={() => setWeChatPayUrl('')}
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold"
                    >
                      删除微信收款码
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center gap-1.5 text-center w-full">
                    <span className="p-2 bg-white rounded-full shadow-xs text-emerald-600">
                      <Upload className="w-5 h-5" />
                    </span>
                    <span className="text-xs text-slate-500 font-medium">点击上传微信收款码</span>
                    <span className="text-[10px] text-slate-400">展示于单据右下方</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setWeChatPayUrl)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Alipay QR Code Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                支付宝收款码 (右下角展示)
              </label>
              <div className="flex flex-col items-center justify-center border border-dashed border-slate-200 hover:border-sky-500 rounded-xl p-4 bg-slate-50/50 transition-colors relative min-h-[140px]">
                {aliPayUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={aliPayUrl} className="max-h-20 max-w-full object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs" alt="支付宝收款码预览" referrerPolicy="no-referrer" />
                    <button
                      type="button"
                      onClick={() => setAliPayUrl('')}
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold"
                    >
                      删除支付宝收款码
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer flex flex-col items-center gap-1.5 text-center w-full">
                    <span className="p-2 bg-white rounded-full shadow-xs text-blue-600">
                      <Upload className="w-5 h-5" />
                    </span>
                    <span className="text-xs text-slate-500 font-medium">点击上传支付宝收款码</span>
                    <span className="text-[10px] text-slate-400">展示于单据右下方</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleImageUpload(e, setAliPayUrl)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-slate-50">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <PenTool className="w-3.5 h-3.5 text-slate-400" />
              开单人签字栏文本
            </label>
            <input
              type="text"
              id="company-issuer-label-input"
              value={issuerLabel}
              onChange={(e) => setIssuerLabel(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600"
              required
              placeholder="如：开单人（签字）："
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <PenTool className="w-3.5 h-3.5 text-slate-400" />
              收货人签字栏文本
            </label>
            <input
              type="text"
              id="company-receiver-label-input"
              value={receiverLabel}
              onChange={(e) => setReceiverLabel(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600"
              required
              placeholder="如：收货人（签收）："
            />
          </div>
        </div>

        <div className="space-y-1 pt-3 border-t border-slate-50">
          <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5 text-slate-400" />
            默认备注条款 - 样布码单（将在单据下方显示）
          </label>
          <textarea
            id="company-default-terms-input"
            value={defaultTerms}
            onChange={(e) => setDefaultTerms(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 leading-relaxed font-mono"
            placeholder="请输入样布码单备注条款..."
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5 text-amber-400" />
            默认备注条款 - 定金单
          </label>
          <textarea
            id="company-deposit-terms-input"
            value={depositTerms}
            onChange={(e) => setDepositTerms(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 leading-relaxed font-mono"
            placeholder="请输入定金单备注条款..."
          />
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <button
            type="button"
            id="btn-reset-profile"
            onClick={resetToDefault}
            className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            恢复系统预设
          </button>

          <button
            type="submit"
            id="btn-save-profile"
            className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium shadow-xs hover:shadow-md cursor-pointer transition-all duration-150"
          >
            <Save className="w-4 h-4" />
            {isSaved ? '已成功保存配置！' : '保存配置信息'}
          </button>
        </div>
      </form>
    </div>
  );
}
