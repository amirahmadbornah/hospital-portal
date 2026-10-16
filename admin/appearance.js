(() => {
  'use strict';
  const labels={background:'پس‌زمینه صفحه',surface:'کارت‌ها و سربرگ',text:'متن صفحه',sidebar:'پس‌زمینه منو',active:'گزینه فعال منو',accent:'دکمه‌ها و رنگ اصلی',heroStart:'ابتدای رنگ بنر',heroEnd:'انتهای رنگ بنر'};
  const form=document.getElementById('appearance-form'),status=document.getElementById('appearance-status'),loading=document.getElementById('appearance-loading');
  let csrfToken,defaults,categories;
  async function api(path,body){
    const response=await fetch('../api/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    if(response.status===401){location.href='login.html';throw new Error('ابتدا وارد شوید.');}
    const result=await response.json();if(!response.ok || result.success===false)throw new Error(result.message || 'دریافت اطلاعات انجام نشد.');return result;
  }
  function field(holder,key,title,color,group){
    const label=document.createElement('label');label.className='portal-color-field';
    const span=document.createElement('span');span.textContent=title;
    const input=document.createElement('input');input.type='color';input.value=color;input.dataset.group=group;input.dataset.key=key;
    label.append(span,input);document.getElementById(holder).append(label);
  }
  function values(){const data={colors:{},categories:{}};form.querySelectorAll('input[type=color]').forEach(input=>data[input.dataset.group][input.dataset.key]=input.value);return data;}
  function preview(){window.PortalAppearance.apply(values());status.textContent='پیش‌نمایش؛ برای ثبت نهایی «ذخیره و اعمال رنگ‌ها» را بزنید.';}
  form.addEventListener('input',preview);
  document.getElementById('reset-appearance').addEventListener('click',()=>{
    form.querySelectorAll('input[type=color]').forEach(input=>{input.value=input.dataset.group==='colors'?defaults[input.dataset.key]:categories.find(c=>c.id===input.dataset.key).color;});preview();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=document.getElementById('save-appearance');button.disabled=true;status.textContent='در حال ذخیره…';
    try{const result=await api('appearance.php',{...values(),csrfToken});window.PortalAppearance.apply(result.data);status.textContent=result.message;}
    catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  async function init(){
    try{
      if(window.ThemeManager)window.ThemeManager.init();
      const auth=await api('auth.php?action=check');if(!auth.authenticated){location.href='login.html';return;}csrfToken=auth.csrfToken;
      const result=await api('appearance.php');defaults=result.defaults;categories=result.categories;
      Object.entries(labels).forEach(([key,label])=>field('page-colors',key,label,result.data.colors[key],'colors'));
      categories.forEach(c=>field('category-colors',c.id,c.title,result.data.categories[c.id],'categories'));
      window.PortalAppearance.apply(result.data);form.hidden=false;loading.hidden=true;
    }catch(error){loading.textContent=error.message;}
  }
  init();
})();
