import React from 'react';
import {ArrowLeft,ArrowRight,Check,CheckCheck,Copy,Download,Eye,FileSpreadsheet,KeyRound,Link2,LogIn,Pencil,Plus,Power,Printer,QrCode,RefreshCw,RotateCcw,Save,ScanLine,Search,Share2,Trash2,Upload,UserPlus,X} from 'lucide-react';

const icons={back:ArrowLeft,next:ArrowRight,check:Check,checkAll:CheckCheck,copy:Copy,download:Download,view:Eye,excel:FileSpreadsheet,password:KeyRound,link:Link2,login:LogIn,edit:Pencil,add:Plus,power:Power,print:Printer,qr:QrCode,refresh:RefreshCw,reset:RotateCcw,save:Save,scan:ScanLine,search:Search,share:Share2,delete:Trash2,upload:Upload,member:UserPlus,close:X};
/** Explicit action semantics; decorative glyphs never replace accessible button names. */
export function ActionIcon({name}:{name:keyof typeof icons}){
 const Icon=icons[name];
 return <Icon size={16} aria-hidden="true" className="v2-action-icon"/>;
}
