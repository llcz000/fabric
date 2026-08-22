/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Save, RefreshCw, Landmark, Phone, MapPin, ClipboardList, PenTool, Upload, Image as ImageIcon } from 'lucide-react';

import type { CompanyImageRole, CompanyProfile } from '../types';
import { ImageAssetClientError, uploadImageAsset } from '../lib/imageAssets';
import {
  buildCompanyImageMutations,
  COMPANY_IMAGE_ROLES,
  createCompanyImageState,
  releaseCompanyImageObjectUrl,
  releaseCompanyImageObjectUrls,
  replaceCompanyImagePreview,
  type CompanyImageMutation,
  type CompanyImageObjectUrls,
  type CompanyImageState,
} from '../lib/companyImageState';

interface CompanyProfileEditorProps {
  profile: CompanyProfile;
  onSave(updatedProfile: CompanyProfile, imageMutations: CompanyImageMutation[]): Promise<void>;
  apiFetch: typeof fetch;
}

const IMAGE_FIELD_DETAILS: Record<CompanyImageRole, {
  purpose: 'company_logo' | 'company_qr';
  label: string;
  uploadLabel: string;
  removeLabel: string;
  hint: string;
  accent: string;
  alt: string;
}> = {
  brand_logo: {
    purpose: 'company_logo', label: '单据右上角Logo图片', uploadLabel: '点击上传公司Logo', removeLabel: '删除Logo图片',
    hint: '支持 2MB 以内的图片', accent: 'text-sky-600', alt: 'Logo预览',
  },
  wechat_qr: {
    purpose: 'company_qr', label: '微信收款码 (右下角展示)', uploadLabel: '点击上传微信收款码', removeLabel: '删除微信收款码',
    hint: '展示于单据右下方', accent: 'text-emerald-600', alt: '微信收款码预览',
  },
  alipay_qr: {
    purpose: 'company_qr', label: '支付宝收款码 (右下角展示)', uploadLabel: '点击上传支付宝收款码', removeLabel: '删除支付宝收款码',
    hint: '展示于单据右下方', accent: 'text-blue-600', alt: '支付宝收款码预览',
  },
};

export type { CompanyImageMutation } from '../lib/companyImageState';

export default function CompanyProfileEditor({ profile, onSave, apiFetch }: CompanyProfileEditorProps) {
  const [name, setName] = useState(profile.name);
  const [logoText, setLogoText] = useState(profile.logoText);
  const [address, setAddress] = useState(profile.address);
  const [phone, setPhone] = useState(profile.phone);
  const [defaultTerms, setDefaultTerms] = useState(profile.defaultTerms);
  const [depositTerms, setDepositTerms] = useState(profile.depositTerms || '');
  const [issuerLabel, setIssuerLabel] = useState(profile.issuerLabel);
  const [receiverLabel, setReceiverLabel] = useState(profile.receiverLabel);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [imageState, setImageState] = useState<CompanyImageState>(() => createCompanyImageState(profile));
  const objectUrls = useRef<CompanyImageObjectUrls>({});
  const uploadRevisions = useRef<Record<CompanyImageRole, number>>({ brand_logo: 0, wechat_qr: 0, alipay_qr: 0 });
  const mounted = useRef(true);
  const imageAssetsEnabled = profile.companyImages !== undefined;

  const releaseObjectUrls = () => releaseCompanyImageObjectUrls(objectUrls.current, URL.revokeObjectURL);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const role of COMPANY_IMAGE_ROLES) uploadRevisions.current[role] += 1;
      releaseObjectUrls();
    };
  }, []);

  useEffect(() => {
    for (const role of COMPANY_IMAGE_ROLES) uploadRevisions.current[role] += 1;
    releaseObjectUrls();
    setName(profile.name);
    setLogoText(profile.logoText);
    setAddress(profile.address);
    setPhone(profile.phone);
    setDefaultTerms(profile.defaultTerms);
    setDepositTerms(profile.depositTerms || '');
    setIssuerLabel(profile.issuerLabel);
    setReceiverLabel(profile.receiverLabel);
    setImageState(createCompanyImageState(profile));
  }, [profile]);

  const replaceImageState = (role: CompanyImageRole, next: CompanyImageState[CompanyImageRole]) => {
    releaseCompanyImageObjectUrl(objectUrls.current, role, URL.revokeObjectURL);
    setImageState((current) => replaceCompanyImagePreview(current, role, next));
  };

  const handleImageUpload = (role: CompanyImageRole, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !imageAssetsEnabled) return;

    const revision = uploadRevisions.current[role] + 1;
    uploadRevisions.current[role] = revision;
    const previewUrl = URL.createObjectURL(file);
    replaceImageState(role, { previewUrl, dirty: false, uploading: true });
    objectUrls.current[role] = previewUrl;

    void uploadImageAsset(file, IMAGE_FIELD_DETAILS[role].purpose, { apiFetch })
      .then((asset) => {
        if (!mounted.current || uploadRevisions.current[role] !== revision) return;
        setImageState((current) => ({
          ...current,
          [role]: { assetId: asset.id, previewUrl, dirty: true, uploading: false },
        }));
      })
      .catch((error: unknown) => {
        if (!mounted.current || uploadRevisions.current[role] !== revision) return;
        setImageState((current) => ({
          ...current,
          [role]: { previewUrl, dirty: false, uploading: false, error: formatImageError(error) },
        }));
      });
  };

  const handleImageRemove = (role: CompanyImageRole) => {
    uploadRevisions.current[role] += 1;
    const hadStoredImage = Boolean(createCompanyImageState(profile)[role].previewUrl);
    replaceImageState(role, { dirty: hadStoredImage, uploading: false });
  };

  const hasUnreadyImage = COMPANY_IMAGE_ROLES.some((role) => imageState[role].uploading || Boolean(imageState[role].error));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || hasUnreadyImage) return;
    setIsSaving(true);
    try {
      await onSave({
        name,
        logoText,
        logoType: profile.logoUrl ? 'image' : 'text',
        logoUrl: profile.logoUrl,
        address,
        phone,
        defaultTerms,
        depositTerms,
        issuerLabel,
        receiverLabel,
        weChatPayUrl: profile.weChatPayUrl,
        aliPayUrl: profile.aliPayUrl,
        ...(profile.companyImages !== undefined ? { companyImages: profile.companyImages } : {}),
      }, buildCompanyImageMutations(imageState, imageAssetsEnabled));
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (error) {
      alert(formatImageError(error) || '保存失败，请重试');
    } finally {
      if (mounted.current) setIsSaving(false);
    }
  };

  const resetToDefault = () => {
    if (!confirm('确认恢复系统默认设置吗？已修改的信息将会被覆盖。')) return;
    setName('织梦盛世面料品贸易有限公司');
    setLogoText('织梦面料 · DREAM WEAVE');
    setAddress('浙江省绍兴市柯桥区中国轻纺城创意路88号3层');
    setPhone('0575-81234567');
    setIssuerLabel('开单人（签字）：');
    setReceiverLabel('收货人（签收）：');
    setDefaultTerms('1. 质量异议提出期限：买方在收到货物之日起3日内核对数量与质量。如对品质有任何异议，请在剪样、开裁或深加工前提出，否则视为合格，深加工后恕不退换。\n2. 结算方式：本单据为结算及法律权利主张之重要凭证，请买方妥善留存并按约定账期付清货款。\n3. 签收效力：开单人与收货人签字即具有同等合同效力，开单电话可作为业务沟通与对账的主要凭证。');
    setDepositTerms('');
  };

  return (
    <div id="company-profile-editor" className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-linear-to-r from-sky-50 to-white">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Landmark className="w-5 h-5 text-sky-600" />公司及单据排版信息配置</h3>
        <p className="text-sm text-slate-500 mt-1">设置打印单据顶部及底部的基本展示信息，新建单据时将默认加载此配置。</p>
      </div>
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="公司名称" id="company-name-input" value={name} onChange={setName} required wide />
          <Field label="公司地址" id="company-address-input" value={address} onChange={setAddress} required icon={<MapPin className="w-3.5 h-3.5 text-slate-400" />} />
          <Field label="公司电话" id="company-phone-input" value={phone} onChange={setPhone} required icon={<Phone className="w-3.5 h-3.5 text-slate-400" />} />
        </div>
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1"><ImageIcon className="w-4 h-4 text-sky-600" />Logo图片与支付收款码</h4>
          {!imageAssetsEnabled && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">图片资产功能未启用；现有历史图片保持不变，启用后可替换或删除。</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {COMPANY_IMAGE_ROLES.map((role) => {
              const detail = IMAGE_FIELD_DETAILS[role];
              const image = imageState[role];
              return <div className="space-y-1.5" key={role}>
                <label className="text-xs font-semibold text-slate-600 flex items-center gap-1">{detail.label}</label>
                <div className="flex flex-col items-center justify-center border border-dashed border-slate-200 hover:border-sky-500 rounded-xl p-4 bg-slate-50/50 transition-colors relative min-h-[140px]">
                  {image.previewUrl ? <div className="flex flex-col items-center gap-2">
                    <img src={image.previewUrl} className="max-h-20 max-w-full object-contain rounded border border-slate-200 p-0.5 bg-white shadow-xs" alt={detail.alt} />
                    {imageAssetsEnabled && <label className="text-xs text-sky-600 hover:text-sky-800 font-semibold cursor-pointer">替换图片<input type="file" accept="image/*" onChange={(event) => handleImageUpload(role, event)} className="hidden" disabled={image.uploading} /></label>}
                    {imageAssetsEnabled && <button type="button" onClick={() => handleImageRemove(role)} className="text-xs text-rose-500 hover:text-rose-700 font-semibold" disabled={image.uploading}>{detail.removeLabel}</button>}
                  </div> : <label className={`cursor-pointer flex flex-col items-center gap-1.5 text-center w-full ${imageAssetsEnabled ? '' : 'cursor-not-allowed opacity-60'}`}>
                    <span className={`p-2 bg-white rounded-full shadow-xs ${detail.accent}`}><Upload className="w-5 h-5" /></span>
                    <span className="text-xs text-slate-500 font-medium">{detail.uploadLabel}</span>
                    <span className="text-[10px] text-slate-400">{detail.hint}</span>
                    <input type="file" accept="image/*" onChange={(event) => handleImageUpload(role, event)} className="hidden" disabled={!imageAssetsEnabled || image.uploading} />
                  </label>}
                  {image.uploading && <p className="mt-2 text-xs text-sky-700">图片上传处理中，完成后可保存。</p>}
                  {image.error && <p className="mt-2 text-xs text-rose-600">{image.error}</p>}
                </div>
              </div>;
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-slate-50">
          <Field label="开单人签字栏文本" id="company-issuer-label-input" value={issuerLabel} onChange={setIssuerLabel} required icon={<PenTool className="w-3.5 h-3.5 text-slate-400" />} />
          <Field label="收货人签字栏文本" id="company-receiver-label-input" value={receiverLabel} onChange={setReceiverLabel} required icon={<PenTool className="w-3.5 h-3.5 text-slate-400" />} />
        </div>
        <TextArea label="默认备注条款 - 样布码单" id="company-default-terms-input" value={defaultTerms} onChange={setDefaultTerms} />
        <TextArea label="默认备注条款 - 定金单" id="company-deposit-terms-input" value={depositTerms} onChange={setDepositTerms} amber />
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <button type="button" id="btn-reset-profile" onClick={resetToDefault} className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 hover:border-slate-300 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-700 bg-slate-50 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" />恢复系统预设</button>
          <button type="submit" id="btn-save-profile" disabled={isSaving || hasUnreadyImage} className="flex items-center gap-2 px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-400 text-white rounded-lg text-sm font-medium shadow-xs hover:shadow-md cursor-pointer transition-all duration-150"><Save className="w-4 h-4" />{isSaving ? '保存中…' : isSaved ? '已成功保存配置！' : hasUnreadyImage ? '等待图片准备完成' : '保存配置信息'}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, id, value, onChange, required, wide, icon }: { label: string; id: string; value: string; onChange(value: string): void; required?: boolean; wide?: boolean; icon?: React.ReactNode }) {
  return <div className={`space-y-1 ${wide ? 'md:col-span-2' : ''}`}><label className="text-xs font-medium text-slate-600 flex items-center gap-1">{icon}{label}</label><input type="text" id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600" /></div>;
}

function TextArea({ label, id, value, onChange, amber }: { label: string; id: string; value: string; onChange(value: string): void; amber?: boolean }) {
  return <div className="space-y-1"><label className="text-xs font-medium text-slate-600 flex items-center gap-1"><ClipboardList className={`w-3.5 h-3.5 ${amber ? 'text-amber-400' : 'text-slate-400'}`} />{label}</label><textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm text-slate-600 leading-relaxed font-mono" /></div>;
}

function formatImageError(error: unknown): string {
  if (error instanceof ImageAssetClientError) return error.requestId ? `${error.message}（请求 ID：${error.requestId}）` : error.message;
  return error instanceof Error ? error.message : '图片处理失败，请重试。';
}
