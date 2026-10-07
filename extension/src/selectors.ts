/** YouTube changes its markup often. Keep every page selector here. */
export const SELECTORS = {
  activeShort: ['ytd-reel-video-renderer[is-active]', 'ytd-reel-video-renderer[active]', 'ytd-reel-video-renderer'],
  title: ['yt-shorts-video-title-view-model h2', '#title h2', 'h2#title', '#title', '.ytShortsVideoTitleViewModelShortsVideoTitle'],
  channel: ['ytd-channel-name a', 'a[href^="/@"]', '#channel-name'],
  like: ['#like-button button', 'like-button-view-model button', 'yt-like-button-view-model button', '#like-button [aria-label]', '#like-button', 'like-button-view-model', 'yt-like-button-view-model'],
  descriptionOpen: ['button[aria-label="Description"]', '[role="button"][aria-label="Description"]', '#description-button'],
  moreOpen: ['button[aria-label="More actions"]', 'button[aria-label="More"]', '#menu yt-icon-button#button'],
  menuItems: ['yt-list-item-view-model button[role="menuitem"]', 'button[role="menuitem"]', 'yt-list-item-view-model', 'ytd-menu-service-item-renderer', 'tp-yt-paper-item'],
  menuAction: ['button[role="menuitem"]', 'button', '[role="menuitem"]'],
  descriptionPanel: ['ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-structured-description"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-description"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]', 'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-structured-description-content-renderer'],
  description: ['ytd-text-inline-expander#description-inline-expander', '#description-inline-expander', 'ytd-expandable-video-description-body-renderer', '#description'],
  viewCount: ['view-count-factoid-renderer', '#view-count', 'ytd-video-view-count-renderer', '.view-count'],
  views: ['yt-content-metadata-view-model', '.ytShortsVideoMetadataViewModelMetadataText', '.yt-shorts-video-metadata-view-model__metadata-text', 'ytd-video-primary-info-renderer #info-text'],
  stats: ['factoid-renderer', '.ytwFactoidRendererHost', '.ytwFactoidRendererFactoid', 'yt-factoid-renderer', 'yt-factoid-view-model', '.ytFactoidViewModelHost', 'ytd-video-description-header-renderer', 'yt-video-description-header-view-model'],
  accessibleLabels: ['[aria-label]'],
  next: ['button[aria-label="Next video"]', 'button[aria-label="Next"]', '#navigation-button-down button'],
  video: ['video'],
  challenges: ['iframe[src*="recaptcha"]', 'iframe[src*="captcha"]', 'ytd-consent-bump-v2-lightbox', 'tp-yt-paper-dialog[opened]', 'yt-player-error-message-renderer', 'ytd-enforcement-message-view-model'],
  descriptionClose: ['#header button[aria-label="Close"]', '#header yt-icon-button#close-button', 'button[aria-label="Close"]'],
  accountGrid: ['ytd-browse[page-subtype="channels"] ytd-rich-grid-renderer', 'ytd-rich-grid-renderer', 'ytd-section-list-renderer ytd-grid-renderer'],
  accountVideos: ['a[href*="/shorts/"]'],
};
/** Semantic Instagram selectors; unknown or changed markup fails closed. */
export const INSTAGRAM = {
  video: ['video'],
  reelRoot: ['article', '[role="dialog"]'],
  main: ['main', '[role="main"]'],
  channel: ['header a[href]', 'a[role="link"][href]', 'a[href]'],
  // The caption. Instagram also uses dir=auto for comment rows and empty rail
  // labels, so instagram.ts requires element children and takes the longest block.
  captionHeading: ['h1', '[data-testid="post-caption"]', '[data-testid="reel-caption"]'],
  caption: ['span[dir="auto"]'],
  permalink: ['a[href*="/reel/"]', 'a[href*="/reels/"]'],
  stats: ['a[href*="/liked_by/"]', 'a[href*="/likes/"]', '[aria-label*=" likes" i]', '[aria-label*=" views" i]', '[aria-label*=" plays" i]', '[data-testid="like-count"]', '[data-testid="view-count"]'],
  statText: ['span'],
  /** Instagram dropped the <ul> comment list; each comment is its own control. */
  commentRow: ['div[role="button"]', 'li'],
  /** A Reel's action rail is one <section> holding [icon control][count] per action. */
  rail: ['section'],
  railCount: ['span[role="button"]'],
  likeIcon: ['svg[aria-label="Like"]', 'svg[aria-label="Unlike"]'],
  viewIcon: ['svg[aria-label="View count"]', 'svg[aria-label="View Count"]', 'svg[aria-label="Views"]', 'svg[aria-label="Play count"]', 'svg[aria-label="Play"]'],
  controls: ['button', '[role="button"]'],
  likeControl: ['button[aria-label="Like"]', '[role="button"][aria-label="Like"]', 'button[aria-label="Unlike"]', '[role="button"][aria-label="Unlike"]'],
  next: ['button[aria-label="Next"]', '[role="button"][aria-label="Next"]', 'button[aria-label="Next reel"]', '[role="button"][aria-label="Next reel"]'],
  nextIcon: ['svg[aria-label="Next"]', 'svg[aria-label="Next reel"]'],
  accountGrid: ['main article', 'main [role="tabpanel"]', '[role="main"] article', '[role="main"] [role="tabpanel"]'],
  accountTabs: ['[role="tablist"]'],
  accountVideos: ['a[href*="/reel/"]', 'a[href*="/reels/"]'],
  excludedGrid: ['aside', 'nav', '[role="navigation"]', '[aria-label*="suggested" i]', '[aria-label*="recommended" i]'],
  challenges: ['iframe[src*="captcha"]', 'iframe[src*="challenge"]', '[role="dialog"]', 'form[action*="login"]', 'input[name="username"]', 'input[name="password"]'],
  loading: ['[role="progressbar"]', '[aria-busy="true"]'],
  /** Instagram ships the Reel's own Relay payload as JSON; it carries exact
   * like_count and, for a signed-in viewer, play_count. The DOM only ever shows a
   * rounded like count and no views at all. */
  payload: ['script[type="application/json"]'],
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
