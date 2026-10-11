# Engine-level scenes

Each `*.json` file here is an engine `ModelSpec` wrapped in a small envelope:

```json
{
  "id": "t02_table",
  "description": "what the scene is and how its geometry was chosen",
  "spec": { "gravity": …, "bodies": …, "statics": …, "pulleys": …, "strings": …, "options": … },
  "variants": { "t02b_table_kinetic": { "pairOverrides": […] } }
}
```

- `id` matches the scene's key in `../expected.json` when the scene has expected values.
- `variants` (optional) are shallow overrides of top-level `spec` fields, applied as
  `{ ...spec, ...variant }`. A variant named after an `expected.json` key is that scene.
- Geometry is textbook-exact: coordinates are dyadic rationals wherever possible, so horizontal and
  vertical string segments come out exactly axis-aligned and blocks sit exactly on their faces
  (gap = 0). The tests assert this.
