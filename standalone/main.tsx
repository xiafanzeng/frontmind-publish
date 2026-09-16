import React from 'react';
import { createRoot } from 'react-dom/client';

import ModuleWorkspace from './App';

// Local fixtures and live business components share exactly this entry.
createRoot(document.getElementById('root')!).render(<React.StrictMode><ModuleWorkspace preview={import.meta.env.DEV} /></React.StrictMode>);
