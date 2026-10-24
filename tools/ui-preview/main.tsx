import React from 'react';
import {createRoot} from 'react-dom/client';
import './base.css';
import {SampleCardUxPilot} from './SampleCardUxPilot';

createRoot(document.getElementById('root')!).render(
 <React.StrictMode><SampleCardUxPilot/></React.StrictMode>
);
