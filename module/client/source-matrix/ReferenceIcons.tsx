/** SVG nodes transcribed from the supplied reference; no replacement icon set. */
import type { ReactNode } from 'react';
export function ReferenceSymbols(){return (<svg width="0" height="0" style={{position:"absolute"}} aria-hidden="true"><defs>

<symbol id="i-send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13"/></symbol>

<symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h6"/></symbol>

<symbol id="i-library" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5 M3 12c0 4 18 4 18 0"/></symbol>

<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/><circle cx="12" cy="12" r="10"/></symbol>

<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>

<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14 M5 12h14"/></symbol>

<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>

<symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 6-6 5 5 3-3 4 4"/><circle cx="16" cy="8" r="1"/></symbol>

<symbol id="i-link" viewBox="0 0 24 24"><path d="m10 13 4-4 M8 15l-1 1c-4 4-8-1-5-4l4-4c3-3 6-1 6 1 M16 9l1-1c4-4 8 1 5 4l-4 4c-3 3-6 1-6-1"/></symbol>

<symbol id="i-x" viewBox="0 0 24 24"><path d="m6 6 12 12 M18 6 6 18"/></symbol>

<symbol id="i-layer" viewBox="0 0 24 24"><path d="m12 2 10 6-10 6L2 8Z M2 12l10 6 10-6 M2 16l10 6 10-6"/></symbol>

<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.7v.01"/></symbol>

<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11 M12 15l4.5-4.5 M12 15 7.5 10.5"/><path d="M5 19h14"/></symbol>

</defs></svg>);}
export function ReferenceIcon({name}:{name:string}){return <svg><use href={'#i-'+name}/></svg>;}
const inline:Record<string,ReactNode>={
user:<><circle cx="12" cy="8" r="3"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
wallet:<><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18M16 12h5v5h-5z"/></>,
invite:<><path d="m3 11 18-8-6 18-4-7-8-3Z M11 14 21 3"/></>,
settings:<><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/><circle cx="12" cy="12" r="5"/></>,
help:<><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01"/></>,
logout:<><path d="M9 3H4v18h5m4-14 5 5-5 5m-5-5h10"/></>,
search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
chevron:<><path d="m9 5 7 7-7 7"/></>
};
export function ReferenceInlineIcon({name}:{name:string}){return <svg viewBox="0 0 24 24" aria-hidden="true">{inline[name]}</svg>;}
