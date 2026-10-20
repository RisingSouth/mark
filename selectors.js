/*
 * The ONLY place that knows about the host chat's DOM.
 * These selectors are best guesses and have not been verified against the live site.
 * If capture or insertion stops working, fix them here and nowhere else.
 */
const MF_SELECTORS = {
  // Completed assistant messages (we read their text, not their structure)
  assistantMessage: [
    '[data-testid="assistant-message"]',
    '.font-claude-response',
    '.font-claude-message'
  ].join(','),
  // The message composer (a contenteditable)
  composer: [
    'div[contenteditable="true"][role="textbox"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]'
  ].join(','),
  // The (usually hidden) file input behind the attach button
  fileInput: 'input[type="file"]',
  // Present while a reply is still streaming. Capture waits until it disappears.
  streaming: '[data-is-streaming="true"]'
};
