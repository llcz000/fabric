import React from 'react';
import {createRoot} from 'react-dom/client';
import CardScanGateway from '../../src/components/customer-share/CardScanGateway';
import '../../src/index.css';
const token='SCAN_FIXTURE_FIRST_CARD_TOKEN_12345';
createRoot(document.getElementById('root')!).render(<CardScanGateway token={token} internal={<main aria-label="已进入内部选样流程" className="p-6">员工选样流程</main>}/>);
