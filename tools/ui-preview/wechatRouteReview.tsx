import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/index.css';
import './wechatReview.css';
import PublicPatternPage from '../../src/components/customer-share/PublicPatternPage';

/** Entire production React data-fetching path; network must be mocked in browser tests.
 * The static review server has NO /api/public route, real token or customer image. */
const fixtureToken='a'.repeat(43);
createRoot(document.getElementById('root')!).render(<React.StrictMode>
 <div style={{background:'#fff6e9',fontSize:12,textAlign:'center',padding:'8px 14px',color:'#795923'}}>本机隔离测试 · 非真实令牌 · 不可发送客户</div>
 <PublicPatternPage token={fixtureToken} cardOnly/>
 </React.StrictMode>);