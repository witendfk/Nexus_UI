/**
 * A2UI v0.9 校验边界。
 *
 * `validateProtocolMessage` 只判断官方 v0.9 消息结构；`validateNexusProfileMessage`
 * 判断 Nexus 当前 Runtime Profile 是否支持。旧的 `validateA2UIMessage` 保持兼容，
 * 等价于先协议校验、再 Profile 校验。
 */
import { PROTOCOL_VERSION } from './types';
import type { A2UIError, A2UIMessage, ParseResult } from './types';

const MESSAGE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

const CHECKABLE_COMPONENTS = new Set(['TextField', 'Slider', 'Button']);
const CHECK_FUNCTIONS = new Set(['required', 'regex', 'length', 'numeric', 'email']);
const FUNCTION_RETURN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'any',
  'void',
]);

type MessageKey = (typeof MESSAGE_KEYS)[number];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}

function isSupportedDynamicValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return true;
  if (Array.isArray(value)) return true;
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    value.path !== undefined &&
    typeof value.path === 'string'
  );
}

function isDynamicString(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (isObject(value) && Object.keys(value).length === 1 && typeof value.path === 'string')
  );
}

function isDynamicBoolean(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (isObject(value) && Object.keys(value).length === 1 && typeof value.path === 'string')
  );
}

function isDynamicNumber(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (isObject(value) && Object.keys(value).length === 1 && typeof value.path === 'string')
  );
}

function isDynamicStringList(value: unknown): boolean {
  return (
    (Array.isArray(value) && value.every((item) => typeof item === 'string')) ||
    (isObject(value) && Object.keys(value).length === 1 && typeof value.path === 'string')
  );
}

function isProtocolDataBinding(value: unknown): boolean {
  return (
    isObject(value) &&
    hasOnlyKeys(value, ['path']) &&
    typeof value.path === 'string' &&
    value.path.length > 0
  );
}

function validateProtocolFunctionCall(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['call', 'args', 'returnType'])) {
    return 'FunctionCall 只支持 call/args/returnType';
  }
  if (typeof value.call !== 'string' || value.call.length === 0) {
    return 'FunctionCall.call 必须是非空字符串';
  }
  if (value.args !== undefined && !isObject(value.args)) {
    return 'FunctionCall.args 必须是对象';
  }
  if (value.returnType !== undefined && !FUNCTION_RETURN_TYPES.has(value.returnType as string)) {
    return `FunctionCall.returnType 只支持 ${[...FUNCTION_RETURN_TYPES].join('/')}`;
  }
  return null;
}

function validateProtocolDynamicValue(value: unknown, returnType?: string): string | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    Array.isArray(value)
  ) {
    return null;
  }
  if (isProtocolDataBinding(value)) return null;
  if (isObject(value) && 'call' in value) {
    const functionError = validateProtocolFunctionCall(value);
    if (functionError) return functionError;
    if (returnType && value.returnType !== undefined && value.returnType !== returnType) {
      return `FunctionCall.returnType 必须是 ${returnType}`;
    }
    return null;
  }
  return '动态值必须是字面量、{ path } 或 FunctionCall';
}

function validateProtocolAction(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['event', 'functionCall'])) {
    return 'action 结构非法';
  }
  if (value.event !== undefined) {
    const event = value.event;
    if (!isObject(event) || !hasOnlyKeys(event, ['name', 'context'])) {
      return 'action.event 结构非法';
    }
    if (typeof event.name !== 'string' || event.name.length === 0) {
      return 'action.event.name 必须是非空字符串';
    }
    if (event.context !== undefined) {
      if (!isObject(event.context)) return 'action.event.context 必须是对象';
      for (const contextValue of Object.values(event.context)) {
        const error = validateProtocolDynamicValue(contextValue);
        if (error) return `action.event.context ${error}`;
      }
    }
    return null;
  }
  if (value.functionCall !== undefined) return validateProtocolFunctionCall(value.functionCall);
  return 'action 必须包含 event 或 functionCall';
}

function validateProtocolChecks(value: unknown): string | null {
  if (!Array.isArray(value)) return 'checks 必须是数组';
  for (const check of value) {
    if (!isObject(check) || !hasOnlyKeys(check, ['condition', 'message'])) {
      return 'checks[] 必须是只包含 condition 和 message 的对象';
    }
    if (typeof check.message !== 'string') return 'checks[].message 必须是字符串';
    const error = validateProtocolDynamicValue(check.condition, 'boolean');
    if (error) return `checks.condition ${error}`;
  }
  return null;
}

function validateProtocolComponent(value: unknown): string | null {
  if (!isObject(value)) return 'components[] 项必须是对象';
  if (typeof value.id !== 'string' || value.id.length === 0) {
    return 'component.id 必须是非空字符串';
  }
  if (typeof value.component !== 'string' || value.component.length === 0) {
    return 'component.component 必须是非空字符串';
  }
  if (value.child !== undefined && typeof value.child !== 'string') {
    return 'component.child 必须是字符串';
  }
  if (value.children !== undefined) {
    if (Array.isArray(value.children)) {
      if (!value.children.every((id) => typeof id === 'string')) {
        return 'children[] 必须是组件 id 字符串';
      }
    } else if (
      !isObject(value.children) ||
      !hasOnlyKeys(value.children, ['componentId', 'path']) ||
      typeof value.children.componentId !== 'string' ||
      typeof value.children.path !== 'string'
    ) {
      return 'children 必须是 id 数组或 { componentId, path }';
    }
  }
  if (value.tabs !== undefined) {
    if (!Array.isArray(value.tabs) || value.tabs.length === 0) {
      return 'component.tabs 必须是非空数组';
    }
    for (const tab of value.tabs) {
      if (!isObject(tab) || !hasOnlyKeys(tab, ['title', 'child'])) {
        return 'component.tabs[] 必须是只包含 title 和 child 的对象';
      }
      const titleError = validateProtocolDynamicValue(tab.title, 'string');
      if (titleError) return `component.tabs[].title ${titleError}`;
      if (typeof tab.child !== 'string') return 'component.tabs[].child 必须是字符串';
    }
  }
  if (value.checks !== undefined) {
    const checksError = validateProtocolChecks(value.checks);
    if (checksError) return checksError;
  }
  if (value.action !== undefined) {
    const actionError = validateProtocolAction(value.action);
    if (actionError) return actionError;
  }
  return null;
}

function validateProtocolPayload(key: MessageKey, payload: unknown): string | null {
  if (!isObject(payload)) return `${key} 必须是对象`;

  if (key === 'createSurface') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'catalogId', 'theme', 'sendDataModel'])) {
      return 'createSurface 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string' || payload.surfaceId.length === 0) {
      return 'createSurface.surfaceId 必须是非空字符串';
    }
    if (typeof payload.catalogId !== 'string' || payload.catalogId.length === 0) {
      return 'createSurface.catalogId 必须是非空字符串';
    }
    if (payload.theme !== undefined && !isObject(payload.theme)) {
      return 'createSurface.theme 必须是对象';
    }
    if (payload.sendDataModel !== undefined && typeof payload.sendDataModel !== 'boolean') {
      return 'createSurface.sendDataModel 必须是布尔值';
    }
    return null;
  }

  if (key === 'updateComponents') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'components'])) {
      return 'updateComponents 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string' || payload.surfaceId.length === 0) {
      return 'updateComponents.surfaceId 必须是非空字符串';
    }
    if (!Array.isArray(payload.components) || payload.components.length === 0) {
      return 'updateComponents.components 必须是非空数组';
    }
    const ids = new Set<string>();
    for (const component of payload.components) {
      const error = validateProtocolComponent(component);
      if (error) return error;
      const id = (component as { id?: unknown }).id;
      if (typeof id === 'string') {
        if (ids.has(id)) return `component.id 重复: ${id}`;
        ids.add(id);
      }
    }
    return null;
  }

  if (key === 'updateDataModel') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'path', 'value'])) {
      return 'updateDataModel 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string' || payload.surfaceId.length === 0) {
      return 'updateDataModel.surfaceId 必须是非空字符串';
    }
    if (payload.path !== undefined && typeof payload.path !== 'string') {
      return 'updateDataModel.path 必须是字符串';
    }
    return null;
  }

  if (!hasOnlyKeys(payload, ['surfaceId'])) return 'deleteSurface 包含未知字段';
  if (typeof payload.surfaceId !== 'string' || payload.surfaceId.length === 0) {
    return 'deleteSurface.surfaceId 必须是非空字符串';
  }
  return null;
}

/** Official A2UI v0.9 structural validation only. Profile support is a separate boundary. */
export function validateProtocolMessage(value: unknown): ParseResult {
  if (!isObject(value)) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'A2UI 消息必须是对象' },
    };
  }
  if (value.version !== PROTOCOL_VERSION) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: 'version 必须是 v0.9' },
    };
  }

  const keys = Object.keys(value).filter((key): key is MessageKey =>
    (MESSAGE_KEYS as readonly string[]).includes(key),
  );
  if (keys.length !== 1) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: '消息必须且只能包含一个 A2UI payload' },
    };
  }
  if (!hasOnlyKeys(value, ['version', ...MESSAGE_KEYS])) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: '消息信封包含未知字段' },
    };
  }

  const key = keys[0] as MessageKey;
  const payloadError = validateProtocolPayload(key, value[key]);
  if (payloadError) {
    return {
      ok: false,
      error: { code: 'PROTOCOL_INVALID', message: payloadError },
    };
  }
  return { ok: true, message: value as unknown as A2UIMessage };
}

function isIsoDateTimeValue(value: string, allowEmpty: boolean): boolean {
  if (allowEmpty && value === '') return true;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const time = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  return date.test(value) || time.test(value) || dateTime.test(value);
}

function containsUnsupportedFunctionCall(value: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (Array.isArray(value))
    return value.some((item) => containsUnsupportedFunctionCall(item, depth + 1));
  if (!isObject(value)) return false;

  const keys = Object.keys(value);
  const looksLikeFunctionCall =
    typeof value.call === 'string' &&
    keys.length > 0 &&
    keys.every((key) => key === 'call' || key === 'args' || key === 'returnType');
  return (
    looksLikeFunctionCall ||
    keys.some(
      (key) =>
        !(
          key === 'checks' &&
          typeof value.component === 'string' &&
          CHECKABLE_COMPONENTS.has(value.component)
        ) && containsUnsupportedFunctionCall(value[key], depth + 1),
    )
  );
}

function validateAction(value: unknown): string | null {
  if (!isObject(value) || !hasOnlyKeys(value, ['event', 'functionCall'])) {
    return 'action 结构非法';
  }
  if (value.functionCall !== undefined) return '当前 Agent 线不支持 action.functionCall';
  if (value.event === undefined) return 'action 必须包含 event 或 functionCall';

  const event = value.event;
  if (!isObject(event) || !hasOnlyKeys(event, ['name', 'context'])) return 'action.event 结构非法';
  if (typeof event.name !== 'string') return 'action.event.name 必须是字符串';
  if (event.context !== undefined) {
    if (!isStringRecord(event.context)) return 'action.event.context 必须是对象';
    for (const contextValue of Object.values(event.context)) {
      if (!isSupportedDynamicValue(contextValue)) {
        return 'action.event.context 包含不支持的动态值';
      }
    }
  }
  return null;
}

function isDataBindingObject(value: unknown): boolean {
  return isObject(value) && Object.keys(value).length === 1 && typeof value.path === 'string';
}

function validateCheckCondition(value: unknown): string | null {
  if (typeof value === 'boolean' || isDataBindingObject(value)) return null;
  if (!isObject(value) || !hasOnlyKeys(value, ['call', 'args', 'returnType'])) {
    return 'checks.condition 必须是布尔值、{ path } 绑定或 FunctionCall';
  }
  if (typeof value.call !== 'string' || !CHECK_FUNCTIONS.has(value.call)) {
    return `checks.condition.call 只支持 ${[...CHECK_FUNCTIONS].join('/')}`;
  }
  if (value.returnType !== undefined && value.returnType !== 'boolean') {
    return 'checks.condition.returnType 必须是 boolean';
  }
  if (!isObject(value.args)) return 'checks.condition.args 必须是对象';

  const args = value.args;
  const expectedArgs: Record<string, readonly string[]> = {
    required: ['value'],
    regex: ['value', 'pattern'],
    length: ['value', 'min', 'max'],
    numeric: ['value', 'min', 'max'],
    email: ['value'],
  };
  if (!hasOnlyKeys(args, expectedArgs[value.call as string])) {
    return `checks.condition.args 字段不符合 ${value.call} 契约`;
  }
  if (!isSupportedDynamicValue(args.value)) {
    return 'checks.condition.args.value 必须是合法动态值';
  }
  if (value.call === 'regex') {
    if (typeof args.pattern !== 'string') return 'checks.condition.args.pattern 必须是字符串';
    try {
      new RegExp(args.pattern);
    } catch {
      return 'checks.condition.args.pattern 必须是合法正则表达式';
    }
  }
  if (value.call === 'length' || value.call === 'numeric') {
    if (args.min === undefined && args.max === undefined) {
      return `checks.condition.args 必须提供 min 或 max`;
    }
    for (const key of ['min', 'max'] as const) {
      const bound = args[key];
      if (bound === undefined) continue;
      if (value.call === 'length') {
        if (!(typeof bound === 'number' && Number.isInteger(bound) && bound >= 0)) {
          return `checks.condition.args.${key} 必须是非负整数`;
        }
      } else if (!(typeof bound === 'number' && Number.isFinite(bound))) {
        return `checks.condition.args.${key} 必须是有限数字`;
      }
    }
  }
  return null;
}

function validateChecks(component: Record<string, unknown>): string | null {
  if (!Array.isArray(component.checks)) return 'checks 必须是数组';
  for (const check of component.checks) {
    if (!isObject(check) || !hasOnlyKeys(check, ['condition', 'message'])) {
      return 'checks[] 必须是只包含 condition 和 message 的对象';
    }
    if (typeof check.message !== 'string') return 'checks[].message 必须是字符串';
    const conditionError = validateCheckCondition(check.condition);
    if (conditionError) return conditionError;
  }
  return null;
}

function validateTextField(component: Record<string, unknown>): string | null {
  if (component.component !== 'TextField') return null;
  if (!isDynamicString(component.label)) {
    return 'TextField.label 必须是字符串或 { path } 绑定';
  }
  if (component.value !== undefined && !isDynamicString(component.value)) {
    return 'TextField.value 必须是字符串或 { path } 绑定';
  }
  const variant = component.variant;
  if (
    variant !== undefined &&
    !['longText', 'number', 'shortText', 'obscured'].includes(variant as string)
  ) {
    return 'TextField.variant 只支持 longText/number/shortText/obscured';
  }
  if (component.validationRegexp !== undefined && typeof component.validationRegexp !== 'string') {
    return 'TextField.validationRegexp 必须是字符串';
  }
  if (typeof component.validationRegexp === 'string') {
    try {
      new RegExp(component.validationRegexp);
    } catch {
      return 'TextField.validationRegexp 必须是合法正则表达式';
    }
  }
  if (component.checks !== undefined) {
    const checksError = validateChecks(component);
    if (checksError) return checksError;
  }
  if (component.action !== undefined) return 'TextField 不支持挂载 action';
  return null;
}

function validateCheckBox(component: Record<string, unknown>): string | null {
  if (component.component !== 'CheckBox') return null;
  if (!isDynamicString(component.label)) {
    return 'CheckBox.label 必须是字符串或 { path } 绑定';
  }
  if (!isDynamicBoolean(component.value)) {
    return 'CheckBox.value 必须是布尔值或 { path } 绑定';
  }
  if (component.action !== undefined) return 'CheckBox 不支持挂载 action';
  return null;
}

function validateChoicePicker(component: Record<string, unknown>): string | null {
  if (component.component !== 'ChoicePicker') return null;
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'ChoicePicker.label 必须是字符串或 { path } 绑定';
  }
  if (
    component.variant !== undefined &&
    !['multipleSelection', 'mutuallyExclusive'].includes(component.variant as string)
  ) {
    return 'ChoicePicker.variant 只支持 multipleSelection/mutuallyExclusive';
  }
  if (!Array.isArray(component.options) || component.options.length === 0) {
    return 'ChoicePicker.options 必须是非空数组';
  }
  const optionValues: string[] = [];
  for (const option of component.options) {
    if (!isObject(option) || !hasOnlyKeys(option, ['label', 'value'])) {
      return 'ChoicePicker.options[] 必须是只包含 label 和 value 的对象';
    }
    if (!isDynamicString(option.label)) {
      return 'ChoicePicker.options[].label 必须是字符串或 { path } 绑定';
    }
    if (typeof option.value !== 'string' || option.value.length === 0) {
      return 'ChoicePicker.options[].value 必须是非空字符串';
    }
    if (optionValues.includes(option.value)) {
      return 'ChoicePicker.options[].value 不能重复';
    }
    optionValues.push(option.value);
  }
  if (!isDynamicStringList(component.value)) {
    return 'ChoicePicker.value 必须是字符串数组或 { path } 绑定';
  }
  if (
    component.displayStyle !== undefined &&
    !['checkbox', 'chips'].includes(component.displayStyle as string)
  ) {
    return 'ChoicePicker.displayStyle 只支持 checkbox/chips';
  }
  if (component.filterable !== undefined && typeof component.filterable !== 'boolean') {
    return 'ChoicePicker.filterable 必须是布尔值';
  }
  if (component.action !== undefined) return 'ChoicePicker 不支持挂载 action';
  return null;
}

function validateSlider(component: Record<string, unknown>): string | null {
  if (component.component !== 'Slider') return null;
  if (component.action !== undefined) return 'Slider 不支持挂载 action';
  if (component.checks !== undefined) {
    const checksError = validateChecks(component);
    if (checksError) return checksError;
  }
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'Slider.label 必须是字符串或 { path } 绑定';
  }
  if (
    component.min !== undefined &&
    !(typeof component.min === 'number' && Number.isFinite(component.min))
  ) {
    return 'Slider.min 必须是有限数字';
  }
  if (!(typeof component.max === 'number' && Number.isFinite(component.max))) {
    return 'Slider.max 必须是有限数字';
  }
  if (!isDynamicNumber(component.value)) {
    return 'Slider.value 必须是有限数字或 { path } 绑定';
  }
  if (
    typeof component.min === 'number' &&
    typeof component.max === 'number' &&
    component.min >= component.max
  ) {
    return 'Slider.min 必须小于 max';
  }
  if (
    typeof component.value === 'number' &&
    typeof component.min === 'number' &&
    component.value < component.min
  ) {
    return 'Slider.value 不能小于 min';
  }
  if (
    typeof component.value === 'number' &&
    typeof component.max === 'number' &&
    component.value > component.max
  ) {
    return 'Slider.value 不能大于 max';
  }
  return null;
}

function validateDateTimeInput(component: Record<string, unknown>): string | null {
  if (component.component !== 'DateTimeInput') return null;
  if (component.action !== undefined) return 'DateTimeInput 不支持挂载 action';
  if (component.checks !== undefined) return '当前 Agent 线不支持 DateTimeInput.checks';
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'DateTimeInput.label 必须是字符串或 { path } 绑定';
  }
  if (!isDynamicString(component.value)) {
    return 'DateTimeInput.value 必须是 ISO 8601 字符串或 { path } 绑定';
  }
  if (typeof component.value === 'string' && !isIsoDateTimeValue(component.value, true)) {
    return 'DateTimeInput.value 必须是 ISO 8601 date/time/date-time 字符串';
  }
  const enableDate = component.enableDate;
  const enableTime = component.enableTime;
  if (enableDate !== undefined && typeof enableDate !== 'boolean') {
    return 'DateTimeInput.enableDate 必须是布尔值';
  }
  if (enableTime !== undefined && typeof enableTime !== 'boolean') {
    return 'DateTimeInput.enableTime 必须是布尔值';
  }
  if (enableDate !== true && enableTime !== true) {
    return 'DateTimeInput.enableDate/enableTime 至少一个为 true';
  }
  for (const key of ['min', 'max'] as const) {
    const value = component[key];
    if (value === undefined) continue;
    if (!isDynamicString(value)) {
      return `DateTimeInput.${key} 必须是 ISO 8601 字符串或 { path } 绑定`;
    }
    if (typeof value === 'string' && !isIsoDateTimeValue(value, false)) {
      return `DateTimeInput.${key} 必须是 ISO 8601 date/time/date-time 字符串`;
    }
  }
  return null;
}

function validateMediaComponent(component: Record<string, unknown>): string | null {
  if (component.component === 'Video') {
    if (!hasOnlyKeys(component, ['id', 'component', 'url'])) {
      return 'Video 只支持 id/component/url';
    }
    if (!isDynamicString(component.url)) {
      return 'Video.url 必须是字符串或 { path } 绑定';
    }
    return null;
  }

  if (component.component === 'AudioPlayer') {
    if (!hasOnlyKeys(component, ['id', 'component', 'url', 'description'])) {
      return 'AudioPlayer 只支持 id/component/url/description';
    }
    if (!isDynamicString(component.url)) {
      return 'AudioPlayer.url 必须是字符串或 { path } 绑定';
    }
    if (component.description !== undefined && !isDynamicString(component.description)) {
      return 'AudioPlayer.description 必须是字符串或 { path } 绑定';
    }
  }
  return null;
}

function validateComponent(value: unknown): string | null {
  if (!isObject(value)) return 'components[] 项必须是对象';
  if (typeof value.id !== 'string') return 'component.id 必须是字符串';
  if (typeof value.component !== 'string') return 'component.component 必须是字符串';
  if (value.checks !== undefined && !CHECKABLE_COMPONENTS.has(value.component)) {
    return `当前 Agent 线不支持 ${value.component}.checks`;
  }

  const textFieldError = validateTextField(value);
  if (textFieldError) return textFieldError;

  const checkBoxError = validateCheckBox(value);
  if (checkBoxError) return checkBoxError;

  const choicePickerError = validateChoicePicker(value);
  if (choicePickerError) return choicePickerError;

  const sliderError = validateSlider(value);
  if (sliderError) return sliderError;

  const dateTimeInputError = validateDateTimeInput(value);
  if (dateTimeInputError) return dateTimeInputError;

  const mediaError = validateMediaComponent(value);
  if (mediaError) return mediaError;

  if (value.component === 'Button' && value.checks !== undefined) {
    const checksError = validateChecks(value);
    if (checksError) return checksError;
  }

  if (value.children !== undefined) {
    if (!Array.isArray(value.children) || !value.children.every((id) => typeof id === 'string')) {
      return '当前 Agent 线只支持静态 children id 数组';
    }
  }
  if (value.child !== undefined && typeof value.child !== 'string') {
    return 'component.child 必须是字符串';
  }
  if (value.tabs !== undefined) {
    if (!Array.isArray(value.tabs) || value.tabs.length === 0) {
      return 'component.tabs 必须是非空数组';
    }
    for (const tab of value.tabs) {
      if (!isObject(tab) || !hasOnlyKeys(tab, ['title', 'child'])) {
        return 'component.tabs[] 必须是只包含 title 和 child 的对象';
      }
      const isDynamicString =
        typeof tab.title === 'string' ||
        (isObject(tab.title) &&
          Object.keys(tab.title).length === 1 &&
          typeof tab.title.path === 'string');
      if (!isDynamicString) {
        return 'component.tabs[].title 必须是字符串或 { path } 绑定';
      }
      if (typeof tab.child !== 'string') return 'component.tabs[].child 必须是字符串';
    }
  }
  if (value.action !== undefined) {
    const actionError = validateAction(value.action);
    if (actionError) return actionError;
  }
  return null;
}

function validatePayload(key: MessageKey, payload: unknown): string | null {
  if (!isObject(payload)) return `${key} 必须是对象`;

  if (key === 'createSurface') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'catalogId', 'theme', 'sendDataModel'])) {
      return 'createSurface 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string') return 'createSurface.surfaceId 必须是字符串';
    if (typeof payload.catalogId !== 'string') return 'createSurface.catalogId 必须是字符串';
    if (payload.theme !== undefined && !isObject(payload.theme))
      return 'createSurface.theme 必须是对象';
    if (payload.sendDataModel === true) return '当前 Agent 线不支持 sendDataModel';
    if (payload.sendDataModel !== undefined && typeof payload.sendDataModel !== 'boolean') {
      return 'createSurface.sendDataModel 必须是布尔值';
    }
    return null;
  }

  if (key === 'updateComponents') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'components'])) {
      return 'updateComponents 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string') return 'updateComponents.surfaceId 必须是字符串';
    if (!Array.isArray(payload.components) || payload.components.length === 0) {
      return 'updateComponents.components 必须是非空数组';
    }
    for (const component of payload.components) {
      const error = validateComponent(component);
      if (error) return error;
    }
    return null;
  }

  if (key === 'updateDataModel') {
    if (!hasOnlyKeys(payload, ['surfaceId', 'path', 'value'])) {
      return 'updateDataModel 包含未知字段';
    }
    if (typeof payload.surfaceId !== 'string') return 'updateDataModel.surfaceId 必须是字符串';
    if (payload.path !== undefined && typeof payload.path !== 'string') {
      return 'updateDataModel.path 必须是字符串';
    }
    return null;
  }

  if (!hasOnlyKeys(payload, ['surfaceId'])) return 'deleteSurface 包含未知字段';
  if (typeof payload.surfaceId !== 'string') return 'deleteSurface.surfaceId 必须是字符串';
  return null;
}

/**
 * 校验当前 Nexus Runtime Profile。入参必须已通过 `validateProtocolMessage`。
 * 返回 ok 时不改变对象身份，仅将 unknown 收窄为协议消息。
 */
export function validateNexusProfileMessage(value: unknown): A2UIError | null {
  if (!isObject(value)) {
    return { code: 'FEATURE_UNSUPPORTED', message: 'A2UI 消息必须是对象' };
  }
  if (value.version !== PROTOCOL_VERSION)
    return { code: 'FEATURE_UNSUPPORTED', message: 'version 必须是 v0.9' };

  const keys = Object.keys(value).filter((key): key is MessageKey =>
    (MESSAGE_KEYS as readonly string[]).includes(key),
  );
  if (keys.length !== 1) {
    return { code: 'FEATURE_UNSUPPORTED', message: '消息必须且只能包含一个 A2UI payload' };
  }
  if (!hasOnlyKeys(value, ['version', ...MESSAGE_KEYS])) {
    return { code: 'FEATURE_UNSUPPORTED', message: '消息信封包含未知字段' };
  }

  const key = keys[0] as MessageKey;
  const payloadError = validatePayload(key, value[key]);
  if (payloadError) {
    return { code: 'FEATURE_UNSUPPORTED', message: payloadError };
  }
  if (containsUnsupportedFunctionCall(value[key])) {
    return {
      code: 'FEATURE_UNSUPPORTED',
      message: '当前 Agent 线不支持 FunctionCall',
    };
  }
  return null;
}

/** Backward-compatible entry: protocol validity plus the current Nexus profile. */
export function validateA2UIMessage(value: unknown): ParseResult {
  const protocolResult = validateProtocolMessage(value);
  if (!protocolResult.ok) return protocolResult;
  const profileError = validateNexusProfileMessage(protocolResult.message);
  if (profileError) return { ok: false, error: profileError };
  return protocolResult;
}

/** 兼容既有 API 的布尔校验入口。 */
export function isA2UIMessage(value: unknown): value is A2UIMessage {
  return validateA2UIMessage(value).ok;
}
