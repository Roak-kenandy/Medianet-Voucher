(function () {
  var key = 'medianet-theme-preference';
  var pref = 'system';
  try {
    pref = localStorage.getItem(key) || 'system';
  } catch (e) {
    /* storage unavailable */
  }
  var dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
