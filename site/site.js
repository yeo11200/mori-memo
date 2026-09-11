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
    downloadLink.textContent = 'MORI 무료 다운로드 ↗';
    downloadStatus.textContent = '새 탭에서 다운로드 페이지가 열립니다. DMG를 열고 MORI를 응용 프로그램 폴더로 옮겨 주세요.';
  } catch {
    // 주소가 없거나 잘못된 경우 공개 준비 상태를 유지합니다.
  }
})();
