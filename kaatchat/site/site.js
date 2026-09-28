// Show only buttons that lead somewhere real.
(function () {
  var cfg = window.KAATCHAT_SITE || {};
  var app = typeof cfg.appUrl === 'string' && /^https:\/\//.test(cfg.appUrl) ? cfg.appUrl : '';
  document.querySelectorAll('.app-link').forEach(function (a) {
    if (!app) return;
    a.href = app;
    a.hidden = false;
  });
  document.querySelectorAll('.app-pending').forEach(function (p) {
    p.hidden = !!app;
  });

  fetch(cfg.releaseJson || 'release.json', { cache: 'no-store' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (rel) {
      if (!rel || typeof rel.windowsUrl !== 'string' || !/^https:\/\//.test(rel.windowsUrl) || !/^[a-f0-9]{64}$/i.test(rel.sha256 || '')) return;
      document.getElementById('win-link').href = rel.windowsUrl;
      document.getElementById('win-meta').textContent = 'Version ' + rel.version + (rel.size ? ' · ' + (rel.size / 1048576).toFixed(0) + ' MB' : '');
      document.getElementById('win-sha').textContent = 'SHA-256 ' + rel.sha256;
      document.getElementById('win-signed').textContent = rel.signed
        ? 'Signed installer.'
        : 'This build is not code-signed yet, so Windows may say the publisher is unknown. Compare the SHA-256 above with the one on the GitHub release before running it.';
      document.getElementById('win-ready').hidden = false;
      document.getElementById('win-pending').hidden = true;
      document.querySelectorAll('.dl-link').forEach(function (a) {
        a.hidden = false;
      });
    })
    .catch(function () {});
})();
