(() => {
  const downloadLink = document.getElementById('download-link');
  const downloadStatus = document.getElementById('download-status');
  const handleDownloadClick = (event) => {
    if (downloadLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
  };
  downloadLink.addEventListener('click', handleDownloadClick);
  try {
    const downloadUrl = new URL(window.MORI_SITE_CONFIG?.downloadUrl || '');
    if (downloadUrl.protocol !== 'https:' || downloadUrl.username || downloadUrl.password) return;
    downloadLink.href = downloadUrl.href;
    downloadLink.removeAttribute('aria-disabled');
    downloadLink.target = '_blank';
    downloadLink.rel = 'noreferrer';
    const isFolder = window.MORI_SITE_CONFIG?.downloadMode === 'folder';
    const version = typeof window.MORI_SITE_CONFIG?.currentVersion === 'string' ? window.MORI_SITE_CONFIG.currentVersion : '';
    downloadLink.textContent = isFolder ? '버전별 다운로드 열기 ↗' : 'MORI 무료 다운로드 ↗';
    downloadStatus.textContent = isFolder
      ? `Google Drive에서 원하는 버전의 MORI-${version || '최신'}-arm64.dmg를 선택하세요. DMG를 열고 MORI를 응용 프로그램 폴더로 옮겨 주세요.`
      : '새 탭에서 다운로드 페이지가 열립니다. DMG를 열고 MORI를 응용 프로그램 폴더로 옮겨 주세요.';
  } catch {
    // 주소가 없거나 잘못된 경우 공개 준비 상태를 유지합니다.
  }
})();

(() => {
  const list = document.getElementById('release-list');
  const releases = Array.isArray(window.MORI_SITE_CONFIG?.releases) ? window.MORI_SITE_CONFIG.releases : [];
  if (!list || !releases.length) return;
  const handleSafeURL = value => {
    try {
      const url = new URL(typeof value === 'string' ? value : '');
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  list.replaceChildren(...releases.map(release => {
    const card = document.createElement('article');
    card.className = 'release-card' + (release.version === window.MORI_SITE_CONFIG.currentVersion ? ' release-card--current' : '');
    const header = document.createElement('div');
    header.className = 'release-card__header';
    const version = document.createElement('span');
    version.className = 'release-card__version';
    version.textContent = 'MORI ' + (release.version || '');
    header.append(version);
    if (release.version === window.MORI_SITE_CONFIG.currentVersion) {
      const current = document.createElement('span');
      current.className = 'release-card__badge';
      current.textContent = '현재 버전';
      header.append(current);
    }
    const date = document.createElement('time');
    date.dateTime = release.date || '';
    date.textContent = release.date || '';
    header.append(date);
    card.append(header);
    const title = document.createElement('h3');
    title.textContent = release.title || '업데이트';
    card.append(title);
    const summary = document.createElement('p');
    summary.textContent = release.summary || '';
    card.append(summary);
    const highlights = document.createElement('ul');
    highlights.className = 'release-card__highlights';
    for (const item of Array.isArray(release.highlights) ? release.highlights : []) {
      const row = document.createElement('li');
      row.textContent = item;
      highlights.append(row);
    }
    card.append(highlights);
    const url = handleSafeURL(release.url) || handleSafeURL(window.MORI_SITE_CONFIG.downloadUrl);
    const link = document.createElement('a');
    const isFolderRelease = window.MORI_SITE_CONFIG.downloadMode === 'folder';
    link.className = url && release.url ? 'button button--small' : 'release-card__pending';
    link.href = url || '#download';
    if (url) { link.target = '_blank'; link.rel = 'noreferrer'; }
    link.textContent = isFolderRelease ? 'Drive에서 ' + (release.version || '이 버전') + ' 파일 선택 ↗' : '이 버전 다운로드 ↗';
    card.append(link);
    return card;
  }));
})();
