import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { JSONLBuffer } from '@nexus-ui/core';
import {
  BASIC_CATALOG_ACTIONS,
  BASIC_CATALOG_COMPONENTS,
  NEXUS_BASIC_TASK_CATALOG,
  WORKBENCH_CATALOG,
  WORKBENCH_CATALOG_ACTIONS,
  WORKBENCH_CATALOG_COMPONENTS,
} from './catalog';

export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmAgentRequest {
  kind: 'generate' | 'action';
  surfaceId: string;
  message: string;
  catalogId?: string;
  supportedComponents?: readonly string[];
  supportedActions?: readonly string[];
  history?: readonly AgentTurn[];
}

function createSystemPrompt(
  catalogId: string,
  components: readonly string[],
  supportedActions: readonly string[],
): string {
  const tabsRule = components.includes('Tabs')
    ? '\nUse Tabs only with "tabs": [{ "title": "...", "child": "component-id" }]; do not use Tabs.children.'
    : '';
  const imageRule = components.includes('Image')
    ? `\nUse Image only with required "url" and optional "description", "fit", and "variant"; do not use HTML-style "src" or "alt".
When the request mentions an avatar, image, photo, picture, or image URL, that media must be an Image component; never put its URL in Text.
When the request explicitly asks for an avatar, set Image.variant to "avatar" and Image.fit to "cover"; avatars must render compact and circular, not as a large full-width image.
Never render or label the URL itself in Text, including through an updateDataModel field bound to Text.text; URL values may bind only to Image.url.
If the request supplies an image URL, copy it exactly into Image.url. If an avatar is requested without a URL, use https://ui-avatars.com/api/?name=<name>&size=256; do not invent another domain.`
    : '';
  const mediaRule =
    components.includes('Video') || components.includes('AudioPlayer')
      ? `
Use Video only with "id", "component", and required "url"; it has no other protocol fields.
Use AudioPlayer only with "id", "component", required "url", and optional "description".
Video.url, AudioPlayer.url, and AudioPlayer.description may be strings or { "path": "..." } bindings.
Render media controls in the host renderer; do not add HTML-style src, controls, children, or an action to Video or AudioPlayer.
If the request supplies a video or audio URL, copy it exactly into the matching media component URL.`
      : '';
  const textFieldRule = components.includes('TextField')
    ? `\nUse TextField only with "id", "component", "label", "value", optional "variant", optional "validationRegexp", and optional "checks" (Nexus Basic Task Profile only).
"label" may be a string or { "path": "..." }; "value" must be exactly { "path": "..." } so user edits write back to the data model.
"variant" may only be "shortText", "longText", "number", or "obscured". Use "validationRegexp" only when the user explicitly supplies a regular expression, and copy it exactly.
Do not use placeholder, accessibility, weight, or an action on TextField.
When the request asks for a search workflow, generate one TextField with value path /keyword, one Button with action name "search" and context keyword bound to /keyword, and one Text component with id "searchResult"; include searchResult in the rendered component tree.
The search action handler will patch the searchResult component after the user submits.`
    : '';
  const isWorkbench = components.includes('CustomerSummary');
  const checksRule = isWorkbench
    ? '\nWorkbench does not support checks.'
    : `
Use checks only in the Nexus Basic Task Profile and only on TextField, Slider, and Button.
Each check must be exactly { "condition": { "call", "args", "returnType": "boolean" }, "message": "..." }; never put "call" at the CheckRule root.
"call" may only be required, regex, length, numeric, or email; do not use and, or, not, or custom functions.
required and email use args { "value": { "path": "..." } }; regex also includes a string "pattern"; length and numeric use args with "value" and at least one finite numeric "min" or "max" (length bounds must be non-negative integers).
When a check should block an action, repeat the same blocking condition on that action Button.checks as well as the input component.checks.`;
  const choicePickerRule = components.includes('ChoicePicker')
    ? `
Use ChoicePicker only with "id", "component", optional "label", optional "variant", "options", "value", optional "displayStyle", and optional "filterable".
"label" and option labels may be strings or { "path": "..." }; each option value must be a unique non-empty string.
"variant" may only be "multipleSelection" or "mutuallyExclusive"; "value" must be exactly { "path": "..." } bound to a string array in the data model.
"displayStyle" may only be "checkbox" or "chips"; do not use checks or an action on ChoicePicker.`
    : '';
  const dateTimeInputRule = components.includes('DateTimeInput')
    ? `
Use DateTimeInput only with "id", "component", optional "label", "value", "enableDate", "enableTime", optional "min", and optional "max".
"value" must be exactly { "path": "..." }; "enableDate" and "enableTime" must be booleans, and at least one must be true.
"min" and "max" may be an ISO 8601 date, time, or date-time string, or a { "path": "..." } binding. Do not use checks or an action on DateTimeInput.`
    : '';
  const sliderRule = components.includes('Slider')
    ? `
Use Slider only with "id", "component", optional "label", optional "min", required "max", required "value", and optional "checks".
"min" defaults to 0; "min" and "max" must be finite numbers, and min must be less than max.
"value" must be exactly { "path": "..." } so user adjustments write a number back to the data model.
Do not use minValue, maxValue, or an action on Slider.`
    : '';
  const checkBoxRule =
    components.includes('CheckBox') && !isWorkbench
      ? `
Use CheckBox only with "id", "component", "label", and "value".
"label" may be a string or { "path": "..." }; "value" must be exactly { "path": "..." }.
Do not use checked, enabled, checks, or an action on CheckBox.
When the request asks for a form or subscription workflow, generate TextField value path /name, CheckBox value path /subscribed, one Button with action name "submit", context name bound to /name and subscribed bound to /subscribed, and one Text component with id "submitResult"; include submitResult in the rendered component tree.
The form root must be a Column with children exactly ["name", "subscribed", "submitButton", "submitResult"], and submitButton must use its own Text child as the visible button label.
Initialize the data model only as {"version":"v0.9","updateDataModel":{"surfaceId":"<surface-id>","value":{"name":"","subscribed":false}}}. The submit action handler will patch submitResult after the user submits.`
      : '';
  const workbenchRule = isWorkbench
    ? `
Use CustomerSummary only with id, component, customerName, company, owner, status, and recentNote; every display property must be a { "path": "..." } binding.
For every Workbench request, generate these exact component ids: root, customer, taskTitle, priority, reminderAt, submitButton, submitLabel, and submitResult.
root must be a Column with children exactly ["customer", "taskTitle", "priority", "reminderAt", "submitButton", "submitResult"].
customer must be CustomerSummary and bind /customer/customerName, /customer/company, /customer/owner, /status, and /customer/recentNote.
taskTitle must be a TextField with label "跟进任务", value path /taskTitle, and variant shortText.
priority must be a mutuallyExclusive ChoicePicker with label "优先级", displayStyle "chips", options 高/high, 普通/normal, 低/low in this order, and value path /priority.
reminderAt must be a DateTimeInput with label "提醒时间", value path /reminderAt, enableDate true, and enableTime true.
submitButton must be a Button with child submitLabel and submit action; its context must bind taskTitle to /taskTitle, priority to /priority, reminderAt to /reminderAt, customerId to /customer/customerId, and customerName to /customer/customerName.
submitResult must be a Text bound to /result and must be reachable from root.
Initialize data with customer.customerId, customer.customerName, customer.company, customer.owner, customer.recentNote, status "待跟进", empty taskTitle, priority ["normal"], reminderAt "", actionLabel "创建跟进任务", and result "等待提交".
If the user asks for a relative reminder such as "明天 10:00", use currentLocalDate to compute the exact local date and initialize reminderAt as "YYYY-MM-DDTHH:mm:00"; otherwise keep it as an empty string.`
    : '';
  return `You generate UI for the Nexus UI Agent line.
Return newline-delimited JSON objects only. Do not use markdown, prose, or a JSON array.
Each non-empty line is one independently valid JSON object.
Each object has exactly two fields: "version" and exactly one A2UI payload field.
For generation, line 1 has exactly {"version","createSurface"} and every later line has exactly {"version","updateComponents"} or {"version","updateDataModel"}.
Never put createSurface, updateComponents, updateDataModel, or deleteSurface in the same object as another payload.
One updateComponents message must include component id "root".
"version" is always the exact string "v0.9".
Component fields are A2UI fields: "id", "component", "child", "children", and component-specific fields.
Do not use generic UI fields such as "type", "properties", or nested component objects in "children".
Supported components: ${components.join(', ')}.
Supported action names: ${supportedActions.join(', ')}.
Use flat component ids, static children/child references, and { "path": "..." } bindings.
${tabsRule}
${imageRule}
${mediaRule}
${textFieldRule}
${checksRule}
${choicePickerRule}
${sliderRule}
${dateTimeInputRule}
${checkBoxRule}
${workbenchRule}
Use only action.event; do not use functionCall, sendDataModel, or form components outside the supported component list. If no checks rule above permits checks, do not use checks.
Attach actions only to Button (Nexus Basic Task and Workbench catalogs) or TaskButton (task catalog), never to Text or other components.
The first generation message must create the requested surface. Action responses may only update it.
The createSurface catalogId must be exactly ${catalogId}.
Keep component ids stable so later updates patch the UI in place.`;
}

function createGenerationFormatExample(catalogId: string, components: readonly string[]): string {
  if (catalogId === WORKBENCH_CATALOG) {
    return `{"version":"v0.9","createSurface":{"surfaceId":"example-surface","catalogId":"${catalogId}"}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"Column","children":["customer","taskTitle","priority","reminderAt","submitButton","submitResult"]},{"id":"customer","component":"CustomerSummary","customerName":{"path":"/customer/customerName"},"company":{"path":"/customer/company"},"owner":{"path":"/customer/owner"},"status":{"path":"/status"},"recentNote":{"path":"/customer/recentNote"}}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"example-surface","value":{"customer":{"customerId":"customer-1024","customerName":"华云科技","company":"Nexus Enterprise Buyer","owner":"Linda","recentNote":"上次会议确认希望补齐任务自动化能力"},"status":"待跟进","taskTitle":"","priority":["normal"],"reminderAt":"","actionLabel":"创建跟进任务","result":"等待提交"}}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"taskTitle","component":"TextField","label":"跟进任务","value":{"path":"/taskTitle"},"variant":"shortText"},{"id":"priority","component":"ChoicePicker","label":"优先级","variant":"mutuallyExclusive","options":[{"label":"高","value":"high"},{"label":"普通","value":"normal"},{"label":"低","value":"low"}],"value":{"path":"/priority"},"displayStyle":"chips"},{"id":"reminderAt","component":"DateTimeInput","label":"提醒时间","value":{"path":"/reminderAt"},"enableDate":true,"enableTime":true},{"id":"submitLabel","component":"Text","text":{"path":"/actionLabel"},"variant":"body"},{"id":"submitButton","component":"Button","child":"submitLabel","action":{"event":{"name":"submit","context":{"taskTitle":{"path":"/taskTitle"},"priority":{"path":"/priority"},"reminderAt":{"path":"/reminderAt"},"customerId":{"path":"/customer/customerId"},"customerName":{"path":"/customer/customerName"}}}}},{"id":"submitResult","component":"Text","text":{"path":"/result"},"variant":"body"}]}}`;
  }

  if (components.includes('TaskSummary')) {
    return `{"version":"v0.9","createSurface":{"surfaceId":"example-surface","catalogId":"${catalogId}"}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"TaskSummary","title":{"path":"/title"},"description":{"path":"/description"},"status":{"path":"/status"},"children":["button"]}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"example-surface","value":{"title":"Example","description":"Prepare the task","status":"Pending","actionLabel":"开始任务","taskId":"task-001"}}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"button","component":"TaskButton","label":{"path":"/actionLabel"},"action":{"event":{"name":"start","context":{"taskId":{"path":"/taskId"}}}}}]}}`;
  }

  return `{"version":"v0.9","createSurface":{"surfaceId":"example-surface","catalogId":"${catalogId}"}}
{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"Card","child":"content"},{"id":"content","component":"Row","align":"center","children":["avatar","info"]},{"id":"avatar","component":"Image","url":"https://ui-avatars.com/api/?name=Example&size=256","description":"Example avatar","variant":"avatar","fit":"cover"},{"id":"info","component":"Column","children":["title","subtitle"]},{"id":"title","component":"Text","text":"Example","variant":"h2"},{"id":"subtitle","component":"Text","text":"Contact card"}]}}`;
}

function createActionFormatExample(components: readonly string[]): string {
  if (components.includes('CustomerSummary')) {
    return `{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"submitButton","component":"Button","child":"submitLabel","disabled":true,"action":{"event":{"name":"submit","context":{"taskTitle":{"path":"/taskTitle"},"priority":{"path":"/priority"},"reminderAt":{"path":"/reminderAt"},"customerId":{"path":"/customer/customerId"},"customerName":{"path":"/customer/customerName"}}}}},{"id":"submitLabel","component":"Text","text":"任务已创建","variant":"body"},{"id":"submitResult","component":"Text","text":"任务已创建","variant":"body"}]}}`;
  }

  if (components.includes('TaskSummary')) {
    return `{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"root","component":"TaskSummary","status":"Refreshing"}]}}`;
  }
  return `{"version":"v0.9","updateComponents":{"surfaceId":"example-surface","components":[{"id":"buttonText","component":"Text","text":"Refreshing"}]}}`;
}

export function isLlmAgentEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function createLlmMessages({
  kind,
  surfaceId,
  message,
  catalogId = NEXUS_BASIC_TASK_CATALOG,
  supportedComponents = BASIC_CATALOG_COMPONENTS,
  supportedActions = BASIC_CATALOG_ACTIONS,
  history = [],
}: LlmAgentRequest): ChatCompletionMessageParam[] {
  const task =
    kind === 'generate'
      ? 'Create the initial UI for this request.'
      : 'Update the existing UI in response to this client action.';
  const resolvedCatalogId = catalogId;
  const resolvedComponents =
    resolvedCatalogId === WORKBENCH_CATALOG ? WORKBENCH_CATALOG_COMPONENTS : supportedComponents;
  const resolvedActions =
    resolvedCatalogId === WORKBENCH_CATALOG ? WORKBENCH_CATALOG_ACTIONS : supportedActions;
  const systemPrompt = createSystemPrompt(
    resolvedCatalogId,
    [...resolvedComponents],
    [...resolvedActions],
  );
  const generationExample = createGenerationFormatExample(resolvedCatalogId, [
    ...resolvedComponents,
  ]);
  const actionExample = createActionFormatExample([...resolvedComponents]);
  const now = new Date();
  const currentLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(now.getDate()).padStart(2, '0')}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Return the required NDJSON format for an initial generation.' },
    { role: 'assistant', content: generationExample },
    { role: 'user', content: 'Return the required NDJSON format for an action response.' },
    { role: 'assistant', content: actionExample },
    ...history.slice(-12).map((turn) => ({ ...turn })),
    {
      role: 'user',
      content: `${task}\nsurfaceId: ${surfaceId}\ncatalogId: ${catalogId}\ncurrentLocalDate: ${currentLocalDate}\nrequest: ${message}`,
    },
  ];
}

/** Parse model text deltas into candidate A2UI JSON objects. Validation stays at the transport seam. */
export async function* streamMessagesFromDeltas(
  deltas: AsyncIterable<string>,
): AsyncGenerator<unknown> {
  const buffer = new JSONLBuffer();
  const consume = (chunk: string): unknown[] => {
    const messages: unknown[] = [];
    for (const line of buffer.push(chunk)) {
      if (line === '```json' || line === '```') continue;
      messages.push(JSON.parse(line));
    }
    return messages;
  };

  for await (const delta of deltas) {
    yield* consume(delta);
  }
  for (const line of buffer.flush()) {
    if (line === '```json' || line === '```') continue;
    yield JSON.parse(line);
  }
}

async function* streamCompletionDeltas(request: LlmAgentRequest): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const baseURL = process.env.OPENAI_BASE_URL;
  const client = new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    messages: createLlmMessages(request),
    temperature: 0,
    stream: true,
  });

  for await (const chunk of completion) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield content;
  }
}

export function streamLlmMessages(request: LlmAgentRequest): AsyncGenerator<unknown> {
  return streamMessagesFromDeltas(streamCompletionDeltas(request));
}
