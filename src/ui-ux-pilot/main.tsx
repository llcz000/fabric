import React from 'react';
import {createRoot} from 'react-dom/client';
import '../index.css';
import {SampleCardUxPilot} from '../product-master-v2-review/SampleCardUxPilot';

createRoot(document.getElementById('root')!).render(
 <React.StrictMode><SampleCardUxPilot/></React.StrictMode>
);
