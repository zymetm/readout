/* The help file as GitHub shows it (DASHBOARD-HELP.md at the repository
 * root): the text the plugin writes, with each live sample block swapped
 * for a picture of the same sample, light or dark to match the reader's
 * GitHub theme. The pictures are screenshots of the plugin's own samples
 * (WIDGET_SAMPLES), in docs/images/. Used by the mirror gate, and to write
 * the mirror: DASHBOARD-HELP.md === helpMirrorOf(guideTextFor(README)). */

const NAMES = {
  line: 'A line chart', bar: 'A bar chart', combo: 'A bars and lines (combo) chart', scatter: 'A scatter chart', stat: 'One big number',
  table: 'A table', segments: 'A part-to-whole bar', heatmap: 'A heatmap', text: 'A text widget', divider: 'A section divider',
};

export const imageOf = (word, theme) => 'docs/images/widget-' + word + '-' + theme + '.png';

export function helpMirrorOf(text) {
  return String(text).replace(/```sqlite-viewer-sample\n([a-z]+)\n```/g, (block, word) => {
    if (!NAMES[word]) return block;
    return '<picture>\n' +
      '  <source media="(prefers-color-scheme: dark)" srcset="' + imageOf(word, 'dark') + '">\n' +
      '  <img alt="' + NAMES[word] + ', drawn by the plugin with invented numbers" src="' + imageOf(word, 'light') + '" width="600">\n' +
      '</picture>';
  });
}
