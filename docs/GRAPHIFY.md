# Graph-based context reference (Graphify)

The MySQL app ships with a knowledge graph of its own code so an AI assistant
can answer questions by querying the graph instead of reading (and paying
tokens for) dozens of source files.

Generated output lives in `mysql-app/graphify-out/`:

| File | What it is |
| --- | --- |
| `graph.json` | the full graph — 700+ nodes, queryable offline |
| `GRAPH_REPORT.md` | highlights: key concepts, communities, suggested questions |
| `graph.html` | open in a browser: clickable force-directed map |

## One-time install

```bash
uv tool install graphifyy      # or: pipx install graphifyy
graphify install               # register the /graphify skill with your assistant
```

## Refreshing the map

Run from the `mysql-app/` folder:

```bash
npm run graph          # full rebuild (code only, no API key, nothing leaves the machine)
npm run graph:update   # re-extract only changed files
npm run graph:report   # re-cluster + regenerate GRAPH_REPORT.md
```

Or use the CLI directly:

```bash
graphify extract . --code-only --no-viz --force
graphify cluster-only . --no-label
```

`--code-only` keeps the whole pass local (tree-sitter AST, no LLM). Docs and
PDFs would need a model key; we intentionally skip them.

## Querying instead of grepping

```bash
graphify query "how does a kiosk scan reach the database?"
graphify path "withInstitute" "logAudit"
graphify explain "ensureSchemaExtras"
```

Optional: keep it current automatically with `graphify hook install`
(rebuilds on commit and branch switch), and run `graphify update .` after a
`git pull`.

## Notes

- `graphify-out/` is committed so the team starts with a map; only
  `graphify-out/cache/` and `cost.json` are ignored.
- Secrets are excluded via `.graphifyignore`; `.env*` never enters the graph.
- SQL grammar support needs `pip install "graphifyy[sql]"` so `db/*.sql`
  tables show up as nodes.
