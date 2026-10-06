// Example MHProto plugin: reads CREATE TABLE statements as `table` entities.
// Deliberately small. It shows every extension point; a real adapter would use a SQL parser.
import { definePlugin } from 'mhproto/plugin';

// `-- mhproto: RULE-1, RULE-2` on the lines before a table links it to rules.
const statement =
  /((?:^[ \t]*--[^\n]*\n)*)^[ \t]*create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(\w+)["`]?\s*\(([\s\S]*?)\)\s*;/gim;

function splitColumns(body) {
  const parts = [];
  let depth = 0,
    current = '';
  for (const char of body) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  return [...parts, current.trim()].filter(Boolean);
}

export function parseTables(sql, file) {
  return [...sql.matchAll(statement)].map(([, comments, name, body]) => {
    const rules = [...comments.matchAll(/--\s*mhproto:\s*([^\n]+)/gi)].flatMap((m) =>
      m[1].split(',').map((id) => id.trim()),
    );
    const columns = [],
      constraints = [];
    for (const part of splitColumns(body)) {
      if (/^(primary\s+key|unique|foreign\s+key|check|constraint)\b/i.test(part)) {
        constraints.push(part.replace(/\s+/g, ' '));
        continue;
      }
      const [, column, type = '', rest = ''] =
        /^["`]?(\w+)["`]?\s+([\w()]+(?:\s*\[\])?)?(.*)$/s.exec(part) ?? [];
      if (!column) continue;
      const references = /references\s+["`]?(\w+)["`]?/i.exec(rest)?.[1];
      columns.push({
        name: column,
        type: type.toLowerCase(),
        nullable: !/not\s+null|primary\s+key/i.test(rest),
        ...(/primary\s+key/i.test(rest) ? { primaryKey: true } : {}),
        ...(/\bunique\b/i.test(rest) ? { unique: true } : {}),
        ...(references ? { references } : {}),
      });
    }
    for (const constraint of constraints) {
      const target = /references\s+["`]?(\w+)["`]?/i.exec(constraint)?.[1];
      if (target) columns.push({ constraint, references: target });
    }
    return {
      kind: 'table',
      id: name,
      title: name,
      summary: `${columns.filter((c) => c.name).length} columns from ${file}`,
      rules,
      links: [...new Set(columns.map((c) => c.references).filter(Boolean))]
        .filter((other) => other !== name)
        .map((other) => ({ kind: 'table', id: other, relation: 'references' })),
      data: { columns: columns.filter((c) => c.name), constraints },
    };
  });
}

export default definePlugin((api, options = {}) => {
  api.assertVersion(1);
  return {
    name: 'sql',
    kinds: {
      table: { label: 'Table', plural: 'Tables', linkRequired: options.requireRules !== false },
    },
    interfaces: {
      sql: {
        // `file` may be one .sql file or a directory of migrations, read in name order.
        async load({ file, readText, list }) {
          let files = [file];
          try {
            files = (await list(file))
              .filter((name) => name.endsWith('.sql'))
              .map((name) => `${file}/${name}`);
          } catch (error) {
            if (error.code !== 'ENOTDIR') throw error;
          }
          const tables = new Map();
          for (const path of files)
            for (const table of parseTables(await readText(path), path))
              tables.set(table.id, table);
          return { entities: [...tables.values()], meta: { files: files.length } };
        },
        validate({ entities }, { error }) {
          for (const table of entities)
            if (
              !table.data.columns.some((c) => c.primaryKey) &&
              !table.data.constraints.some((c) => /primary key/i.test(c))
            )
              error(`Table ${table.id} has no primary key`);
        },
        packet(entity, context) {
          const { definition, ...sections } = context.defaults(entity);
          return {
            table: {
              id: entity.id,
              columns: definition.columns,
              constraints: definition.constraints,
            },
            ...context.select(sections),
          };
        },
      },
    },
    skills: [{ name: 'mhproto-sql', path: new URL('./skills/mhproto-sql', import.meta.url) }],
    viewer: new URL('./viewer.js', import.meta.url),
  };
});
