import React from 'react';
import {X} from 'lucide-react';

/** Unobtrusive dismissal control for read-only dialogs; preserve a spoken name. */
export function DialogDismissButton({onClick,label,disabled=false}:{onClick():void;label:string;disabled?:boolean}){
 return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent bg-transparent text-[#64748b] hover:border-[#e2e8f0] hover:bg-[#f1f5f9] hover:text-[#1e293b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#346ef6] disabled:opacity-40">
  <X size={18} strokeWidth={1.9} aria-hidden="true"/>
 </button>;
}
