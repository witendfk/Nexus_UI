import type { CatalogDefinition } from './index';
import { CatalogRegistry } from './index';

/**
 * Render a deterministic LLM prompt contract from the same catalog boundary
 * used by runtime validation. The prompt is advisory; guards remain final.
 */
export function createCatalogPromptContract(catalog: CatalogDefinition): string {
  // Registration performs the catalog, action, component, and schema checks.
  new CatalogRegistry([catalog]);

  const components = catalog.components.join(', ');
  const actions =
    catalog.actions === undefined
      ? 'Not declared by this CatalogDefinition; do not invent actions from this contract.'
      : catalog.actions.length === 0
        ? 'None; this catalog is display-only.'
        : catalog.actions.join(', ');

  const schemas = Object.entries(catalog.componentSchemas ?? {});
  const schemaSections = schemas
    .map(([component, schema]) => {
      return `Component ${component} props schema:\n${JSON.stringify(schema, null, 2)}`;
    })
    .join('\n\n');
  const componentsWithoutSchema = catalog.components.filter(
    (component) => !catalog.componentSchemas?.[component],
  );
  const policies = Object.entries(catalog.componentPolicies ?? {});
  const policySections = policies
    .map(([component, policy]) => {
      const fields = Object.entries(policy.fields ?? {})
        .map(
          ([field, fieldPolicy]) =>
            `- ${field}: binding=${fieldPolicy.binding ?? 'forbidden'}, origin=${
              fieldPolicy.origin ?? 'official-basic'
            }${fieldPolicy.componentRef ? ', componentRef=true' : ''}`,
        )
        .join('\n');
      const action = policy.action
        ? `Action: allowed=${policy.action.allowed ?? true}, required=${
            policy.action.required ?? false
          }`
        : 'Action: allowed by protocol; no extra Catalog policy.';
      const checks = policy.checks
        ? `Checks: enabled=${policy.checks.enabled ?? false}, functions=${
            policy.checks.functions?.join('/') ?? 'none'
          }, maxRules=${policy.checks.maxRules ?? 'unlimited'}`
        : 'Checks: not enabled by Catalog policy.';
      return `Component ${component} policy:\nOrigin: ${
        policy.origin ?? 'official-basic'
      }\n${fields || 'No extra field policies.'}\n${action}\n${checks}`;
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
- Allowed action names: ${actions}.
- Use action.event only in this MVP; do not use functionCall or sendDataModel.
- An action name must be explicitly allowed by the catalog and attached only to a component type supported by the protocol.
- Resolve user state through {"path":"..."} bindings and include the latest values needed by the action context.

Catalog schema rules:
${schemaSections || 'No component-specific schemas are declared by this CatalogDefinition.'}
${
  componentsWithoutSchema.length > 0
    ? `Components without a catalog schema here: ${componentsWithoutSchema.join(
        ', ',
      )}. Their names remain whitelisted, but their component-specific fields must still follow the A2UI contract supplied by the host or runtime.`
    : 'Every catalog component has a schema above.'
}

Catalog capability policies:
${policySections || 'No component capability policies are declared by this CatalogDefinition.'}

Schema interpretation:
- "type" requires the corresponding JSON type.
- "enum" permits only one of the listed values.
- "const" requires the exact value.
- "minLength" and "maxLength" constrain string length.
- "pattern" is a JavaScript regular expression.
- "minimum" and "maximum" constrain numeric values.
- "items" applies to every array item.
- "properties", "required", and "additionalProperties" follow the JSON-Schema-like subset.
- "dynamic" controls whether a value may be {"path":"..."}: "forbidden" means literal only, "allowed" means literal or path binding, and "required" means path binding only.
- If a bound path is not present yet during streaming, leave the binding in place; do not replace it with an invented literal.

The host guard is authoritative. If output violates the protocol, catalog, schema, lifecycle, or action boundary, it is rejected before rendering.`;
}
