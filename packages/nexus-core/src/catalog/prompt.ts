import type { CatalogDefinition } from './index';
import { CatalogRegistry } from './index';

/**
 * Render a deterministic LLM prompt contract from the same catalog boundary
 * used by runtime validation. The prompt is advisory; guards remain final.
 * 输入是 v2 声明（注册闸门保证完整性），prompt 不夸大实际支持范围。
 */
export function createCatalogPromptContract(catalog: CatalogDefinition): string {
  // Registration performs the catalog, action, component, and schema checks.
  new CatalogRegistry([catalog]);

  const components = Object.keys(catalog.components).join(', ');
  const actions =
    catalog.actions.length === 0
      ? 'None; this catalog is display-only.'
      : catalog.actions
          .map((action) => {
            const params = action.paramSchema
              ? `params=${JSON.stringify(action.paramSchema)}`
              : 'params=none';
            return `${action.name} (sources: ${action.sources.join('/')}; ${params})`;
          })
          .join(', ');

  const schemaSections = Object.entries(catalog.components)
    .map(([component, declaration]) => {
      return `Component ${component} props schema:\n${JSON.stringify(declaration.schema, null, 2)}`;
    })
    .join('\n\n');

  const capabilitySections = Object.entries(catalog.components)
    .map(([component, declaration]) => {
      const fields = Object.entries(declaration.fields ?? {})
        .map(
          ([field, fieldPolicy]) =>
            `- ${field}: origin=${fieldPolicy.origin ?? 'official-basic'}${
              fieldPolicy.componentRef ? ', componentRef=true' : ''
            }`,
        )
        .join('\n');
      const inputs = Object.entries(declaration.inputs ?? {})
        .map(([property, valueSchema]) => `- ${property}: ${JSON.stringify(valueSchema)}`)
        .join('\n');
      const action = declaration.action?.required
        ? 'Action: required; this component must carry action.event.'
        : 'Action: optional; mounting follows the catalog action declarations (sources).';
      const checks = declaration.checks?.enabled
        ? `Checks: enabled=true, functions=${declaration.checks.functions?.join('/') ?? 'none'}, maxRules=${
            declaration.checks.maxRules ?? 'unlimited'
          }`
        : 'Checks: not enabled.';
      const origin = declaration.origin ?? 'official-basic';
      return `Component ${component}:\nOrigin: ${origin}\n${
        fields || 'No extra field metadata.'
      }\n${action}\n${checks}${inputs ? `\nWritable inputs:\n${inputs}` : ''}`;
    })
    .join('\n\n');

  return `# Nexus UI Agent Output Contract

Protocol version: v0.9
Catalog ID: ${catalog.catalogId}

Return newline-delimited JSON objects only. Do not return Markdown, prose, a JSON array, HTML, React code, or frontend source code. Every non-empty line must independently parse as one JSON object.

Each object has exactly two fields: "version" and one A2UI payload field. For an initial generation, the first object uses "createSurface"; all later objects use "updateComponents" or "updateDataModel". For an action response, use only "updateComponents" and/or "updateDataModel". Keep the same surfaceId throughout the response.

Generation shape:
{"version":"v0.9","createSurface":{"surfaceId":"<surfaceId>","catalogId":"${catalog.catalogId}"}}
{"version":"v0.9","updateComponents":{"surfaceId":"<surfaceId>","components":[...]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"<surfaceId>","value":{...}}}

Component rules:
- Allowed components: ${components}.
- Every component is flat and has "id" and "component" fields.
- Use static component ids in "child" and "children"; do not nest component objects.
- Include a component with id "root" during initial generation.
- Keep component ids stable across updates so the host can patch the same surface in place.

Action rules:
- Allowed actions: ${actions}.
- Use action.event only in this MVP; do not use functionCall or sendDataModel.
- Attach an action only to a component type listed in that action's sources; do not invent actions.
- Resolve user state through {"path":"..."} bindings and include the latest values needed by the action context.

Catalog schema rules:
${schemaSections}

Catalog capability declarations:
${capabilitySections}

Schema interpretation:
- "type" requires the corresponding JSON type.
- "enum" permits only one of the listed values.
- "const" requires the exact value.
- "minLength" and "maxLength" constrain string length.
- "pattern" is a JavaScript regular expression from the supported bounded subset.
- "minimum" and "maximum" constrain numeric values.
- "minItems" constrains array length.
- "items" applies to every array item.
- "properties", "required", and "additionalProperties" follow the JSON-Schema-like subset.
- "dynamic" controls whether a value may be {"path":"..."}: "forbidden" means literal only, "allowed" means literal or path binding, and "required" means path binding only.
- If a bound path is not present yet during streaming, leave the binding in place; do not replace it with an invented literal.

The host guard is authoritative. If output violates the protocol, catalog, schema, lifecycle, or action boundary, it is rejected before rendering.`;
}
