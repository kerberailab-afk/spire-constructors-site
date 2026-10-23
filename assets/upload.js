/* SPIRE CONSTRUCTORS | contact form with drawing upload (contact page)
   The lead goes to /api/lead first, so the contact is captured even if a file fails.
   Then each file goes to the private R2 bucket through /api/upload in 20 MB parts,
   and /api/upload?action=notify puts the download links on the lead in GoHighLevel. */
(function () {
  'use strict';
  var form = document.querySelector('form.form[data-lead-upload]');
  if (!form) return;
  var API = (/(^|\.)spireconstructors\.com$|\.pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname))
    ? '/api/' : 'https://spire-constructors-site.pages.dev/api/';
  var MAX_FILE = 1024 * 1024 * 1024, MAX_FILES = 25;
  var OK_EXT = /\.(pdf|dwg|dxf|dwfx?|rvt|rfa|ifc|skp|zip|png|jpe?g|tiff?|heic|xlsx?|csv|docx?|txt)$/i;
  var drop = form.querySelector('[data-drop]'), input = drop.querySelector('input[type=file]');
  var list = form.querySelector('.files'), btn = form.querySelector('button[type=submit]');
  var msg = form.querySelector('.msg'), btnHTML = btn.innerHTML;
  var items = [], token = null, busy = false;

  /* ---------- picking files: drag and drop, or the file browser ---------- */
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (e) { e.preventDefault(); if (!busy) drop.classList.add('over'); });
  });
  ['dragleave', 'dragend', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function () { drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    if (!busy && e.dataTransfer && e.dataTransfer.files) add(e.dataTransfer.files);
  });
  input.addEventListener('change', function () { if (!busy) add(input.files); input.value = ''; });
  // a file dropped anywhere else on the page shouldn't open in the browser and lose the form
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  function add(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (items.some(function (it) { return it.file.name === f.name && it.file.size === f.size; })) continue;
      var err = !OK_EXT.test(f.name) ? 'This file type isn’t accepted.'
        : f.size === 0 ? 'This file is empty.'
        : f.size > MAX_FILE ? 'Files can be up to 1 GB each.'
        : items.filter(usable).length >= MAX_FILES ? 'Up to ' + MAX_FILES + ' files at a time.' : '';
      items.push(row(f, err));
    }
  }
  function usable(it) { return it.state !== 'bad'; }

  function row(f, err) {
    var li = document.createElement('li');
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.name; nm.title = f.name;
    var sz = document.createElement('span'); sz.className = 'sz'; sz.textContent = size(f.size);
    var rm = document.createElement('button'); rm.type = 'button'; rm.className = 'rm';
    rm.setAttribute('aria-label', 'Remove ' + f.name); rm.innerHTML = '&times;';
    var bar = document.createElement('span'); bar.className = 'bar'; var fill = document.createElement('i'); bar.appendChild(fill);
    li.appendChild(nm); li.appendChild(sz); li.appendChild(rm); li.appendChild(bar);
    var it = { file: f, li: li, fill: fill, state: err ? 'bad' : 'ready', key: null, sent: 0 };
    if (err) {
      li.className = 'bad';
      var e = document.createElement('span'); e.className = 'err'; e.textContent = err; li.appendChild(e);
    }
    rm.addEventListener('click', function () {
      if (busy || it.state === 'done') return;
      items.splice(items.indexOf(it), 1); li.remove();
    });
    list.appendChild(li);
    return it;
  }

  /* ---------- sending: the lead first, then the files ---------- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var hp = form.querySelector('.hp input');
    if (hp && hp.value) { form.classList.add('sent'); return; }
    var todo = items.filter(function (it) { return it.state === 'ready'; });
    msg.className = 'msg'; msg.textContent = '';

    if (token) { sendFiles(todo); return; }   // the lead is already in; this is a retry of the files

    var data = {
      fullName: (form.fullName.value || '').trim(), email: (form.email.value || '').trim(),
      phone: (form.phone.value || '').trim(), service: form.service ? form.service.value : '',
      budget: form.budget ? form.budget.value : '', details: (form.details.value || '').trim(),
      source: 'spireconstructors.com ' + (form.getAttribute('data-lead-upload') || 'form'),
      files: todo.map(function (it) { return { name: it.file.name, size: it.file.size }; })
    };
    setBusy(true, 'Sending…');
    post('lead', data).then(function (r) {
      if (!r.ok) throw new Error('lead');
      if (!todo.length) { finish(); return; }
      if (!r.uploads || !r.uploadToken) { finish('nostore'); return; }
      token = r.uploadToken;
      // the lead is captured: from here on the button only (re)sends files
      form.querySelectorAll('input:not([type=file]), select, textarea').forEach(function (el) { el.readOnly = true; el.disabled = el.tagName === 'SELECT'; });
      sendFiles(todo);
    }).catch(function () {
      setBusy(false);
      msg.className = 'msg err';
      msg.innerHTML = 'Something went wrong. Please call <a href="tel:18447747342">(844) SPIRE-GC</a> and we will pick up.';
    });
  });

  function sendFiles(todo) {
    if (!todo.length) { notify(); return; }
    var total = todo.reduce(function (s, it) { return s + it.file.size; }, 0), base = 0;
    setBusy(true, 'Uploading drawings… 0%');
    var chain = Promise.resolve();
    todo.forEach(function (it) {
      chain = chain.then(function () {
        it.state = 'up'; it.li.className = 'up';
        return uploadOne(it, function (sent) {
          it.fill.style.width = (100 * sent / it.file.size).toFixed(1) + '%';
          btn.textContent = 'Uploading drawings… ' + Math.min(99, Math.floor(100 * (base + sent) / total)) + '%';
        }).then(function () { base += it.file.size; it.state = 'done'; it.li.className = 'done'; it.fill.style.width = '100%'; });
      });
    });
    chain.then(notify).catch(function (err) {
      todo.forEach(function (it) { if (it.state === 'up') { it.state = 'ready'; it.li.className = 'retry'; } });
      setBusy(false, 'Try the upload again →');
      msg.className = 'msg err';
      msg.innerHTML = /expired/i.test(err && err.message)
        ? 'We have your details, but the upload timed out. Please email your drawings to <a href="mailto:info@spireconstructors.com">info@spireconstructors.com</a>.'
        : 'We have your details, but some drawings didn’t finish uploading. Press the button to try again, or email them to <a href="mailto:info@spireconstructors.com">info@spireconstructors.com</a>.';
    });
  }

  function uploadOne(it, progress) {
    var f = it.file, parts = [];
    return post('upload?action=create', { token: token, name: f.name, size: f.size }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'create');
      it.key = r.key;
      var step = r.partSize, n = Math.ceil(f.size / step), i = 0;
      function next() {
        if (i >= n) return post('upload?action=complete', { token: token, key: r.key, uploadId: r.uploadId, parts: parts });
        var start = i * step, num = i + 1;
        return putPart(r.key, r.uploadId, num, f.slice(start, Math.min(f.size, start + step)), function (loaded) {
          progress(start + loaded);
        }, 3).then(function (p) { parts.push({ partNumber: p.part, etag: p.etag }); i++; return next(); });
      }
      return next();
    }).then(function (r) { if (!r.ok) throw new Error(r.error || 'complete'); });
  }

  function putPart(key, uploadId, num, chunk, progress, tries) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', API + 'upload?action=part&key=' + encodeURIComponent(key) + '&uploadId=' + encodeURIComponent(uploadId) + '&part=' + num);
      x.setRequestHeader('X-Upload-Token', token);
      x.upload.onprogress = function (e) { if (e.lengthComputable) progress(e.loaded); };
      x.onload = function () {
        var r = {}; try { r = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
        if (x.status === 200 && r.ok) resolve(r); else reject(new Error(r.error || 'part ' + x.status));
      };
      x.onerror = function () { reject(new Error('network')); };
      x.send(chunk);
    }).catch(function (err) {
      if (tries <= 1 || /expired/i.test(err.message)) throw err;
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () {
        return putPart(key, uploadId, num, chunk, progress, tries - 1);
      });
    });
  }

  function notify() {
    var done = items.filter(function (it) { return it.state === 'done'; });
    var files = done.map(function (it) { return { key: it.key }; });
    var attempt = function (n) {
      return post('upload?action=notify', { token: token, files: files }).then(function (r) {
        if (!r.ok && n > 1) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return attempt(n - 1); });
      });
    };
    // the files are already stored under this lead; a failed note doesn't stop the thank-you
    attempt(3).catch(function () {}).then(function () { finish(null, done.length); });
  }

  /* ---------- helpers ---------- */
  function finish(note, n) {
    busy = false; window.onbeforeunload = null;
    var p = form.querySelector('.thanks-files');
    if (p) {
      if (note === 'nostore') { p.innerHTML = 'We couldn’t take files online just now, so please email your drawings to <a href="mailto:info@spireconstructors.com">info@spireconstructors.com</a>.'; p.hidden = false; }
      else if (n) { p.textContent = 'Your drawings came through: ' + n + ' file' + (n === 1 ? '' : 's') + '.'; p.hidden = false; }
    }
    form.classList.add('sent');
    // the form shrinks to the thank-you, so bring it into view
    form.scrollIntoView({ block: 'center' });
  }

  function setBusy(on, label) {
    busy = on;
    btn.disabled = on;
    drop.classList.toggle('locked', on);
    input.disabled = on;
    if (label) btn.textContent = label; else btn.innerHTML = btnHTML;
    window.onbeforeunload = on && token ? function (e) { e.preventDefault(); e.returnValue = ''; return ''; } : null;
  }

  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) j.ok = false; return j; });
      });
  }

  function size(n) {
    return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB'
      : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB'
      : Math.max(1, Math.round(n / 1024)) + ' KB';
  }
})();
