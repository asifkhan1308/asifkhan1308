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
      showMac(rel && rel.mac);
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

  function showMac(mac) {
    var ok = function (b) {
      return b && typeof b.url === 'string' && /^https:\/\//.test(b.url) && /^[a-f0-9]{64}$/i.test(b.sha256 || '');
    };
    if (!mac || !ok(mac.arm64) || !ok(mac.x64)) return;
    document.getElementById('mac-arm64-link').href = mac.arm64.url;
    document.getElementById('mac-x64-link').href = mac.x64.url;
    document.getElementById('mac-meta').textContent = 'Version ' + mac.version + (mac.arm64.size ? ' · ' + (mac.arm64.size / 1048576).toFixed(0) + ' MB' : '');
    document.getElementById('mac-sha').textContent = 'SHA-256 Apple Silicon ' + mac.arm64.sha256 + ' · Intel ' + mac.x64.sha256;
    document.getElementById('mac-signed').textContent = mac.signed
      ? 'Signed and notarized by Apple.'
      : 'Not notarized yet: the first time, macOS will refuse to open it. Open System Settings → Privacy & Security and choose "Open Anyway". Compare the SHA-256 with the GitHub release first.';
    document.getElementById('mac-ready').hidden = false;
    document.getElementById('mac-pending').hidden = true;
  }
})();

// Support the artist: a QR dialog that can be opened, copied from, or shared as a link.
(function () {
  var dlg = document.getElementById('support');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var status = document.getElementById('support-status');
  var upiId = 'aafatkhan666-1@okicici';
  var link = location.origin + location.pathname + '#support';
  function say(msg) {
    status.textContent = msg;
  }
  function open() {
    if (!dlg.open) dlg.showModal();
    say('');
  }
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          say(done);
        },
        function () {
          say(text);
        },
      );
    } else say(text);
  }
  document.querySelectorAll('.support-open').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      open();
    });
  });
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) dlg.close(); // click on the backdrop
  });
  dlg.addEventListener('close', function () {
    if (location.hash === '#support') history.replaceState(null, '', location.pathname + location.search);
  });
  document.getElementById('support-copy').addEventListener('click', function () {
    copy(upiId, 'UPI ID copied.');
  });
  document.getElementById('support-share').addEventListener('click', function () {
    var data = { title: 'Support Asif Khan', text: 'Support Kaatchat by Asif Khan — UPI ' + upiId, url: link };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
    } else {
      copy(link, 'Link copied — anyone who opens it sees this QR code.');
    }
  });
  if (location.hash === '#support') open();
  window.addEventListener('hashchange', function () {
    if (location.hash === '#support') open();
  });
})();
