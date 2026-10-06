// OpenAPI pages for the MHProto viewer: the API section of a feature, endpoint pages,
// type pages and request/response signatures. A plain script, loaded like any plugin's
// viewer script, that uses the page-level hooks described in doc/plugins.md.
(() => {
  let ui, project, baseline, baselineProject, comparisonEnabled;
  let entityIndex, indexedProject, baselineEntities, indexedBaseline;
  const escape = (value) => ui.text.escape(value);
  const prose = (value) => ui.text.prose(value);
  const clean = (value) => ui.text.clean(value);
  const raw = (value) => ui.text.pre(value);
  const disclosure = (...args) => ui.text.disclosure(...args);
  const featureUrl = (cap) => ui.text.featureUrl(cap);
  const target = (...args) => ui.text.target(...args);
  const attachmentBlock = (...args) => ui.text.attachment(...args);
  const visualGallery = (t) => ui.text.gallery(t);
  const checksSection = (...args) => ui.text.checks(...args);
  const scenario = (cap, example) => ui.text.example(cap, example);
  const diagram = (title, source) => ui.text.diagram(title, source);
  const canonical = (...args) => ui.model.canonical(...args);
  const operationRuleIds = (cap, op) => ui.model.operationRuleIds(cap, op);
  const api = (cap) => ui.model.openapiView(cap) ?? { operations: [] };

  const endpointUrl = (cap, op, rule) =>
    featureUrl(cap) +
    '/api/' +
    encodeURIComponent(op.operationId) +
    (rule ? '?rule=' + encodeURIComponent(rule) : '');
  const typeUrl = (cap, entity) => featureUrl(cap) + '/types/' + encodeURIComponent(entity.id);
  // Entities from interface plugins other than OpenAPI, which keeps its own pages.
  const typeLink = (cap, entity) => {
    const status = entityChange(cap, entity);
    return `<a class="type-link${status ? ' change-link ' + status : ''}" href="${escape(typeUrl(cap, entity))}"${status ? ` title="${escape(pascal(status))} type"` : ''}>${escape(entity.name)}</a>`;
  };
  const method = (op) =>
    `<span class="method ${escape(op.method.toLowerCase())}">${escape(op.method)}</span>`;
  function entityChange(cap, entity) {
    if (!comparisonEnabled || !baselineEntities) return null;
    const old = baselineEntities.caps.get(cap.id)?.get(entity.id);
    return !old
      ? 'added'
      : JSON.stringify(canonical(old.schema)) !== JSON.stringify(canonical(entity.schema))
        ? 'changed'
        : null;
  }
  const schemaName = (schema) =>
    schema?.$ref
      ?.match(/^#\/components\/schemas\/([^/]+)$/)?.[1]
      ?.replaceAll('~1', '/')
      .replaceAll('~0', '~');
  const pointer = (value) => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
  const rootKey = (cap, op, part, status = '') =>
    JSON.stringify([cap.id, op.operationId, part, status]);
  function schemaChildren(s) {
    const children = Object.entries(s?.properties ?? {}).map(([name, schema]) => ({
      schema,
      path: '/properties/' + pointer(name),
      name: pascal(name),
      field: name,
    }));
    if (s?.items && typeof s.items === 'object')
      children.push({ schema: s.items, path: '/items', name: 'Item', field: '[]' });
    if (s?.additionalProperties && typeof s.additionalProperties === 'object')
      children.push({
        schema: s.additionalProperties,
        path: '/additionalProperties',
        name: 'Value',
        field: '[key]',
      });
    for (const kind of ['anyOf', 'oneOf', 'allOf', 'prefixItems'])
      for (const [i, schema] of (s?.[kind] ?? []).entries())
        children.push({ schema, path: `/${kind}/${i}`, name: 'Variant' + (i + 1), field: '' });
    return children;
  }
  // This index is derived from the current model in memory. No schema copies enter agent packets.
  function buildEntityIndex(model) {
    const index = {
      caps: new Map(),
      nodes: new Map(),
      roots: new Map(),
      usage: new Map(),
      entities: [],
    };
    const register = (cap, id, name, schema, source, derived = false) => {
      const types = index.caps.get(cap.id),
        nodes = index.nodes.get(cap.id);
      if (types.has(id)) return types.get(id);
      if (derived) {
        const taken = new Set([...types.values()].map((e) => e.name));
        let n = 1,
          base = name;
        while (taken.has(name)) name = base + 'Inline' + (n++ === 1 ? '' : n - 1);
      }
      const identity = (cap.files?.interface ?? cap.interface ?? cap.id) + '#' + id;
      if (!index.usage.has(identity)) index.usage.set(identity, new Map());
      const entity = {
        id,
        name,
        schema,
        source,
        derived,
        identity,
        capability: cap.id,
        references: new Map(),
        usages: index.usage.get(identity),
      };
      types.set(id, entity);
      if (schema && typeof schema === 'object') nodes.set(schema, entity);
      index.entities.push(entity);
      return entity;
    };
    const entityAt = (cap, schema) => {
      const name = schemaName(schema);
      return name ? index.caps.get(cap.id).get(name) : index.nodes.get(cap.id).get(schema);
    };
    const discover = (cap, node, owner, path = '', suffix = '') => {
      if (!node || typeof node !== 'object' || node.$ref) return;
      let current = owner;
      if (path && (node.properties || node.type === 'object' || node.type?.includes?.('object')))
        current = register(
          cap,
          '@' + owner.id + path,
          owner.name + suffix,
          node,
          { kind: 'inline', parent: owner.name, path },
          true,
        );
      for (const child of schemaChildren(node))
        discover(
          cap,
          child.schema,
          current,
          current === owner ? path + child.path : child.path,
          current === owner ? suffix + child.name : child.name,
        );
    };
    for (const cap of model.capabilities) {
      index.caps.set(cap.id, new Map());
      index.nodes.set(cap.id, new WeakMap());
      for (const [name, schema] of Object.entries(api(cap).openapi?.components?.schemas ?? {}))
        register(cap, name, name, schema, { kind: 'schema', file: cap.files?.interface });
    }
    for (const cap of model.capabilities) {
      for (const entity of [...index.caps.get(cap.id).values()])
        discover(cap, entity.schema, entity);
      for (const op of orderedOperations(cap)) {
        const addRoot = (part, schema, label, source, status = '') => {
          if (schema === undefined) return;
          const entity =
            entityAt(cap, schema) ??
            register(
              cap,
              '@operation/' + op.operationId + '/' + part + (status ? '/' + status : ''),
              pascal(op.operationId) + label,
              schema,
              { ...source, operationId: op.operationId },
              true,
            );
          index.roots.set(rootKey(cap, op, part, status), { entity, cap, op, part, status });
          discover(cap, entity.schema, entity);
        };
        for (const location of ['path', 'query', 'header', 'cookie']) {
          const params = (op.parameters ?? []).filter((p) => p.in === location);
          if (params.length)
            addRoot(location, parameterSchema(params), pascal(location), {
              kind: 'parameters',
              location,
            });
        }
        addRoot('body', op.requestBody?.content?.['application/json']?.schema, 'Body', {
          kind: 'body',
        });
        for (const [status, r] of Object.entries(op.responses ?? {}))
          addRoot(
            'response',
            r.content?.['application/json']?.schema,
            'Response' + pascal(status),
            { kind: 'response', status },
            status,
          );
      }
    }
    for (const entity of index.entities) {
      const cap = model.capabilities.find((c) => c.id === entity.capability);
      const visit = (schema, path = '') => {
        const other = entityAt(cap, schema);
        if (other && other !== entity) {
          const ref = entity.references.get(other.identity) ?? { entity: other, fields: new Set() };
          ref.fields.add(path || 'definition');
          entity.references.set(other.identity, ref);
          return;
        }
        if (schema?.$ref) {
          const name = schemaName(schema);
          const ref = index.caps.get(cap.id).get(name);
          if (ref && ref !== entity) {
            entity.references.set(ref.identity, {
              entity: ref,
              fields: new Set([path || 'definition']),
            });
          }
          return;
        }
        for (const child of schemaChildren(schema))
          visit(
            child.schema,
            path +
              (child.field === '[]' || child.field === '[key]'
                ? child.field
                : child.field
                  ? (path ? '.' : '') + child.field
                  : ''),
          );
      };
      visit(entity.schema);
    }
    for (const root of index.roots.values()) {
      const role =
          root.part === 'response'
            ? 'Response ' + root.status
            : root.part === 'body'
              ? 'JSON body'
              : pascal(root.part),
        seen = new Set();
      const visit = (entity) => {
        if (seen.has(entity.identity)) return;
        seen.add(entity.identity);
        const key = JSON.stringify([root.cap.id, root.op.operationId]);
        const use = entity.usages.get(key) ?? {
          capability: root.cap.id,
          operationId: root.op.operationId,
          roles: new Set(),
        };
        use.roles.add(role);
        entity.usages.set(key, use);
        for (const ref of entity.references.values()) visit(ref.entity);
      };
      visit(root.entity);
    }
    return index;
  }
  function entityFor(cap, schema) {
    const name = schemaName(schema);
    return name
      ? entityIndex.caps.get(cap.id)?.get(name)
      : entityIndex.nodes.get(cap.id)?.get(schema);
  }
  function rootEntity(cap, op, part, status = '') {
    return entityIndex.roots.get(rootKey(cap, op, part, status))?.entity;
  }
  function referencedSchemas(cap, schemas) {
    const names = new Set();
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const ref = node.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
      if (ref) {
        const name = ref.replaceAll('~1', '/').replaceAll('~0', '~');
        if (!names.has(name)) {
          names.add(name);
          visit(api(cap).openapi?.components?.schemas?.[name]);
        }
      }
      for (const [key, value] of Object.entries(node)) if (key !== '$ref') visit(value);
    };
    visit(schemas);
    return names;
  }
  function orderedOperations(cap) {
    const order = cap.presentation?.operationOrder ?? [];
    return [...api(cap).operations].sort(
      (a, b) =>
        (order.includes(a.operationId) ? order.indexOf(a.operationId) : 999) -
        (order.includes(b.operationId) ? order.indexOf(b.operationId) : 999),
    );
  }
  const operationPresentation = (cap, op) => cap.presentation?.operations?.[op.operationId] ?? {};
  function rulesFor(cap, op) {
    const ids = operationRuleIds(cap, op);
    return cap.rules.filter((r) => ids.includes(r.id));
  }
  function resolveSchema(cap, schema, seen = new Set()) {
    if (!schema?.$ref) return schema ?? {};
    if (seen.has(schema.$ref)) return { type: 'object', description: 'Recursive object' };
    let node = api(cap).openapi;
    for (const part of schema.$ref.slice(2).split('/'))
      node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    const next = new Set(seen).add(schema.$ref);
    return {
      ...resolveSchema(cap, node, next),
      ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$ref')),
    };
  }
  function typeLabel(cap, input, depth = 0, seen = new Set()) {
    if (input === false) return 'never';
    if (input === true) return 'unknown';
    if (input?.$ref && seen.has(input.$ref)) return '{...}';
    const next = new Set(seen);
    if (input?.$ref) next.add(input.$ref);
    const s = resolveSchema(cap, input);
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
    if (s.anyOf || s.oneOf)
      return (s.anyOf ?? s.oneOf).map((x) => typeLabel(cap, x, depth, next)).join(' | ');
    if (s.allOf) return s.allOf.map((x) => typeLabel(cap, x, depth, next)).join(' & ');
    if (s.type === 'array') return `Array<${typeLabel(cap, s.items, depth + 1, next)}>`;
    if (s.properties)
      return '{...}' + (Array.isArray(s.type) && s.type.includes('null') ? ' | null' : '');
    const types = Array.isArray(s.type) ? s.type : [s.type ?? 'unknown'];
    return types.map((t) => (t === 'integer' ? 'number' : t)).join(' | ');
  }
  function typeMarkup(cap, input, seen = new Set(), includeEntity = true) {
    const entity = includeEntity ? entityFor(cap, input) : null,
      s = resolveSchema(cap, input),
      next = new Set(seen);
    if (input?.$ref) next.add(input.$ref);
    if (entity) {
      const link = typeLink(cap, entity);
      if (input?.$ref && seen.has(input.$ref))
        return link + ' <span class="field-constraint">recursive</span>';
      if (s.properties || s.type === 'object')
        return (
          link +
          ' <span class="object-pill">{...}</span>' +
          (Array.isArray(s.type) && s.type.includes('null') ? ' | null' : '')
        );
      if (s.type === 'array') return link + ` Array&lt;${typeMarkup(cap, s.items, next)}&gt;`;
      const objects = nestedObjects(cap, input, seen);
      return (
        link +
        (objects.length ? ' <span class="object-pill">{...}</span>' : '') +
        ((s.anyOf ?? s.oneOf ?? []).some((x) => x.type === 'null') ? ' | null' : '')
      );
    }
    if (s.anyOf || s.oneOf)
      return (s.anyOf ?? s.oneOf).map((x) => typeMarkup(cap, x, next)).join(' | ');
    if (s.allOf) return s.allOf.map((x) => typeMarkup(cap, x, next)).join(' & ');
    if (s.type === 'array') return `Array&lt;${typeMarkup(cap, s.items, next)}&gt;`;
    if (s.properties || s.type === 'object')
      return (
        '<span class="object-pill">{...}</span>' +
        (Array.isArray(s.type) && s.type.includes('null') ? ' | null' : '')
      );
    return escape(typeLabel(cap, s));
  }
  function constraint(input) {
    const parts = [];
    if (input.format) parts.push(input.format);
    if (input.type === 'integer') parts.push('integer');
    if (input.minimum !== undefined && input.maximum !== undefined)
      parts.push(`${input.minimum}–${input.maximum}`);
    else {
      if (input.minimum !== undefined) parts.push(`≥ ${input.minimum}`);
      if (input.maximum !== undefined) parts.push(`≤ ${input.maximum}`);
    }
    if (input.maxLength !== undefined) parts.push(`max ${input.maxLength} chars`);
    if (input.pattern)
      parts.push(
        input.pattern === '^\\d{4}-\\d{2}-\\d{2}$' ? 'YYYY-MM-DD' : 'pattern: ' + input.pattern,
      );
    return parts.length ? `<span class="field-constraint">${escape(parts.join(' · '))}</span>` : '';
  }
  function nestedObjects(cap, input, seen) {
    if (input?.$ref && seen.has(input.$ref)) return [];
    const next = new Set(seen);
    if (input?.$ref) next.add(input.$ref);
    const s = resolveSchema(cap, input);
    if (s.properties) return [{ schema: input, suffix: '' }];
    if (s.type === 'array')
      return nestedObjects(cap, s.items, next).map((item) => ({
        ...item,
        suffix: item.suffix + '[]',
      }));
    return (s.anyOf ?? s.oneOf ?? s.allOf ?? []).flatMap((item) => nestedObjects(cap, item, next));
  }
  function objectSignature(cap, input, depth = 0, seen = new Set(), root = null) {
    if (input?.$ref && seen.has(input.$ref))
      return `<span class="field-type">${typeMarkup(cap, input, seen)}</span>`;
    const next = new Set(seen);
    if (input?.$ref) next.add(input.$ref);
    const s = resolveSchema(cap, input);
    const entity = root ?? entityFor(cap, input),
      name = depth === 0 && entity ? typeLink(cap, entity) + ' ' : '';
    if (!s.properties)
      return `<div class="signature">${name}${typeMarkup(cap, s, next, false)}</div>`;
    const oldCap = baselineProject?.capabilities.find((c) => c.id === cap.id),
      oldEntity = entity && baselineEntities?.caps.get(cap.id)?.get(entity.id);
    const old = oldCap && oldEntity ? resolveSchema(oldCap, oldEntity.schema) : null;
    const fields = Object.entries(s.properties)
      .map(([name, p]) => {
        const resolved = resolveSchema(cap, p),
          optional = (s.required ?? []).includes(name) ? '' : '?';
        const label = `<span class="field-name">${escape(name + optional)}:</span> <span class="field-type">${typeMarkup(cap, p, next)}</span>${constraint(resolved)}`;
        const status =
          comparisonEnabled && old
            ? old.properties?.[name] === undefined
              ? 'added'
              : JSON.stringify(
                    canonical({
                      schema: old.properties[name],
                      required: (old.required ?? []).includes(name),
                    }),
                  ) !==
                  JSON.stringify(
                    canonical({ schema: p, required: (s.required ?? []).includes(name) }),
                  )
                ? 'changed'
                : null
            : comparisonEnabled && baseline && entity && !oldEntity
              ? 'added'
              : null;
        const attrs = status ? ` data-change="${status}" title="${pascal(status)} field"` : '';
        const marker = status ? `<span class="field-change">${pascal(status)}</span>` : '';
        const objects = nestedObjects(cap, p, next);
        if (objects.length && depth < 7 && !(p.$ref && next.has(p.$ref)))
          return `<details class="inline-object"${attrs}><summary>${label}${marker}</summary><div>${objects.map((obj) => objectSignature(cap, obj.schema, depth + 1, next)).join('')}${resolved.description ? `<p class="field-note">${escape(resolved.description)}</p>` : ''}</div></details>`;
        return `<div class="field"${attrs}>${label};${marker}</div>`;
      })
      .join('');
    const removed =
      comparisonEnabled && old
        ? Object.entries(old.properties ?? {})
            .filter(([name]) => !Object.hasOwn(s.properties, name))
            .map(
              ([name, p]) =>
                `<div class="field" data-change="removed"><span class="field-name">${escape(name + ((old.required ?? []).includes(name) ? '' : '?'))}:</span> <span class="field-type">${escape(typeLabel(oldCap, p))}</span>;<span class="field-change">Removed</span></div>`,
            )
            .join('')
        : '';
    return `<div class="signature">${name}{<div class="signature-body">${fields}${removed}</div>}${Array.isArray(s.type) && s.type.includes('null') ? ' | null' : ''}</div>`;
  }
  function parameterSchema(parameters) {
    return {
      type: 'object',
      properties: Object.fromEntries(parameters.map((p) => [p.name, p.schema ?? {}])),
      required: parameters.filter((p) => p.required).map((p) => p.name),
    };
  }
  function requestSignature(cap, op) {
    const parts = [];
    for (const location of ['path', 'query', 'header', 'cookie']) {
      const params = (op.parameters ?? []).filter((p) => p.in === location);
      if (params.length) {
        const entity = rootEntity(cap, op, location);
        parts.push(
          `<p class="request-part">${escape(location.charAt(0).toUpperCase() + location.slice(1))}</p>${objectSignature(cap, entity.schema, 0, new Set(), entity)}`,
        );
      }
    }
    const body = op.requestBody?.content?.['application/json']?.schema;
    if (body !== undefined)
      parts.push(
        `<p class="request-part">JSON body${op.requestBody.required ? '' : ' · optional'}</p>${objectSignature(cap, body, 0, new Set(), rootEntity(cap, op, 'body'))}`,
      );
    return parts.join('') || '<div class="signature">No parameters or body.</div>';
  }
  function successResponse(op) {
    return (
      Object.entries(op.responses ?? {}).find(([status]) => /^2\d\d$/.test(status)) ??
      Object.entries(op.responses ?? {})[0] ?? ['—', {}]
    );
  }
  function io(cap, op) {
    const [status, res] = successResponse(op);
    return `<div class="io-grid"><section>${attachmentBlock(target(cap, 'request', op.operationId), 'Request', { tag: 'h3', className: 'io-heading', label: 'Request' })}${requestSignature(cap, op)}</section><section>${attachmentBlock(target(cap, 'response', op.operationId, { status }), `Response <strong>${escape(status)}</strong>`, { tag: 'h3', className: 'io-heading', label: 'Response ' + status })}${res.content?.['application/json']?.schema !== undefined ? objectSignature(cap, res.content['application/json'].schema, 0, new Set(), rootEntity(cap, op, 'response', status)) : '<div class="signature">No response body.</div>'}</section></div>`;
  }
  function operationDiagrams(cap, op) {
    return (operationPresentation(cap, op).diagrams ?? [])
      .map((d) => diagram(d.title, d.source))
      .join('');
  }
  function errorSection(cap, op) {
    const errors = Object.entries(op.responses ?? {}).filter(([status]) => !/^2/.test(status));
    if (!errors.length) return '';
    const schema = errors
      .map(([, r]) => r.content?.['application/json']?.schema)
      .find((schema) => schema !== undefined);
    return `<section><h2>Errors</h2>${schema !== undefined ? objectSignature(cap, schema) : ''}<table class="table"><thead><tr><th>Status</th><th>Code</th><th>When</th></tr></thead><tbody>${errors.flatMap(([status, r]) => (r['x-error-codes'] ?? [{ code: '—', when: clean(r.description) }]).map((e) => `<tr><td>${escape(status)}</td><td><code>${escape(e.code)}</code></td><td>${escape(e.when)}${e.clause ? ` · <a href="${escape(endpointUrl(cap, op, e.clause))}">Rule</a>` : ''}</td></tr>`)).join('')}</tbody></table></section>`;
  }
  function endpointPage(cap, op) {
    const info = operationPresentation(cap, op),
      rules = rulesFor(cap, op);
    const examples = cap.examples.filter((e) => (e.operations ?? []).includes(op.operationId));
    const checks = cap.checks.filter(
      (c) =>
        (c.rules ?? []).some((id) => rules.some((r) => r.id === id)) ||
        (c.examples ?? []).some((id) => examples.some((e) => e.id === id)),
    );
    const groups = info.ruleGroups ?? [],
      grouped = new Set(groups.flatMap((g) => g.rules));
    const ruleList = (items) =>
      `<ul class="rule-list">${items.map((r) => `<li id="${escape(r.id)}">${attachmentBlock(target(cap, 'rule', r.id), prose(r.text), { tag: 'div', className: 'rule-text', label: r.id })}<a class="rule-id" href="${escape(endpointUrl(cap, op, r.id))}">${escape(r.id)}</a></li>`).join('')}</ul>`;
    return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><header><h1 class="endpoint-title">${method(op)} ${escape(op.path)}</h1>${attachmentBlock(target(cap, 'operation', op.operationId), escape(info.description ?? op.summary ?? op.operationId), { className: 'description', label: op.path })}</header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${io(cap, op)}<section><h2>Behaviour</h2>${info.behaviour ? `<p class="description">${escape(info.behaviour)}</p>` : ''}${ruleList(rules.filter((r) => !grouped.has(r.id)))}${groups.map((group) => disclosure(group.title, ruleList(rules.filter((r) => group.rules.includes(r.id))))).join('')}</section>${operationDiagrams(cap, op)}${errorSection(cap, op)}${examples.length ? `<section><h2>Examples</h2>${examples.map((e) => scenario(cap, e)).join('')}</section>` : ''}${checksSection(cap, checks, rules)}${disclosure(
      'Payload examples',
      raw({
        request: op.requestBody?.content?.['application/json']?.example,
        responses: Object.fromEntries(
          Object.entries(op.responses ?? {})
            .filter(([, r]) => r.content?.['application/json']?.example)
            .map(([status, r]) => [status, r.content['application/json'].example]),
        ),
      }),
    )}`;
  }
  function entityPage(cap, entity) {
    const source = entity.source,
      op = api(cap).operations.find((o) => o.operationId === source.operationId);
    const context = entity.derived
      ? source.kind === 'parameters'
        ? `${pascal(source.location)} parameters for ${op.method} ${op.path}.`
        : source.kind === 'body'
          ? `JSON request body for ${op.method} ${op.path}.`
          : source.kind === 'response'
            ? `Response ${source.status} for ${op.method} ${op.path}.`
            : `Object inside ${source.parent}.`
      : entity.schema?.description;
    const groups = project.capabilities
      .flatMap((feature) => {
        const uses = [...entity.usages.values()].filter((u) => u.capability === feature.id);
        if (!uses.length) return [];
        return `<section class="type-usage-group"><h3><a href="${escape(featureUrl(feature))}">${escape(feature.title ?? feature.id)} overview</a></h3><ul class="type-usage-list">${orderedOperations(
          feature,
        )
          .filter((o) => uses.some((u) => u.operationId === o.operationId))
          .map((o) => {
            const use = uses.find((u) => u.operationId === o.operationId);
            return `<li>${method(o)}<a href="${escape(endpointUrl(feature, o))}">${escape(o.path)}</a><span class="section-note">${escape([...use.roles].join(' · '))}</span></li>`;
          })
          .join('')}</ul></section>`;
      })
      .join('');
    const parents = entityIndex.entities.filter(
      (e) => e.identity !== entity.identity && e.references.has(entity.identity),
    );
    return `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><header><h1>${escape(entity.name)}</h1>${context ? `<p class="description">${escape(context)}</p>` : ''}</header><div class="page-actions"><button class="text-button" data-copy-url>Copy page link</button></div>${objectSignature(cap, entity.schema, 0, new Set(), entity)}${entity.derived ? '' : visualGallery(target(cap, 'schema', entity.id))}<section><h2>Used in</h2>${groups || '<p class="section-note">No API endpoint currently uses this type.</p>'}</section>${
      parents.length
        ? `<section><h2>Referenced by types</h2><ul class="type-parent-list">${parents
            .map((parent) => {
              const feature = project.capabilities.find((c) => c.id === parent.capability),
                fields = [...parent.references.get(entity.identity).fields];
              return `<li>${typeLink(feature, parent)}<span class="section-note">${escape(fields.join(', '))}${feature.id !== cap.id ? ' · ' + escape(feature.title ?? feature.id) : ''}</span></li>`;
            })
            .join('')}</ul></section>`
        : ''
    }<p class="type-source section-note">${entity.derived ? 'Name derived for this view from its existing structure.' : 'Defined in ' + escape(cap.files.interface) + ' · ' + escape(entity.id)}</p>`;
  }
  const pascal = (value) =>
    (String(value).match(/[A-Za-z0-9]+/g) ?? ['Type'])
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join('');

  const operationFor = (cap, id) => api(cap).operations.find((o) => o.operationId === id);
  const label = (op) => op.method + ' ' + op.path;
  const ruleOperation = (cap, id) =>
    orderedOperations(cap).find((o) => operationRuleIds(cap, o).includes(id));
  (globalThis.mhprotoViewerPlugins ??= []).push({
    name: 'openapi',
    ownsKinds: ['operation', 'schema'],
    setup(next) {
      ui = next;
      ({ project, baseline, baselineProject } = ui.state);
      comparisonEnabled = ui.state.comparing;
      if (indexedProject !== project) {
        entityIndex = buildEntityIndex(project);
        indexedProject = project;
      }
      if (indexedBaseline !== baselineProject) {
        baselineEntities = baselineProject ? buildEntityIndex(baselineProject) : null;
        indexedBaseline = baselineProject;
      }
    },
    // Fails on baselines whose types cannot be indexed, before they are used.
    index: (model) => buildEntityIndex(model),
    overview(cap) {
      const operations = orderedOperations(cap);
      if (!operations.length && !ui.model.openapiView(cap)) return '';
      return ui.raw(
        `<section id="api"><h2>API</h2>${operations
          .map((op) => {
            const info = operationPresentation(cap, op);
            return `<article class="endpoint" data-operation="${escape(op.operationId)}"><h3 class="endpoint-heading">${method(op)}<a href="${escape(endpointUrl(cap, op))}">${escape(op.path)}</a></h3>${attachmentBlock(target(cap, 'operation', op.operationId), escape(op.summary ?? op.operationId), { className: 'endpoint-summary', label: op.path })}${io(cap, op)}<p class="behaviour-preview"><b>Behaviour.</b> ${escape(info.behaviour ?? clean(rulesFor(cap, op)[0]?.text ?? 'No behaviour rules linked yet.'))}</p></article>`;
          })
          .join('')}</section>`,
      );
    },
    pages: {
      api(cap, id) {
        const op = operationFor(cap, id);
        return {
          html: ui.raw(
            op
              ? endpointPage(cap, op)
              : `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title)}</a><h1>Endpoint not found</h1>`,
          ),
          title: op?.path,
          change: ['operation', id],
        };
      },
      types(cap, id) {
        const entity = entityIndex.caps.get(cap.id).get(id);
        return {
          html: ui.raw(
            entity
              ? entityPage(cap, entity)
              : `<a class="back" href="${escape(featureUrl(cap))}">← ${escape(cap.title ?? cap.id)}</a><h1>Type not found</h1>`,
          ),
          title: entity?.name ?? 'Type not found',
          change: ['schema', id],
        };
      },
    },
    ruleTarget(cap, id) {
      const op = ruleOperation(cap, id);
      return op && { url: endpointUrl(cap, op, id), note: label(op) };
    },
    exampleTarget(cap, example) {
      const ids = example.operations;
      const op = ids && orderedOperations(cap).find((o) => ids.includes(o.operationId));
      return op && { url: endpointUrl(cap, op), note: label(op) };
    },
    targetUrl(cap, t) {
      if (['operation', 'request', 'response', 'field'].includes(t.kind)) {
        const op = operationFor(cap, t.id);
        return op ? endpointUrl(cap, op) : null;
      }
      if (t.kind === 'schema') {
        const entity = entityIndex.caps.get(cap.id)?.get(t.id);
        return entity ? typeUrl(cap, entity) : null;
      }
      return undefined;
    },
    changeTitle: (c) => (c.kind === 'operation' ? label(c.after ?? c.before) : undefined),
    search(cap, matches) {
      return {
        lead: orderedOperations(cap)
          .filter((op) => matches([op, operationPresentation(cap, op)]))
          .map((op) => ({ url: endpointUrl(cap, op), title: label(op), note: op.summary })),
        trail: [...entityIndex.caps.get(cap.id).values()]
          .filter((entity) => matches([entity.name, entity.schema?.description]))
          .map((entity) => ({
            url: typeUrl(cap, entity),
            title: entity.name,
            note: 'Type · ' + (cap.title ?? cap.id),
          })),
      };
    },
    decorate(cap, { changeFor, badge }) {
      for (const article of document.querySelectorAll('.endpoint[data-operation]'))
        article
          .querySelector('.endpoint-heading')
          ?.insertAdjacentHTML(
            'beforeend',
            badge(changeFor(cap, 'operation', article.dataset.operation)),
          );
    },
    // Request and response headers also show visuals of their fields and referenced types.
    targetVisuals(t) {
      if (!['request', 'response'].includes(t.kind)) return [];
      const cap = project.capabilities.find((c) => c.id === t.capability),
        op = operationFor(cap, t.id);
      const schemas =
        t.kind === 'request'
          ? [op?.requestBody, ...(op?.parameters ?? [])]
          : op?.responses?.[t.status];
      const names = referencedSchemas(cap, schemas);
      return (project.visuals ?? []).filter(
        (v) =>
          v.target.capability === t.capability &&
          ((v.target.kind === 'field' &&
            v.target.id === t.id &&
            v.target.scope === t.kind &&
            (!v.target.status || String(v.target.status) === String(t.status))) ||
            (v.target.kind === 'schema' && names.has(v.target.id))),
      );
    },
  });
})();
