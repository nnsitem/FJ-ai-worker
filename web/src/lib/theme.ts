/**
 * Light or dark, following the OS: applied as `data-theme` on <html>, which
 * swaps the colour tokens (globals.css, as in AI Office). A script in the root
 * layout sets it before the first paint and keeps it in step after, so the
 * app never opens dark and then flips.
 */
export const THEME_BOOT = `try{var m=matchMedia('(prefers-color-scheme: light)');var a=function(){document.documentElement.dataset.theme=m.matches?'light':'dark'};a();m.addEventListener('change',a)}catch(e){}`;
