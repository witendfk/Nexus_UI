import { createRoot } from 'react-dom/client';
import { DemoApp } from './app';
import './styles.css';

const container = document.querySelector('#root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(<DemoApp />);
