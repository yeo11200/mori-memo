/** 외부 업무의 링크만 허용하며 Markdown 구문을 끼워 넣을 수 없게 합니다. */
export const handleWorkLink = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || /[\s<>()[\]\\]/.test(value)) return false;
    if (url.hostname === 'github.com') return /^\/[^/]+\/[^/]+\/issues\/\d+$/.test(url.pathname);
    if (url.hostname === 'gitlab.com') return /^\/[^/]+(?:\/[^/]+)+\/-\/issues\/\d+$/.test(url.pathname);
    return /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(url.hostname) && /^\/browse\/[A-Z][A-Z0-9_]*-\d+$/.test(url.pathname);
  } catch { return false; }
};
