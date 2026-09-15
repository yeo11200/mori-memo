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
