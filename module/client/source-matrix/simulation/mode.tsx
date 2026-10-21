import { createContext } from 'react';
/** Standalone preview defaults to simulation; production defaults to real API. */
export const SourceMatrixPreviewContext=createContext(false);
