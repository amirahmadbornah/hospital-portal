(() => {
  'use strict';
  const root = new URL('../', location.href);
  const portal = new URL('index.html', root);
  portal.searchParams.set('login', '1');
  portal.searchParams.set('next', new URL('admin/dashboard.html', root).pathname);
  location.replace(portal.href);
})();
