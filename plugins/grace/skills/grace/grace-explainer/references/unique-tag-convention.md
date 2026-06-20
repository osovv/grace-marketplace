# Unique Tag Convention

In `.grace/*.xml` files, every **repeated entity** must use its **unique ID as the XML tag name** instead of a generic type tag with an `ID` attribute.

## The Problem: Closing-Tag Polysemy

```xml
<!-- BAD: Multiple </Module> closings — LLM loses track of what's being closed -->
<Module ID="M-CONFIG">
  ...
</Module>
<Module ID="M-DB">
  ...
</Module>
<Module ID="M-AUTH">
  ...
</Module>
```

When an LLM sees `</Module>`, it has to backtrack to figure out WHICH module is being closed. With many modules, this causes attention errors.

## The Solution: Semantic Accumulators

```xml
<!-- GOOD: Each closing tag carries the full identity of the entity -->
<M-CONFIG NAME="Config" TYPE="UTILITY">
  ...
</M-CONFIG>
<M-DB NAME="Database" TYPE="DATA_LAYER">
  ...
</M-DB>
<M-AUTH NAME="Authentication" TYPE="CORE_LOGIC">
  ...
</M-AUTH>
```

A tag with a unique name is a **semantic anchor**. `</M-CONFIG>` is unambiguous — the closing tag carries the full identity of the entity.

## Tag Naming Conventions

| Entity type | Anti-pattern | Correct (unique tags) |
|---|---|---|
| Module | `<Module ID="M-CONFIG">...</Module>` | `<M-CONFIG NAME="Config" TYPE="UTILITY">...</M-CONFIG>` |
| Phase | `<Phase number="1">...</Phase>` | `<Phase-1 name="Foundation">...</Phase-1>` |
| Flow | `<Flow ID="DF-SEARCH">...</Flow>` | `<DF-SEARCH NAME="...">...</DF-SEARCH>` |
| UseCase | `<UseCase ID="UC-001">...</UseCase>` | `<UC-001>...</UC-001>` |
| Step | `<step order="1">...</step>` | `<step-1>...</step-1>` |
| Group | `<group name="Database">...</group>` | `<group-Database>...</group-Database>` |
| Export | `<export name="config" .../>` | `<export-config .../>` |
| Function | `<function name="search" .../>` | `<fn-search .../>` |
| Type | `<type name="SearchResult" .../>` | `<type-SearchResult .../>` |
| Class | `<class name="Error" .../>` | `<class-Error .../>` |
| Schema | `<schema name="Input" .../>` | `<schema-Input .../>` |
| Table | `<table name="messages" .../>` | `<table-messages .../>` |
| Index | `<index name="fts" .../>` | `<index-fts .../>` |
| Column | `<column name="id" .../>` | `<col-id .../>` |
| Command | `<command name="/start" .../>` | `<cmd-start .../>` |
| Handler | `<handler name="doc" .../>` | `<handler-doc .../>` |
| Constant | `<constant name="X" .../>` | `<const-X .../>` |
| Route | `<route path="/api" .../>` | `<route-api .../>` |
| File | `<file name="Dockerfile" .../>` | `<file-Dockerfile .../>` |
| Rule | `<rule>text</rule>` | `<rule-errors>text</rule-errors>` |

## What NOT to Change

- **CrossLinks** — self-closing (`<CrossLink ... />`), no nesting, no polysemy problem
- **Structural wrappers** that appear once per parent: `<annotations>`, `<interface>`, `<contract>`, `<inputs>`, `<outputs>`, `<errors>`, `<notes>`, `<purpose>`, `<path>`, `<depends>`
- **Code-level markup** (`// START_BLOCK_...` / `// END_BLOCK_...`) — already uses unique names, stays as-is

## Why This Works

Research on LLM attention patterns shows that unique tokens serve as "accumulators" — they collect and carry meaning through the context window. A unique closing tag like `</M-CONFIG>` doesn't just mark the end of a block; it re-activates all the semantic associations built up since `<M-CONFIG>` was opened. Generic `</Module>` tags force the LLM to resolve ambiguity, wasting attention capacity.
