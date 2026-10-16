/* Shared navigation shell. Existing portal modules keep their elements and listeners. */
(() => {
  'use strict';
  if (document.querySelector('.admin-auth-page')) return;
  const script = document.currentScript;
  const root = new URL('../../', script.src);
  const relative = location.pathname.slice(root.pathname.length);
  const admin = relative.startsWith('admin/');
  const sidebar = document.createElement('aside');
  sidebar.className = 'hs-sidebar'; sidebar.id = 'hospital-navigation'; sidebar.setAttribute('aria-label', 'منوی اصلی');
  const brand = document.createElement('a'); brand.className = 'hs-brand'; brand.href = root.href;
  brand.innerHTML = '<span><strong>Hospital Systems</strong><small>پرتال یکپارچه بیمارستان</small></span>';
  const logo=document.createElement('img');logo.className='portal-hospital-logo';logo.src=new URL('assets/images/logo-madani.png',root).href;logo.alt='نشان بیمارستان شهید مدنی';logo.width=150;logo.height=80;
  brand.prepend(logo.cloneNode());
  sidebar.append(brand);
  const nav = document.createElement('nav'); nav.className = 'hs-nav'; nav.setAttribute('aria-label', 'ناوبری پرتال'); sidebar.append(nav);
  function label(text) { const node = document.createElement('div'); node.className = 'hs-nav-label'; node.textContent = text; nav.append(node); }
  function link(text, path, icon, active=false) {
    const a=document.createElement('a'); a.href=new URL(path,root).href;
    const mark=document.createElement('span'); mark.className='hs-nav-icon'; mark.textContent=icon;
    const title=document.createElement('span'); title.textContent=text; a.append(mark,title);
    if(active)a.setAttribute('aria-current','page'); nav.append(a); return a;
  }
  label('اصلی'); link('داشبورد پرتال','index.html','📊',!admin);
  const formsSource=document.getElementById('forms-widget-link');
  if(formsSource) {
    const forms=link('سامانه مدیریت و فرم‌ها','index.html','📝');
    const syncForms=()=>{if(formsSource.getAttribute('href') && formsSource.getAttribute('href')!=='#') forms.href=formsSource.href;};
    new MutationObserver(syncForms).observe(formsSource,{attributes:true,attributeFilter:['href']});syncForms();
    forms.addEventListener('click',event=>{event.preventDefault();formsSource.click();});
  }
  if(!admin) {
    label('دسته‌بندی‌ها');
    const categories=document.getElementById('categories-container');
    if(categories) {
      const holder=document.createElement('div'); holder.className='hs-nav'; nav.append(holder);
      const refresh=()=> { holder.replaceChildren();
        categories.querySelectorAll('.category__title').forEach((heading,index)=> {
          if(!heading.id)heading.id='portal-category-'+index;
          const a=document.createElement('a'); a.href='#'+heading.id; a.textContent=heading.textContent; a.dataset.categoryId=heading.closest('.category').dataset.categoryId; a.className='portal-category-link'; a.style.setProperty('--accent',heading.closest('.category').style.getPropertyValue('--accent')); holder.append(a);
        });
      };
      new MutationObserver(refresh).observe(categories,{childList:true,subtree:true}); refresh();
    }
  }
  label('مدیریت'); link('مدیریت لینک‌ها','admin/dashboard.html','🔗',relative==='admin/dashboard.html');
  link('مدیریت اعلان‌ها','admin/announcements.html','📢',relative==='admin/announcements.html');
  link('رنگ‌بندی پرتال','admin/appearance.html','🎨',relative==='admin/appearance.html');
  const foot=document.createElement('div'); foot.className='hs-sidebar-footer'; foot.textContent='واحد فناوری اطلاعات بیمارستان'; sidebar.append(foot);
  const shell=document.createElement('div'); shell.className='portal-shell-content';
  for(const el of Array.from(document.body.children)) if(el.matches('header.site-header,main.page-wrap,footer.site-footer'))shell.append(el);
  document.body.prepend(sidebar,shell);
  const topbar=shell.querySelector('.header-inner');
  const backdrop=document.createElement('button'); backdrop.className='portal-menu-backdrop'; backdrop.hidden=true; backdrop.tabIndex=-1; backdrop.setAttribute('aria-label','بستن منو'); document.body.append(backdrop);
  const button=document.createElement('button');button.type='button';button.className='admin-btn portal-menu-toggle';button.textContent='☰';button.setAttribute('aria-controls',sidebar.id);button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','باز و بسته کردن منو');
  function toggle(open){sidebar.classList.toggle('portal-menu-open',open);backdrop.hidden=!open;button.setAttribute('aria-expanded',String(open));if(!open)button.focus();}
  button.addEventListener('click',()=>toggle(backdrop.hidden));backdrop.addEventListener('click',()=>toggle(false));
  sidebar.addEventListener('click',e=>{if(e.target.closest('a')&&!backdrop.hidden)toggle(false);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!backdrop.hidden)toggle(false);});
  if(topbar)topbar.prepend(button);
  if(!admin){const main=shell.querySelector('main');const welcome=document.createElement('section');welcome.className='portal-welcome';welcome.innerHTML='<div><h2>پرتال یکپارچه بیمارستان</h2><p>دسترسی سریع به سامانه‌های بالینی و اداری بیمارستان</p></div>';welcome.append(logo.cloneNode());main.prepend(welcome);}
})();
