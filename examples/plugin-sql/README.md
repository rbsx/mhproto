# Example plugin: SQL tables

A small, complete MHProto plugin. It turns `CREATE TABLE` statements into `table`
entities, so rules can point at the data guarantees they depend on (uniqueness,
nullability, ownership). It is a teaching example, not a SQL parser: it handles
plain DDL, one statement per table.

It uses every extension point:

| Part          | Where                                                     |
| ------------- | --------------------------------------------------------- |
| Entity kind   | `kinds.table`                                             |
| Adapter       | `interfaces.sql.load` reads a file or a migrations folder |
| Validation    | `interfaces.sql.validate` requires a primary key          |
| Agent context | `interfaces.sql.packet` puts columns first                |
| Agent skill   | `skills/mhproto-sql`                                      |
| Viewer        | `viewer.js` renders the columns table                     |

## Use it

```yaml
# mhproto.yaml
plugins:
  - ./tools/plugin-sql/index.mjs # or `sql` once published as mhproto-plugin-sql
capabilities:
  - id: orders
    spec: mhproto/capabilities/orders/spec.md
    interfaces:
      - { adapter: openapi, file: mhproto/interfaces/openapi.yaml }
      - { adapter: sql, file: db/migrations }
```

```sql
-- mhproto: ORDER-CANCEL-3
create table orders (
  id text primary key,
  status text not null,
  customer_id text not null references customers(id)
);
```

```sh
npx mhproto plugins
npx mhproto check
npx mhproto context --capability orders --entity table:orders
npx mhproto skills --agent claude --only sql
```

See [doc/plugins.md](../../doc/plugins.md) for the plugin API.
