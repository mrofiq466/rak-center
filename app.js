(() => {
  const API = '/api';
  const $ = (s) => document.querySelector(s);
  const grid = $('#cardGrid');
  const itemDialog = $('#itemDialog');
  const viewerDialog = $('#viewerDialog');
  const supportDialog = $('#supportDialog');
  const form = $('#itemForm');
  const serverStatus = document.createElement('div');
  serverStatus.className = 'server-ok';
  serverStatus.textContent = 'Menghubungi server...';
  $('#topbarStatus')?.appendChild(serverStatus);

  let items = [];
  let activeFilter = 'all';
  let editingId = null;
  let editingUrl = '';

  // Token API diisi server saat mode jaringan terbuka; kosong saat lokal
  const API_TOKEN = document.querySelector('meta[name="rak-token"]')?.content || '';

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(API_TOKEN && API_TOKEN !== '__RAK_TOKEN__' ? { 'X-Rak-Token': API_TOKEN } : {}),
        ...opts.headers
      },
      credentials: 'same-origin',
      ...opts
    });
    if (res.status === 401) {
      // sesi habis / belum login -> arahkan ke halaman login
      location.href = '/login';
      throw new Error('Sesi berakhir, silakan masuk kembali');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const serverState = { online: false, authRequired: true };

  function renderStatus() {
    if (!serverState.online) {
      serverStatus.textContent = 'Server tidak aktif — jalankan `npm start`';
      serverStatus.className = 'server-err';
      return;
    }
    if (!serverState.authRequired) {
      serverStatus.textContent = 'Server aktif · tanpa password';
      serverStatus.className = 'server-warn';
      serverStatus.title = 'RAK_NO_AUTH=1 aktif. Jangan dibuka ke internet tanpa password.';
      return;
    }
    serverStatus.textContent = 'Server aktif';
    serverStatus.className = 'server-ok';
    serverStatus.title = '';
  }

  async function loadItems() {
    try {
      items = await api('/items');
      serverState.online = true;
    } catch (e) {
      items = [];
      serverState.online = false;
    }
    renderStatus();
  }

  // Mode auth: tampilkan peringatan kalau server terbuka tanpa password
  async function loadStatus() {
    try {
      const res = await fetch(`${API}/status`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const status = await res.json();
      serverState.authRequired = status.authRequired !== false;
      renderStatus();
    } catch { /* biarkan status default */ }
  }

  function escapeHtml(v = '') {
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function safeUrl(v) {
    try {
      const u = new URL(v);
      return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
    } catch { return ''; }
  }

  function proxyImage(url) {
    if (!url) return '';
    return `/api/image-proxy?url=${encodeURIComponent(url)}`;
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  // jumlah hari sejak tanggal rilis terakhir
  function daysSince(dateStr) {
    if (!dateStr) return 0;
    const diff = Date.now() - new Date(dateStr).getTime();
    if (!Number.isFinite(diff)) return 0;
    return Math.floor(diff / 86400000);
  }

  // latestChapter bisa objek {title,url,num} (data baru) atau string (data lama)
  function chapterInfo(item) {
    const ch = item.latestChapter;
    if (!ch) return null;
    if (typeof ch === 'string') {
      const num = (ch.match(/(\d{1,4}(?:[.,]\d{1,2})?)/) || [])[1];
      return { title: ch.replace(/^Terbaru:\s*/i, ''), url: item.latestChapterUrl || '', num: num ? parseFloat(num.replace(',', '.')) : -1 };
    }
    return ch;
  }

  function render() {
    const query = $('#searchInput').value.trim().toLowerCase();
    const matchesFilter = (i) => {
      if (activeFilter === 'hiatus') return i.hiatus === true;
      if (i.hiatus === true) return false;
      return activeFilter === 'all' || i.type === activeFilter;
    };
    const filtered = items.filter(
      (i) => matchesFilter(i) && `${i.title} ${i.note || ''}`.toLowerCase().includes(query)
    );

    const active = items.filter((i) => i.hiatus !== true);
    $('#allCount').textContent = active.length;
    $('#mangaCount').textContent = active.filter((i) => i.type === 'manga').length;
    $('#youtubeCount').textContent = active.filter((i) => i.type === 'youtube').length;
    $('#hiatusCount').textContent = items.filter((i) => i.hiatus === true).length;
    $('#headingCount').textContent = `(${filtered.length})`;

    grid.innerHTML = filtered.map((item) => {
      const unread = !item.read;
      const isYt = item.type === 'youtube';
      const badge = isYt ? '▶ YOUTUBE' : '▤ KOMIK';
      const cover = proxyImage(item.cover || '');
      const initial = escapeHtml((item.title || 'R').trim().charAt(0).toUpperCase());
      const latest = chapterInfo(item);
      const next = item.nextChapter || null;

      let statusHtml = '';
      if (isYt) {
        if (item.latestVideo) {
          const pos = item.latestVideo.index >= 0 ? ` (video ke-${item.latestVideo.index + 1})` : '';
          statusHtml = `<div class="card-latest"><span>Video terbaru${escapeHtml(pos)}:</span> <a href="${escapeHtml(item.latestVideo.url || '#')}" target="_blank" rel="noopener noreferrer" class="chapter-link">${escapeHtml(item.latestVideo.title || 'Video terbaru')}</a></div>`;
        }
      } else if (next) {
        statusHtml = `<div class="card-latest"><span>Belum dibaca:</span> <a href="${escapeHtml(next.url || '#')}" target="_blank" rel="noopener noreferrer" class="chapter-link">${escapeHtml(next.title || 'Chapter')}</a></div>`;
      } else if (latest) {
        const label = unread ? 'Belum dibaca' : 'Terbaru';
        statusHtml = `<div class="card-latest"><span>${label}:</span> <a href="${escapeHtml(latest.url || '#')}" target="_blank" rel="noopener noreferrer" class="chapter-link">${escapeHtml(latest.title || 'Chapter')}</a></div>`;
      }

      const readInfo = isYt
        ? (typeof item.lastVideoIndex === 'number' && item.lastVideoIndex >= 0
            ? `<div class="card-latest card-readinfo"><span>Terakhir diputar:</span> <b>video ke-${item.lastVideoIndex + 1}</b></div>`
            : '')
        : (item.readChapterNum >= 0 && !unread
            ? `<div class="card-latest card-readinfo"><span>Terakhir dibaca:</span> <b>${escapeHtml(item.readChapter || `Chapter ${item.readChapterNum}`)}</b></div>`
            : '');

      const readChip = isYt
        ? (unread ? '<span class="read-badge">Belum ditonton</span>' : '<span class="read-badge read-done">Sudah ditonton</span>')
        : (unread ? '<span class="read-badge">Belum dibaca</span>' : '<span class="read-badge read-done">Sudah dibaca</span>');

      const openLabel = isYt ? 'Putar playlist' : (next ? `Lanjut ${next.title || ''}`.trim() : 'Buka komik');
      const source = item.source || hostnameOf(item.url);
      const onHiatus = item.hiatus === true;
      const staleDays = daysSince(latest?.date);
      const staleHtml = (!onHiatus && staleDays >= 30)
        ? `<div class="card-stale">⏸ sudah <b>${staleDays} hari</b> tidak update</div>`
        : '';
      const hiatusBadge = '<span class="hiatus-badge">⏸ HAIATUS</span>';

      return `<article class="card" data-type="${item.type}">
        <div class="card-cover">
          <div class="cover-fallback">${initial}</div>
          ${cover ? `<img src="${escapeHtml(cover)}" alt="Sampul ${escapeHtml(item.title)}" loading="lazy" onerror="this.remove()" />` : ''}
          <div class="card-shade"></div>
          <span class="type-badge">${badge}</span>
          <div class="card-menu">
            <button class="mini-action" data-action="hiatus" data-id="${escapeHtml(item.id)}" title="${onHiatus ? 'Kembalikan ke rak utama' : 'Pindahkan ke Rak HaHiatus'}">⏸</button>
            <button class="mini-action" data-action="swap" data-id="${escapeHtml(item.id)}" title="Ganti sumber / mirror">⇄</button>
            <button class="mini-action" data-action="refresh" data-id="${escapeHtml(item.id)}" title="Perbarui dari sumber">↻</button>
            <button class="mini-action" data-action="edit" data-id="${escapeHtml(item.id)}" title="Edit">✎</button>
            <button class="mini-action" data-action="delete" data-id="${escapeHtml(item.id)}" title="Hapus">×</button>
          </div>
        </div>
        <div class="card-info">
          <div class="card-header-row">
            <h3 class="card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
            ${onHiatus ? hiatusBadge : readChip}
          </div>
          <div class="card-note" title="${escapeHtml(item.note || '')}">${escapeHtml(item.note || (isYt ? 'Playlist YouTube' : 'Komik / manga'))}</div>
          ${source ? `<div class="card-source">sumber: ${escapeHtml(source)}</div>` : ''}
          ${statusHtml}
          ${readInfo}
          ${staleHtml}
          <div class="card-actions">
            <button class="mini-action" data-action="mark" data-id="${escapeHtml(item.id)}" title="${unread ? 'Tandai sudah dibaca' : 'Tandai belum dibaca (naikkan)'}">${unread ? '✔' : '↩'}</button>
            <button class="mini-action" data-action="open-ext" data-id="${escapeHtml(item.id)}" title="Buka situs asli di tab baru">↗</button>
          </div>
          <button class="card-open" data-action="open" data-id="${escapeHtml(item.id)}"><span>▶</span> ${escapeHtml(openLabel)}</button>
        </div>
      </article>`;
    }).join('');

    const isEmpty = items.length === 0;
    $('#emptyState').hidden = !isEmpty || query.length > 0;
    $('#noResults').hidden = filtered.length > 0 || isEmpty;
    if (isEmpty) {
      $('#emptyTitle').textContent = 'Rakmu masih kosong';
      $('#emptyDescription').textContent = 'Tambahkan komik atau playlist YouTube supaya semuanya gampang ditemukan lagi.';
    }
    if (activeFilter === 'hiatus' && filtered.length === 0 && !isEmpty) {
      $('#emptyState').hidden = false;
      $('#emptyTitle').textContent = 'Rak HaHiatus masih kosong';
      $('#emptyDescription').textContent = 'Klik ikon ⏸ pada kartu komik untuk menyembunyikannya dari halaman utama. Komik yang lama tidak update juga bisa ditandai otomatis.';
    }
  }

  async function openForm(item = null) {
    editingId = item?.id || null;
    editingUrl = item?.url || '';
    $('#formTitle').textContent = editingId ? 'Edit koleksi' : 'Tambah ke rak';
    $('#saveButton').textContent = editingId ? 'Simpan perubahan' : 'Simpan ke rak';
    $('#titleInput').value = item?.title || '';
    $('#typeInput').value = item?.type || 'manga';
    $('#urlInput').value = item?.url || '';
    $('#coverInput').value = item?.cover || '';
    $('#readChapterNumInput').value = item?.readChapterNum >= 0 ? item.readChapterNum : '';
    $('#noteInput').value = item?.note || '';
    $('#hiatusInput').checked = item?.hiatus === true;
    $('#formError').textContent = '';
    updateFormHints();
    itemDialog.showModal();
    $('#titleInput').focus();
  }

  function updateFormHints() {
    const isYt = $('#typeInput').value === 'youtube';
    $('#urlLabel').textContent = isYt ? 'Link playlist / video YouTube' : 'Link komik';
    $('#urlInput').placeholder = isYt ? 'https://www.youtube.com/playlist?list=...' : 'https://...';
    $('#urlHint').textContent = isYt ? 'Playlist akan diputar di dalam app, mulai dari video terbaru.' : 'Alamat halaman komik yang biasa kamu baca.';
    $('#mangaOnlyRow').style.display = isYt ? 'none' : 'block';
  }

  async function openItem(item) {
    const isYt = item.type === 'youtube';
    const latest = chapterInfo(item);
    const next = item.nextChapter || null;

    $('#viewerTitle').textContent = item.title;
    $('#viewerType').textContent = isYt ? 'YOUTUBE' : 'KOMIK / MANGA';
    $('#externalLink').href = item.url;
    $('#embedNote').hidden = isYt;

    let embedUrl = item.url;
    if (isYt) {
      // Fallback: bangun URL embed sendiri. Jangan pernah jatuh ke halaman
      // watch/playlist mentah karena YouTube menolaknya di-frame
      // (X-Frame-Options) sehingga muncul error "Can't Open This Page".
      const listId = (item.url.match(/[?&]list=([^&]+)/) || [])[1];
      const fallbackEmbed = listId
        ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(listId)}`
        : 'https://www.youtube-nocookie.com/embed/videoseries';
      embedUrl = fallbackEmbed;
      try {
        const yt = await api(`/youtube?url=${encodeURIComponent(item.url)}`);
        if (yt.ok) {
          embedUrl = yt.embedUrlLatest || yt.embedUrl || fallbackEmbed;
          $('#externalLink').href = yt.latestVideo?.url || item.url;
          if (yt.latestVideo) {
            await api(`/items/${item.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                latestVideo: yt.latestVideo,
                lastVideoIndex: yt.latestVideo.index,
                updatedAt: new Date().toISOString()
              })
            }).catch(() => {});
            // sudah sampai video terbaru -> dianggap tertonton
            await api(`/items/${item.id}/read`, { method: 'POST', body: JSON.stringify({ read: true }) }).catch(() => {});
            await loadItems();
            render();
          }
        }
      } catch { /* pakai url asal */ }
    } else {
      // langsung buka chapter yang belum dibaca
      const target = next?.url || latest?.url || item.url;
      embedUrl = target;
      $('#externalLink').href = target;
      if (next?.num >= 0) {
        await api(`/items/${item.id}/read`, {
          method: 'POST',
          body: JSON.stringify({ readChapter: next.title, readChapterNum: next.num })
        }).catch(() => {});
        await loadItems();
        render();
      }
    }

    $('#viewerFrame').src = embedUrl;
    applyZoom(savedZoom);
    viewerDialog.showModal();
  }

  /* ------------------------------------------------------------- zoom */

  const ZOOM_KEY = 'rak-zoom-v1';
  const ZOOM_STEPS = [0.35, 0.5, 0.65, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3];
  let savedZoom = Number(localStorage.getItem(ZOOM_KEY)) || 1;

  function applyZoom(value) {
    const zoom = Math.min(3, Math.max(0.35, value));
    savedZoom = zoom;
    localStorage.setItem(ZOOM_KEY, String(zoom));
    const wrap = $('#frameWrap');
    const zoomEl = $('#viewerZoom');
    zoomEl.style.transform = `scale(${zoom})`;
    zoomEl.style.width = `${100 / zoom}%`;
    zoomEl.style.height = `${100 / zoom}%`;
    wrap.scrollTop = 0;
    wrap.scrollLeft = 0;
    $('#zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
  }

  function stepZoom(direction) {
    const current = savedZoom;
    const next = direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001);
    applyZoom(next ?? current);
  }

  function fitWidth() {
    // perkecil supaya seluruh lebar chapter muat di panel
    applyZoom(0.5);
    requestAnimationFrame(() => {
      const wrap = $('#frameWrap');
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    });
  }

  $('#zoomIn').addEventListener('click', () => stepZoom(1));
  $('#zoomOut').addEventListener('click', () => stepZoom(-1));
  $('#zoomLevel').addEventListener('click', () => applyZoom(1));
  $('#zoomFit').addEventListener('click', fitWidth);
  $('#fullscreenBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else viewerDialog.requestFullscreen?.().catch(() => {});
  });

  async function refreshItem(item) {
    try {
      if (item.type === 'manga') {
        const meta = await api(`/fetch-meta?url=${encodeURIComponent(item.url)}`);
        if (!meta.ok) throw new Error(meta.error || 'Gagal mengambil data');
        const chapters = meta.chapters || [];
        const readNum = typeof item.readChapterNum === 'number' ? item.readChapterNum : -1;
        // chapter pertama yang belum dibaca (nomor terkecil di atas yang terakhir dibaca)
        const unread = chapters
          .filter((c) => c.num > readNum)
          .sort((a, b) => a.num - b.num);
        // belum pernah ada yang dibaca -> tunjuk chapter terbaru
        const nextChapter = readNum < 0
          ? (meta.latestChapter || null)
          : (unread[0] || null);
        await api(`/items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: meta.title || item.title,
            cover: meta.image || item.cover,
            latestChapter: meta.latestChapter || null,
            nextChapter,
            latestChapterUrl: meta.latestChapter?.url || item.latestChapterUrl,
            updatedAt: new Date().toISOString()
          })
        });
        // sinkronkan status: ada chapter belum dibaca -> butuh perhatian, caught up -> selesai
        await api(`/items/${item.id}/read`, {
          method: 'POST',
          body: nextChapter
            ? { read: false, readChapter: item.readChapter || '', readChapterNum: readNum }
            : { read: true, readChapter: meta.latestChapter?.title || '', readChapterNum: meta.latestChapter?.num ?? readNum }
        }).catch(() => {});
      } else {
        const meta = await api(`/youtube?url=${encodeURIComponent(item.url)}`);
        if (!meta.ok) throw new Error(meta.error || 'Gagal mengambil data YouTube');
        const prevIndex = typeof item.lastVideoIndex === 'number' ? item.lastVideoIndex : -1;
        const latestIndex = meta.latestVideo?.index ?? -1;
        await api(`/items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: meta.title || item.title,
            latestVideo: meta.latestVideo || null,
            updatedAt: new Date().toISOString()
          })
        });
        // ada video baru sejak terakhir diputar -> kartu perlu perhatian
        await api(`/items/${item.id}/read`, {
          method: 'POST',
          body: JSON.stringify({ read: !(latestIndex > prevIndex) })
        }).catch(() => {});
      }
    } catch (e) {
      alert('Gagal memperbarui: ' + e.message);
      return;
    }
    await loadItems();
    render();
  }

  // ✔ = tandai chapter yang ditunjuk sudah dibaca (progress maju)
  // ↩ = tandai belum dibaca (kartu naik ke atas, progress tidak diubah)
  async function markRead(item, read) {
    const chapter = item.nextChapter || chapterInfo(item);
    const payload = read
      ? { read: true, readChapter: chapter?.title || '', readChapterNum: chapter?.num ?? item.readChapterNum ?? -1 }
      : { read: false };
    await api(`/items/${item.id}/read`, { method: 'POST', body: JSON.stringify(payload) });
    await loadItems();
    render();
  }

  async function toggleHiatus(item) {
    const toHiatus = item.hiatus !== true;
    await api(`/items/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ hiatus: toHiatus, id: item.id })
    });
    await loadItems();
    render();
  }

  async function swapSource(item) {
    const newUrl = prompt(
      `Ganti sumber untuk “${item.title}”.\nRiwayat baca (chapter terakhir dibaca) tetap dipertahankan.`,
      item.url
    );
    if (!newUrl) return;
    const url = safeUrl(newUrl.trim());
    if (!url) { alert('URL tidak valid'); return; }
    await api(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ url, id: item.id }) });
    await loadItems();
    const updated = items.find((i) => i.id === item.id);
    if (updated) await refreshItem(updated);
    render();
  }

  $('#typeInput').addEventListener('change', updateFormHints);
  $('#addItem').addEventListener('click', () => openForm());
  $('#mobileAdd').addEventListener('click', () => openForm());
  $('#emptyAdd').addEventListener('click', () => openForm());
  $('#searchInput').addEventListener('input', render);

  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.filter === activeFilter));
    document.querySelectorAll('.filter-chip').forEach((el) => el.classList.toggle('selected', el.dataset.filter === activeFilter));
    render();
  }));

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (close) document.getElementById(close.dataset.close).close();
  });

  // Rak Support
  document.querySelector('[data-action="support"]')?.addEventListener('click', () => {
    supportDialog.showModal();
  });

  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const item = items.find((i) => i.id === button.dataset.id);
    if (!item) return;

    if (button.dataset.action === 'open') openItem(item);
    if (button.dataset.action === 'open-ext') {
      const target = item.nextChapter?.url || chapterInfo(item)?.url || item.url;
      window.open(target, '_blank');
    }
    if (button.dataset.action === 'edit') openForm(item);
    if (button.dataset.action === 'delete') {
      if (confirm(`Hapus “${item.title}” dari rak?`)) {
        await api(`/items/${item.id}`, { method: 'DELETE' });
        await loadItems();
        render();
      }
    }
    if (button.dataset.action === 'refresh') refreshItem(item);
    if (button.dataset.action === 'swap') swapSource(item);
    if (button.dataset.action === 'hiatus') toggleHiatus(item);
    if (button.dataset.action === 'mark') markRead(item, !item.read);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('#titleInput').value.trim();
    const type = $('#typeInput').value;
    const url = safeUrl($('#urlInput').value.trim());
    const coverValue = $('#coverInput').value.trim();
    const cover = coverValue ? safeUrl(coverValue) : '';
    const readChapterNum = $('#readChapterNumInput').value.trim();
    const hiatus = $('#hiatusInput').checked;
    if (!url) {
      $('#formError').textContent = 'Masukkan URL yang valid (dimulai dengan http:// atau https://).';
      return;
    }
    if (coverValue && !cover) {
      $('#formError').textContent = 'Link gambar harus berupa URL http:// atau https://.';
      return;
    }
    try {
      const payload = { title, type, url, cover, hiatus, note: $('#noteInput').value.trim() };
      if (readChapterNum !== '') payload.readChapterNum = Number(readChapterNum);
      const sourceChanged = editingId && url !== editingUrl;
      if (editingId) {
        await api(`/items/${editingId}`, { method: 'PUT', body: JSON.stringify({ ...payload, id: editingId }) });
      } else {
        await api('/items', { method: 'POST', body: JSON.stringify(payload) });
      }
      itemDialog.close();
      await loadItems();
      render();
      // sumber diganti (mis. pindah mirror) -> langsung deteksi ulang dari situs baru
      if (sourceChanged) {
        const updated = items.find((i) => i.id === editingId);
        if (updated) await refreshItem(updated);
      }
    } catch (e) {
      $('#formError').textContent = 'Gagal menyimpan ke server.';
    }
  });

  [itemDialog, viewerDialog, supportDialog].forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }));
  viewerDialog.addEventListener('close', () => {
    $('#viewerFrame').src = 'about:blank';
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#searchInput').focus();
      return;
    }
    // pintasan panel baca (hanya saat viewer terbuka)
    if (!viewerDialog.open) return;
    if (event.target.matches('input, textarea, select')) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); stepZoom(1); }
    if (event.key === '-' || event.key === '_') { event.preventDefault(); stepZoom(-1); }
    if (event.key === '0') { event.preventDefault(); applyZoom(1); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); $('#fullscreenBtn').click(); }
    if (event.key.toLowerCase() === 'w') { event.preventDefault(); fitWidth(); }
  });

  loadStatus();
  loadItems().then(render);
})();
