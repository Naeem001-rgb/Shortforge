/** YouTube changes its markup often. Keep every page selector here. */
export const SELECTORS = {
  activeShort: ['ytd-reel-video-renderer[is-active]', 'ytd-reel-video-renderer[active]', 'ytd-reel-video-renderer'],
  title: ['yt-shorts-video-title-view-model h2', '#title h2', 'h2#title', '#title', '.ytShortsVideoTitleViewModelShortsVideoTitle'],
  channel: ['ytd-channel-name a', 'a[href^="/@"]', '#channel-name'],
  like: ['#like-button button', 'like-button-view-model button', 'yt-like-button-view-model button', '#like-button [aria-label]', '#like-button', 'like-button-view-model', 'yt-like-button-view-model'],
  descriptionOpen: ['button[aria-label="Description"]', '[role="button"][aria-label="Description"]', '#description-button'],
  moreOpen: ['button[aria-label="More actions"]', '#menu button[aria-label="More"]', '#menu yt-icon-button#button'],
  menuItems: ['ytd-menu-service-item-renderer', 'tp-yt-paper-item'],
  descriptionPanel: ['ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-description"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]', 'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-structured-description-content-renderer'],
  description: ['ytd-text-inline-expander#description-inline-expander', '#description-inline-expander', 'ytd-expandable-video-description-body-renderer', '#description'],
  viewCount: ['#view-count', 'ytd-video-view-count-renderer', '.view-count'],
  views: ['yt-content-metadata-view-model', '.ytShortsVideoMetadataViewModelMetadataText', '.yt-shorts-video-metadata-view-model__metadata-text', 'ytd-video-primary-info-renderer #info-text'],
  stats: ['yt-factoid-renderer', 'yt-factoid-view-model', '.ytFactoidViewModelHost', 'ytd-video-description-header-renderer', 'yt-video-description-header-view-model'],
  accessibleLabels: ['[aria-label]'],
  next: ['button[aria-label="Next video"]', 'button[aria-label="Next"]', '#navigation-button-down button'],
  video: ['video'],
  challenges: ['iframe[src*="recaptcha"]', 'iframe[src*="captcha"]', 'ytd-consent-bump-v2-lightbox', 'tp-yt-paper-dialog[opened]', 'yt-player-error-message-renderer', 'ytd-enforcement-message-view-model'],
  descriptionClose: ['#header button[aria-label="Close"]', '#header yt-icon-button#close-button', 'button[aria-label="Close"]'],
};
export function first(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const node of root.querySelectorAll<HTMLElement>(selector)) if (visible(node)) return node;
  }
  return null;
}
export function all(root: ParentNode, selectors: readonly string[]): HTMLElement[] {
  return [...new Set(selectors.flatMap(selector => [...root.querySelectorAll<HTMLElement>(selector)]))];
}
export function visible(node: HTMLElement): boolean {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}
export function activeShort(): HTMLElement | null {
  const active = first(document, SELECTORS.activeShort.slice(0, 2));
  if (active) return active;
  return all(document, SELECTORS.activeShort.slice(2)).filter(visible).sort((a, b) => {
    const middle = innerHeight / 2;
    const distance = (n: HTMLElement) => Math.abs(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2 - middle);
    return distance(a) - distance(b);
  })[0] || null;
}
