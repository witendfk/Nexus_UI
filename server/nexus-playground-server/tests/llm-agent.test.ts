import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLlmMessages, streamMessagesFromDeltas } from '../src/agent/llm-agent';
import {
  NEXUS_BASIC_TASK_CATALOG,
  TASK_CATALOG,
  TASK_CATALOG_COMPONENTS,
  WORKBENCH_CATALOG,
  WORKBENCH_CATALOG_COMPONENTS,
} from '../src/agent/catalog';

async function* deltas(chunks: string[]): AsyncGenerator<string> {
  yield* chunks;
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of generator) values.push(value);
  return values;
}

describe('streamMessagesFromDeltas', () => {
  it('解析跨 chunk 的 NDJSON 消息', async () => {
    const first = {
      version: 'v0.9',
      createSurface: { surfaceId: 'surface-1', catalogId: 'basic' },
    };
    const second = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'surface-1', value: {} },
    };
    const messages = await collect(
      streamMessagesFromDeltas(
        deltas([
          `${JSON.stringify(first)}\n{"ver`,
          `sion":"v0.9","updateDataModel":{"surfaceId":"surface-1","value":{}}}\n`,
        ]),
      ),
    );

    assert.deepEqual(messages, [first, second]);
  });

  it('允许模型输出被围栏包裹的 JSONL', async () => {
    const message = {
      version: 'v0.9',
      updateComponents: { surfaceId: 'surface-1', components: [] },
    };
    const messages = await collect(
      streamMessagesFromDeltas(deltas(['```json\n', `${JSON.stringify(message)}\n`, '```'])),
    );

    assert.deepEqual(messages, [message]);
  });
});

describe('createLlmMessages', () => {
  it('包含协议 few-shot 并把最近会话和当前任务放入请求', () => {
    const messages = createLlmMessages({
      kind: 'action',
      surfaceId: 'surface-1',
      message: 'call button clicked',
      history: [{ role: 'user', content: 'make a card' }],
    });

    assert.equal(messages[0]?.role, 'system');
    assert.match(String(messages[2]?.content), /"version":"v0.9"/);
    assert.match(String(messages[4]?.content), /updateComponents/);
    assert.deepEqual(messages[5], { role: 'user', content: 'make a card' });
    assert.match(String(messages.at(-1)?.content), /surface-1/);
    assert.match(String(messages.at(-1)?.content), new RegExp(NEXUS_BASIC_TASK_CATALOG));
    assert.match(String(messages.at(-1)?.content), /call button clicked/);
  });

  it('按请求 catalog 限制模型可生成组件', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-task',
      message: 'create a task',
      catalogId: TASK_CATALOG,
      supportedComponents: TASK_CATALOG_COMPONENTS,
    });
    const systemPrompt = String(messages[0]?.content);

    assert.match(systemPrompt, /Supported components: TaskSummary, TaskButton/);
    assert.doesNotMatch(systemPrompt, /Use Tabs only/);
    assert.doesNotMatch(systemPrompt, /Use Image only/);
    assert.match(systemPrompt, new RegExp(`catalogId must be exactly ${TASK_CATALOG}`));
    assert.match(String(messages[2]?.content), /TaskSummary/);
    assert.match(String(messages.at(-1)?.content), /surface-task/);
  });

  it('Nexus Basic Task Profile prompt 明确 Tabs 的静态字段形状', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: 'create tabs',
    });

    assert.match(String(messages[0]?.content), /Supported components:.*Tabs/);
    assert.match(
      String(messages[0]?.content),
      /Use Tabs only with "tabs": \[\{ "title": "...", "child": "component-id" }\]/,
    );
  });

  it('Nexus Basic Task Profile prompt 明确 Slider 的数值绑定契约', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: 'create a threshold slider',
    });
    const systemPrompt = String(messages[0]?.content);

    assert.match(systemPrompt, /Supported components:.*Slider/);
    assert.match(
      systemPrompt,
      /Use Slider only with "id", "component", optional "label", optional "min", required "max", required "value", and optional "checks"/,
    );
    assert.match(systemPrompt, /"value" must be exactly \{ "path": "\.\.\." \}/);
    assert.match(systemPrompt, /required "value", and optional "checks"/);
    assert.match(systemPrompt, /Do not use minValue, maxValue, or an action on Slider/);
  });

  it('Workbench prompt 固化企业任务 surface 的组件与绑定契约', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-workbench',
      message: '帮我给华云科技创建一条客户跟进任务',
      catalogId: WORKBENCH_CATALOG,
      supportedComponents: WORKBENCH_CATALOG_COMPONENTS,
      supportedActions: ['submit'],
    });
    const systemPrompt = String(messages[0]?.content);
    const generationExample = String(messages[2]?.content);

    assert.match(systemPrompt, /Supported components: CustomerSummary/);
    assert.match(systemPrompt, /Workbench does not support checks/);
    assert.match(systemPrompt, /Use CustomerSummary only with id, component, customerName/);
    assert.match(
      systemPrompt,
      /children exactly \["customer", "taskTitle", "priority", "reminderAt", "submitButton", "submitResult"\]/,
    );
    assert.match(
      systemPrompt,
      /Use DateTimeInput only with "id", "component", optional "label", "value", "enableDate", "enableTime", optional "min", and optional "max"/,
    );
    assert.match(systemPrompt, /reminderAt must be a DateTimeInput/);
    assert.match(systemPrompt, /reminderAt to \/reminderAt/);
    assert.match(systemPrompt, /use currentLocalDate to compute the exact local date/);
    assert.match(systemPrompt, /priority must be a mutuallyExclusive ChoicePicker/);
    assert.match(systemPrompt, /options 高\/high, 普通\/normal, 低\/low in this order/);
    assert.match(systemPrompt, /customerId to \/customer\/customerId/);
    assert.match(systemPrompt, /priority to \/priority/);
    assert.match(systemPrompt, /actionLabel "创建跟进任务"/);
    assert.match(generationExample, /"component":"CustomerSummary"/);
    assert.match(generationExample, /"component":"ChoicePicker"/);
    assert.match(generationExample, /"component":"DateTimeInput"/);
    assert.match(generationExample, /"value":\{"path":"\/priority"\}/);
    assert.match(generationExample, /"reminderAt":\{"path":"\/reminderAt"\}/);
    assert.match(generationExample, /"enableDate":true,"enableTime":true/);
    assert.match(generationExample, /"priority":\["normal"\]/);
    assert.match(String(messages.at(-1)?.content), /currentLocalDate: \d{4}-\d{2}-\d{2}/);
    assert.match(generationExample, /"name":"submit"/);
    assert.match(generationExample, /"path":"\/customer\/customerId"/);
  });

  it('Nexus Basic Task Profile prompt 明确 Image 使用 url 而不是 src', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: 'create an avatar',
    });

    assert.match(String(messages[0]?.content), /Supported components:.*Image/);
    assert.match(String(messages[0]?.content), /Use Image only with required "url"/);
    assert.match(String(messages[0]?.content), /do not use HTML-style "src" or "alt"/);
    assert.match(String(messages[0]?.content), /never put its URL in Text/);
    assert.match(
      String(messages[0]?.content),
      /set Image\.variant to "avatar" and Image\.fit to "cover"/,
    );
    assert.match(
      String(messages[0]?.content),
      /Never render or label the URL itself in Text, including through an updateDataModel field bound to Text\.text/,
    );
    assert.match(String(messages[2]?.content), /"variant":"avatar"/);
    assert.match(String(messages[0]?.content), /Attach actions only to Button/);
    assert.match(
      String(messages[0]?.content),
      /If an avatar is requested without a URL, use https:\/\/ui-avatars\.com\/api\/\?name=<name>&size=256/,
    );
  });

  it('Nexus Basic Task Profile prompt 明确媒体组件字段契约', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: 'create a media card',
    });
    const systemPrompt = String(messages[0]?.content);

    assert.match(systemPrompt, /Supported components:.*Video.*AudioPlayer/);
    assert.match(systemPrompt, /Use Video only with "id", "component", and required "url"/);
    assert.match(
      systemPrompt,
      /Use AudioPlayer only with "id", "component", required "url", and optional "description"/,
    );
    assert.match(systemPrompt, /do not add HTML-style src, controls, children, or an action/);
    assert.match(systemPrompt, /copy it exactly into the matching media component URL/);
  });

  it('Nexus Basic Task Profile prompt 明确 TextField 与 search action 的绑定契约', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: '生成一个搜索卡片',
    });
    const systemPrompt = String(messages[0]?.content);

    assert.match(systemPrompt, /Supported components:.*TextField/);
    assert.match(systemPrompt, /"value" must be exactly \{ "path": "..." \}/);
    assert.match(systemPrompt, /action name "search"/);
    assert.match(systemPrompt, /context keyword bound to \/keyword/);
    assert.match(systemPrompt, /id "searchResult"/);
    assert.match(
      systemPrompt,
      /"variant" may only be "shortText", "longText", "number", or "obscured"/,
    );
    assert.match(
      systemPrompt,
      /Use "validationRegexp" only when the user explicitly supplies a regular expression/,
    );
    assert.match(
      systemPrompt,
      /Do not use placeholder, accessibility, weight, or an action on TextField/,
    );
    assert.match(
      systemPrompt,
      /Use checks only in the Nexus Basic Task Profile and only on TextField, Slider, and Button/,
    );
    assert.match(
      systemPrompt,
      /Each check must be exactly \{ "condition": \{ "call", "args", "returnType": "boolean" \}, "message": "\.\.\." \}/,
    );
    assert.match(systemPrompt, /never put "call" at the CheckRule root/);
    assert.match(systemPrompt, /"call" may only be required, regex, length, numeric, or email/);
    assert.match(systemPrompt, /do not use and, or, not, or custom functions/);
    assert.match(
      systemPrompt,
      /repeat the same blocking condition on that action Button\.checks as well as the input component\.checks/,
    );
  });

  it('Nexus Basic Task Profile prompt 明确 CheckBox 与 submit 表单契约', () => {
    const messages = createLlmMessages({
      kind: 'generate',
      surfaceId: 'surface-basic',
      message: '生成一个订阅表单卡片',
    });
    const systemPrompt = String(messages[0]?.content);

    assert.match(systemPrompt, /Supported components:.*CheckBox/);
    assert.match(systemPrompt, /Use CheckBox only with "id", "component", "label", and "value"/);
    assert.match(
      systemPrompt,
      /Initialize the data model only as \{"version":"v0\.9","updateDataModel":\{"surfaceId":"<surface-id>","value":\{"name":"","subscribed":false\}\}\}/,
    );
    assert.match(systemPrompt, /action name "submit"/);
    assert.match(systemPrompt, /context name bound to \/name and subscribed bound to \/subscribed/);
    assert.match(systemPrompt, /id "submitResult"/);
    assert.match(
      systemPrompt,
      /children exactly \["name", "subscribed", "submitButton", "submitResult"\]/,
    );
    assert.match(systemPrompt, /Do not use checked, enabled, checks, or an action on CheckBox/);
  });
});
