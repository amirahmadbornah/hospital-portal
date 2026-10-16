(() => {
  'use strict';
  const root = new URL('../../', document.currentScript.src);
  let settings = null;
  const valid = color => typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color);
  function foreground(color) {
    const rgb=color.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#102030':'#FFFFFF';
  }
  function paintCategories() {
    if (!settings) return;
    document.querySelectorAll('[data-category-id]').forEach(el=>{
      const color=settings.categories[el.dataset.categoryId];
      if(valid(color)) {el.style.setProperty('--accent',color);el.style.setProperty('--category-text',foreground(color));}
    });
  }
  function apply(next) {
    if(!next || !next.colors || !next.categories || !Object.values(next.colors).every(valid) || !Object.values(next.categories).every(valid)) return;
    settings=next;
    let style=document.getElementById('portal-custom-colors');
    if(!style){style=document.createElement('style');style.id='portal-custom-colors';document.head.append(style);}
    const c=next.colors;
    style.textContent=`:root,:root[data-theme="light"]{--bg-base:${c.background};--surface:${c.surface};--surface-solid:${c.surface};--header-bg:${c.surface};--text-primary:${c.text};--text-secondary:color-mix(in srgb,${c.text} 80%,${c.surface});--text-muted:color-mix(in srgb,${c.text} 70%,${c.surface});--color-primary:${c.accent};--color-primary-light:${c.accent};--color-primary-dark:${c.accent};}
      :root{--menu-bg:${c.sidebar};--menu-text:${foreground(c.sidebar)};--menu-active:${c.active};--menu-active-text:${foreground(c.active)};--portal-accent:${c.accent};--portal-accent-text:${foreground(c.accent)};--portal-hero-start:${c.heroStart};--portal-hero-end:${c.heroEnd};--portal-hero-text:${foreground(c.heroStart)};}`;
    paintCategories();
  }
  window.PortalAppearance={apply};
  // Search and polling rebuild cards; keep their saved category colors.
  new MutationObserver(paintCategories).observe(document.body,{childList:true,subtree:true});
  async function refresh(){if(document.getElementById('appearance-form'))return;try{const response=await fetch(new URL('api/appearance.php',root),{cache:'no-store',credentials:'same-origin'});if(response.ok){const data=await response.json();if(data.success)apply(data.data);}}catch(error){/* Keep the default palette while offline. */}}
  refresh();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.setInterval(refresh,60000);
})();
