# Unique Tag Convention

In `.grace` XML, registered semantic anchors use their unique ID as the tag name and carry no attributes. Ordinary fields retain the exact field names expected by their consumer, even when repeated.

## Semantic anchors

The registered families are `GD-*`, `VD-*`, `C-*`, `M-*`, `V-M-*`, `DF-*`, and task anchors `T-NNN`. Use a canonical anchor tag for a definition or reference. Put metadata in child fields:

```xml
<M-CONFIG>
  <Name>Config</Name>
  <Type>UTILITY</Type>
</M-CONFIG>
```

`<Module ID="M-CONFIG">` does not define a module anchor. `<M-CONFIG NAME="Config">` is also invalid because semantic anchors cannot have attributes. Root metadata such as `graceVersion` and change `status` is a separate, supported grammar rule.

The unique closing tag makes the anchor identity visible at both ends of the definition. This is a readability and navigation convention, not a guarantee about model attention or correctness.

## Repeatable ordinary fields

Do not turn ordinary fields into invented anchor families. Verification projection reads fields such as `Scenario`, `Command`, `Marker`, and `TraceAssertion` by their recognized names:

```xml
<V-M-CONFIG>
  <Command>bun test tests/config.test.ts</Command>
  <Scenario>
    <Name>valid-port</Name>
    <Given>PORT is 8080.</Given>
    <When>Configuration is loaded.</When>
    <Then>The public configuration contains port 8080.</Then>
  </Scenario>
  <Scenario>
    <Name>invalid-port</Name>
    <Given>PORT is not an integer.</Given>
    <When>Configuration is loaded.</When>
    <Then>Loading fails with a configuration error.</Then>
  </Scenario>
</V-M-CONFIG>
```

`Name` is a local human-readable label, not a new semantic anchor. Nested scenario text is projected as prose; it is not a machine-evaluated predicate. Renaming `Scenario` to `Scenario-valid-port` can leave XML readable while removing that scenario from CLI projection. Likewise, retain ordinary `Criterion` and `File` fields where their consumers expect them.

File-local `START_*` / `END_*` markers follow the separate [semantic markup](semantic-markup.md) rules. They do not extend the `.grace` XML anchor registry.

## Literal XML inside explanations

When an XML artifact contains a quoted XML example as data, escape it or wrap the literal in CDATA. Raw nested tags can be visited as live anchors, assertions, or commands by consumers. Use actual child elements only when they are intended to be part of the artifact's structure.
