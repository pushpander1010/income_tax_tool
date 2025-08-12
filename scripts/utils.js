// /scripts/utils.js
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const fmtNum = (n, o={}) => (new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, ...o }).format(n ?? 0));
export const fmtCur = (n, c='INR') => (new Intl.NumberFormat('en-IN', { style:'currency', currency:c, maximumFractionDigits:0 }).format(n ?? 0));
export const debounce = (fn, d=150) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), d); }; };
export const serializeForm = (form) => Object.fromEntries(new FormData(form).entries());
export const setText = (el, v) => { if (el) el.textContent = v; };
export const persist = (k, v) => localStorage.setItem(k, JSON.stringify(v));
export const read = (k, d=null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export const clamp = (x, min, max) => Math.min(max, Math.max(min, x));
export const num = (v) => (v===''||v==null ? 0 : +v);
