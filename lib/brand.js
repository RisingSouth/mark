/* The one place the product name lives. Change these to rebrand; nothing else needs touching. */
const MFBrand = {
  name: 'Mark',               // shown in the panel, chips and extension name
  tag: 'MARK',                // preamble header the model sees: "MARK PACK pk_..."
  block: 'mark',              // fenced block label for one mark
  handoverBlock: 'mark-handover',
  slug: 'mark',               // file names
  db: 'mark'                  // IndexedDB name
};
if (typeof module !== 'undefined') module.exports = MFBrand;
