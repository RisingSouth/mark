# Mark

A Chrome side panel that sits beside an AI chat and adds what the chat lacks: an assessment pack (task, rubric, calibration anchors, rulings) that travels across chats, and a local markbook built from the marks the chat produces.

You still chat freely. The extension reads finished replies, saves structured marks, and inserts text into the composer. **It never sends anything for you.**

## Status

MVP, v0.1. Built without access to a live browser, so the DOM selectors for the host chat are unverified. Expect to adjust `selectors.js` on first run.

## Install (developer mode)

1. Open `chrome://extensions` and switch on Developer mode.
2. Choose **Load unpacked** and select this folder.
3. Click the extension icon to open the side panel next to claude.ai.

## First use

1. Panel: **Create your first pack**. Name it, choose your task sheet and rubric (PDF or Word), and press **Send to chat**. The panel attaches the files and writes the request in the composer; you press send, then review and save what Claude extracted. (Or start with an empty pack.) For anchors, use **Import** in the Pack tab and choose a few marked scripts.
2. Home: open **Set up your Claude Project**, copy the instructions into your Claude Project's instructions. Do this once.
3. In a chat inside that Project: **Load pack**, press send. When Claude replies `READY ...` the panel shows *Chat configured*.
4. Drop in a script, press **Mark**, press send. The reply's `mark` block is validated and saved; a green chip appears under the reply.
5. **Markbook**: review, edit, accept, export CSV.
6. Chat getting long or drifting: **Hand over**, send, review what was captured, save, then load the pack in a fresh chat.

## What is stored, and where

Everything is in this browser's IndexedDB for the extension. No server, no analytics, no accounts. **Export backup** (Pack tab) writes a JSON file. Clearing site data for the extension deletes the markbook, so export now and then.

Files and text you put in the chat go to your AI provider under your own account, as normal. The extension cannot remove student names from files you attach. Use IDs in filenames and tell the model to refer to students by ID only (the pack's output rules already do).

## How capture stays trustworthy

A block is saved only if it passes deterministic checks: student is a short ID (not a name), every rubric criterion is present, each score is a whole number within its max, and `total` equals the sum. Anything else shows an amber chip with the reason and is not saved. Re-capturing identical model output never overwrites your edits.

## Layout

| Path | Role |
| --- | --- |
| `manifest.json` | MV3 manifest, side panel, claude.ai only |
| `selectors.js` | The only file that knows the host page's DOM. Fix breakage here |
| `content.js` | Reads completed replies, inserts text into the composer. No data, never sends |
| `background.js` | Service worker. Validates captures and writes to IndexedDB |
| `lib/parse.js` | Extracts and validates blocks. Pure functions, unit tested |
| `lib/prompts.js` | Every inserted prompt, built from templates |
| `lib/db.js`, `lib/csv.js` | Storage and CSV export (formula-safe) |
| `sidepanel/` | The UI |
| `docs/PROTOCOL.md` | The block formats |

## Develop

```
npm test        # parser, CSV, prompt tests (no dependencies)
npm run check   # syntax check
```

## Known gaps

- Selectors unverified; no remote selector update yet.
- Only claude.ai. Other chats need an adapter in `selectors.js` and the manifest matches.
- Capture waits for the reply to finish using a debounce plus an optional streaming selector.
- No roster import, no moderation view beyond flags, no folder mirroring, no licensing.
- No icons yet.
