// Browser renderer for `table` pages. Loaded by `mhproto view` and inlined by `mhproto build`.
(globalThis.mhprotoViewerPlugins ??= []).push({
  name: 'sql',
  kinds: {
    table: {
      section: (table, ui) =>
        ui.html`<section><h2>Columns</h2><table class="table"><thead><tr><th>Column</th><th>Type</th><th>Constraints</th></tr></thead><tbody>${table.data.columns.map(
          (c) =>
            ui.html`<tr><td><code>${c.name}</code></td><td>${c.type}</td><td>${[
              c.primaryKey && 'primary key',
              c.unique && 'unique',
              !c.nullable && !c.primaryKey && 'not null',
              c.references && 'references ' + c.references,
            ]
              .filter(Boolean)
              .join(' · ')}</td></tr>`,
        )}</tbody></table>${table.data.constraints.length ? ui.html`<p class="section-note">${table.data.constraints.join('; ')}</p>` : ''}</section>`,
    },
  },
});
