import type { A2UIMessage, Component } from '@nexus-ui/core';
import type { CatalogRegistry } from '@nexus-ui/core';
import { applyDataModelUpdate, getByPath, validateComponentProps } from '@nexus-ui/core';
import type { ComponentSchemaDiagnostic } from '@nexus-ui/core';
import {
  BASIC_CATALOG,
  BASIC_CATALOG_ACTIONS,
  TASK_CATALOG,
  WORKBENCH_CATALOG,
  agentCatalogRegistry,
} from './catalog';

export interface AgentSequenceOptions {
  kind: 'generate' | 'action';
  surfaceId: string;
  catalogId?: string;
  registry?: CatalogRegistry;
  supportedActions?: readonly string[];
  message?: string;
}

function getMessageInfo(message: A2UIMessage): { key: string; surfaceId: string } {
  if ('createSurface' in message) {
    return { key: 'createSurface', surfaceId: message.createSurface.surfaceId };
  }
  if ('updateComponents' in message) {
    return { key: 'updateComponents', surfaceId: message.updateComponents.surfaceId };
  }
  if ('updateDataModel' in message) {
    return { key: 'updateDataModel', surfaceId: message.updateDataModel.surfaceId };
  }
  return { key: 'deleteSurface', surfaceId: message.deleteSurface.surfaceId };
}

function isDynamicString(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { path?: unknown }).path === 'string')
  );
}

function isDynamicBoolean(value: unknown): boolean {
  return (
    typeof value === 'boolean' ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { path?: unknown }).path === 'string')
  );
}

function isDynamicNumber(value: unknown): boolean {
  return (
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 1 &&
      typeof (value as { path?: unknown }).path === 'string')
  );
}

function getDataBindingPath(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { path?: unknown }).path === 'string'
  ) {
    return (value as { path: string }).path;
  }
  return null;
}

function isIsoDateTimeLiteral(value: string): boolean {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const time = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  return date.test(value) || time.test(value) || dateTime.test(value);
}

function hasOnlyComponentKeys(component: Component, allowed: readonly string[]): boolean {
  return Object.keys(component).every((key) => allowed.includes(key));
}

function validateBasicImage(component: Component): string | null {
  if (component.component !== 'Image') return null;
  if (component.src !== undefined || component.alt !== undefined) {
    return 'Basic Catalog Image 不支持 src/alt，请使用 url/description';
  }
  if (!isDynamicString(component.url)) {
    return 'Basic Catalog Image.url 必须是字符串或 { path } 绑定';
  }
  if (component.description !== undefined && !isDynamicString(component.description)) {
    return 'Basic Catalog Image.description 必须是字符串或 { path } 绑定';
  }
  if (component.fit !== undefined && component.fit !== 'cover' && component.fit !== 'contain') {
    return 'Basic Catalog Image.fit 只支持 cover/contain';
  }
  if (component.variant !== undefined && component.variant !== 'avatar') {
    return 'Basic Catalog Image.variant 只支持 avatar';
  }
  return null;
}

function validateBasicTextField(component: Component): string | null {
  if (component.component !== 'TextField') return null;
  if (
    !hasOnlyComponentKeys(component, [
      'id',
      'component',
      'label',
      'value',
      'variant',
      'validationRegexp',
    ])
  ) {
    return 'Basic Catalog TextField 只支持 id/component/label/value/variant/validationRegexp';
  }
  if (!isDynamicString(component.label)) {
    return 'Basic Catalog TextField.label 必须是字符串或 { path } 绑定';
  }
  if (getDataBindingPath(component.value) === null) {
    return 'Basic Catalog TextField.value 必须是 { path } 绑定';
  }
  if (
    component.variant !== undefined &&
    !['longText', 'number', 'shortText', 'obscured'].includes(String(component.variant))
  ) {
    return 'TextField.variant 只支持 longText/number/shortText/obscured';
  }
  const validationRegexp = component.validationRegexp;
  if (validationRegexp !== undefined) {
    if (typeof validationRegexp !== 'string') {
      return 'TextField.validationRegexp 必须是字符串';
    }
    if (validationRegexp.length > 256) {
      return 'TextField.validationRegexp 长度不能超过 256';
    }
    try {
      new RegExp(validationRegexp);
    } catch {
      return 'TextField.validationRegexp 必须是合法正则表达式';
    }
  }
  return null;
}

function validateBasicCheckBox(component: Component): string | null {
  if (component.component !== 'CheckBox') return null;
  if (component.action !== undefined) return 'CheckBox 不支持挂载 action';
  if (!hasOnlyComponentKeys(component, ['id', 'component', 'label', 'value'])) {
    return 'Basic Catalog CheckBox 只支持 id/component/label/value';
  }
  if (!isDynamicString(component.label)) {
    return 'Basic Catalog CheckBox.label 必须是字符串或 { path } 绑定';
  }
  if (getDataBindingPath(component.value) === null) {
    return 'Basic Catalog CheckBox.value 必须是 { path } 绑定';
  }
  if (!isDynamicBoolean(component.value)) {
    return 'Basic Catalog CheckBox.value 必须是布尔值或 { path } 绑定';
  }
  return null;
}

function getChoiceOptionValues(component: Component): string[] {
  return Array.isArray(component.options)
    ? component.options
        .map((option) =>
          typeof option === 'object' &&
          option !== null &&
          !Array.isArray(option) &&
          typeof option.value === 'string'
            ? option.value
            : null,
        )
        .filter((value): value is string => value !== null)
    : [];
}

function validateChoicePicker(component: Component): string | null {
  if (component.component !== 'ChoicePicker') return null;
  if (component.action !== undefined) return 'ChoicePicker 不支持挂载 action';
  if (
    !hasOnlyComponentKeys(component, [
      'id',
      'component',
      'label',
      'variant',
      'options',
      'value',
      'displayStyle',
      'filterable',
    ])
  ) {
    return 'ChoicePicker 只支持 id/component/label/variant/options/value/displayStyle/filterable';
  }
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'ChoicePicker.label 必须是字符串或 { path } 绑定';
  }
  if (
    component.variant !== undefined &&
    !['multipleSelection', 'mutuallyExclusive'].includes(String(component.variant))
  ) {
    return 'ChoicePicker.variant 只支持 multipleSelection/mutuallyExclusive';
  }
  if (!Array.isArray(component.options) || component.options.length === 0) {
    return 'ChoicePicker.options 必须是非空数组';
  }

  const values: string[] = [];
  for (const option of component.options) {
    if (
      typeof option !== 'object' ||
      option === null ||
      Array.isArray(option) ||
      !hasOnlyComponentKeys(option as Component, ['label', 'value'])
    ) {
      return 'ChoicePicker.options[] 必须是只包含 label 和 value 的对象';
    }
    const choiceOption = option as { label?: unknown; value?: unknown };
    if (!isDynamicString(choiceOption.label)) {
      return 'ChoicePicker.options[].label 必须是字符串或 { path } 绑定';
    }
    if (typeof choiceOption.value !== 'string' || choiceOption.value.length === 0) {
      return 'ChoicePicker.options[].value 必须是非空字符串';
    }
    if (values.includes(choiceOption.value)) {
      return 'ChoicePicker.options[].value 不能重复';
    }
    values.push(choiceOption.value);
  }

  if (getDataBindingPath(component.value) === null) {
    return 'ChoicePicker.value 必须是 { path } 绑定';
  }
  if (
    component.displayStyle !== undefined &&
    !['checkbox', 'chips'].includes(String(component.displayStyle))
  ) {
    return 'ChoicePicker.displayStyle 只支持 checkbox/chips';
  }
  if (component.filterable !== undefined && typeof component.filterable !== 'boolean') {
    return 'ChoicePicker.filterable 必须是布尔值';
  }
  return null;
}

function validateBasicSlider(component: Component): string | null {
  if (component.component !== 'Slider') return null;
  if (component.action !== undefined) return 'Slider 不支持挂载 action';
  if (component.checks !== undefined) return '当前 Agent 线不支持 Slider.checks';
  if (!hasOnlyComponentKeys(component, ['id', 'component', 'label', 'min', 'max', 'value'])) {
    return 'Slider 只支持 id/component/label/min/max/value';
  }
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'Slider.label 必须是字符串或 { path } 绑定';
  }
  const min = component.min;
  const max = component.max;
  if (min !== undefined && !(typeof min === 'number' && Number.isFinite(min))) {
    return 'Slider.min 必须是有限数字';
  }
  if (!(typeof max === 'number' && Number.isFinite(max))) {
    return 'Slider.max 必须是有限数字';
  }
  if (typeof min === 'number' && min >= max) return 'Slider.min 必须小于 max';
  if (getDataBindingPath(component.value) === null) {
    return 'Slider.value 必须是 { path } 绑定';
  }
  if (!isDynamicNumber(component.value)) {
    return 'Slider.value 必须是有限数字或 { path } 绑定';
  }
  return null;
}

function validateBasicDateTimeInput(component: Component): string | null {
  if (component.component !== 'DateTimeInput') return null;
  if (component.action !== undefined) return 'DateTimeInput 不支持挂载 action';
  if (
    !hasOnlyComponentKeys(component, [
      'id',
      'component',
      'label',
      'value',
      'enableDate',
      'enableTime',
      'min',
      'max',
    ])
  ) {
    return 'DateTimeInput 只支持 id/component/label/value/enableDate/enableTime/min/max';
  }
  if (component.label !== undefined && !isDynamicString(component.label)) {
    return 'DateTimeInput.label 必须是字符串或 { path } 绑定';
  }
  if (getDataBindingPath(component.value) === null) {
    return 'DateTimeInput.value 必须是 { path } 绑定';
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
    if (typeof value === 'string' && !isIsoDateTimeLiteral(value)) {
      return `DateTimeInput.${key} 必须是 ISO 8601 date/time/date-time 字符串`;
    }
  }
  return null;
}

function validateWorkbenchButton(component: Component): string | null {
  if (component.component !== 'Button') return null;
  if (!hasOnlyComponentKeys(component, ['id', 'component', 'child', 'disabled', 'action'])) {
    return 'Workbench Button 只支持 id/component/child/disabled/action';
  }
  if (typeof component.child !== 'string') return 'Workbench Button.child 必须是组件 id';
  if (component.disabled !== undefined && typeof component.disabled !== 'boolean') {
    return 'Workbench Button.disabled 必须是布尔值';
  }
  if (component.action?.event === undefined) return 'Workbench Button 必须挂载 submit action';
  return null;
}

function validateBasicText(component: Component): string | null {
  if (component.component !== 'Text' || typeof component.text !== 'string') return null;
  if (/https?:\/\//i.test(component.text)) {
    return 'Basic Catalog Text 不能承载 URL；图片 URL 必须使用 Image.url';
  }
  return null;
}

function validateDynamicText(component: Component, dataModel?: unknown): string | null {
  if (component.component !== 'Text') return null;
  const path = getDataBindingPath(component.text);
  if (path === null) return null;
  if (/(avatar|image|photo|picture|icon|logo|url|link|website)/i.test(path)) {
    return 'Basic Catalog Text 不能绑定 URL 类字段；图片 URL 必须使用 Image.url';
  }
  const value = getByPath(dataModel, path);
  if (typeof value === 'string' && /https?:\/\//i.test(value)) {
    return 'Basic Catalog Text 不能承载 URL；图片 URL 必须使用 Image.url';
  }
  return null;
}

/** Keep the LLM inside the one-surface Agent line even when its JSON is structurally valid. */
export function validateAgentSequence(
  message: A2UIMessage,
  index: number,
  {
    kind,
    surfaceId,
    catalogId = BASIC_CATALOG,
    registry = agentCatalogRegistry,
    supportedActions = BASIC_CATALOG_ACTIONS,
  }: AgentSequenceOptions,
): string | null {
  const info = getMessageInfo(message);
  if (info.surfaceId !== surfaceId) return `消息 surfaceId 必须保持为 ${surfaceId}`;
  const catalog = registry.get(catalogId);
  if (!catalog) return `Agent catalog 未注册: ${catalogId}`;

  if ('createSurface' in message && message.createSurface.catalogId !== catalogId) {
    return `createSurface.catalogId 必须保持为 ${catalogId}`;
  }
  if ('updateComponents' in message) {
    for (const component of message.updateComponents.components) {
      if (!catalog.components.includes(component.component)) {
        return `当前 Agent 线不支持组件: ${String(component.component)}`;
      }
      const schema = registry.getComponentSchema(catalogId, component.component);
      if (schema) {
        const propsError = validateComponentProps(component, schema);
        if (propsError) return propsError;
      }

      if (catalogId === WORKBENCH_CATALOG) {
        const workbenchButtonError = validateWorkbenchButton(component);
        if (workbenchButtonError) return workbenchButtonError;
      }

      if (catalogId === BASIC_CATALOG || catalogId === WORKBENCH_CATALOG) {
        const imageError = validateBasicImage(component);
        if (imageError) return imageError;
        const textFieldError = validateBasicTextField(component);
        if (textFieldError) return textFieldError;
        const checkBoxError = validateBasicCheckBox(component);
        if (checkBoxError) return checkBoxError;
        const choicePickerError = validateChoicePicker(component);
        if (choicePickerError) return choicePickerError;
        const sliderError = validateBasicSlider(component);
        if (sliderError) return sliderError;
        const dateTimeInputError = validateBasicDateTimeInput(component);
        if (dateTimeInputError) return dateTimeInputError;
        const textError = validateBasicText(component);
        if (textError) return textError;
      }
      const actionName = component.action?.event?.name;
      if (actionName !== undefined && !supportedActions.includes(actionName)) {
        return `当前 Agent 线不支持 action: ${actionName}`;
      }
      if (actionName !== undefined) {
        const actionComponent = catalogId === TASK_CATALOG ? 'TaskButton' : 'Button';
        if (component.component !== actionComponent) {
          return `当前 Agent 线 action 只能挂载在 ${actionComponent} 组件上`;
        }
      }
    }
  }
  if (kind === 'action') {
    if (info.key === 'createSurface' || info.key === 'deleteSurface') {
      return 'action 响应只能包含 updateComponents 或 updateDataModel';
    }
    return null;
  }
  if (index === 0 && info.key !== 'createSurface') return '生成流第一条消息必须是 createSurface';
  if (index > 0 && info.key !== 'updateComponents' && info.key !== 'updateDataModel') {
    return 'createSurface 之后只能包含 updateComponents 或 updateDataModel';
  }
  return null;
}

function isSearchRequest(message?: string): boolean {
  return typeof message === 'string' && /搜索|search/i.test(message);
}

function isFormRequest(message?: string): boolean {
  return typeof message === 'string' && /表单|form|订阅|subscribe/i.test(message);
}

function validateSearchContract(components: Component[]): string | null {
  const textFields = components.filter((component) => component.component === 'TextField');
  if (textFields.length === 0) {
    return '搜索 UI 必须包含 TextField，且 value 使用 { path } 绑定';
  }
  if (!components.some((component) => component.id === 'searchResult')) {
    return '搜索 UI 必须包含 id 为 searchResult 的 Text 结果组件';
  }
  const searchButton = components.find(
    (component) => component.component === 'Button' && component.action?.event?.name === 'search',
  );
  if (!searchButton) return '搜索 UI 必须包含 action 为 search 的 Button';

  const fieldPaths = new Set(
    textFields
      .map((component) => getDataBindingPath(component.value))
      .filter((path): path is string => path !== null),
  );
  const keywordPath = getDataBindingPath(searchButton.action?.event?.context?.keyword);
  if (keywordPath === null || !fieldPaths.has(keywordPath)) {
    return 'search action 的 keyword.context 必须绑定 TextField.value 的同一个 path';
  }
  return null;
}

function validateSubmitContract(components: Component[]): string | null {
  const textFields = components.filter((component) => component.component === 'TextField');
  const checkBoxes = components.filter((component) => component.component === 'CheckBox');
  if (textFields.length === 0 || checkBoxes.length === 0) {
    return '表单 UI 必须同时包含 TextField 和 CheckBox，且 value 使用 { path } 绑定';
  }
  if (
    !components.some(
      (component) => component.id === 'submitResult' && component.component === 'Text',
    )
  ) {
    return '表单 UI 必须包含 id 为 submitResult 的 Text 结果组件';
  }
  const submitButton = components.find(
    (component) => component.component === 'Button' && component.action?.event?.name === 'submit',
  );
  if (!submitButton) return '表单 UI 必须包含 action 为 submit 的 Button';

  const fieldPaths = new Set(
    textFields
      .map((component) => getDataBindingPath(component.value))
      .filter((path): path is string => path !== null),
  );
  const checkBoxPaths = new Set(
    checkBoxes
      .map((component) => getDataBindingPath(component.value))
      .filter((path): path is string => path !== null),
  );
  const contextPaths = new Set(
    Object.values(submitButton.action?.event?.context ?? {})
      .map((value) => getDataBindingPath(value))
      .filter((path): path is string => path !== null),
  );
  if (![...contextPaths].some((path) => fieldPaths.has(path))) {
    return 'submit action 的 context 必须绑定 TextField.value 的同一个 path';
  }
  if (![...contextPaths].some((path) => checkBoxPaths.has(path))) {
    return 'submit action 的 context 必须绑定 CheckBox.value 的同一个 path';
  }
  const reachableIds = collectReachableIds(components);
  const requiredGroups = [
    textFields.map((component) => component.id),
    checkBoxes.map((component) => component.id),
    [submitButton.id],
    ['submitResult'],
  ];
  if (!requiredGroups.every((ids) => ids.some((id) => reachableIds.has(id)))) {
    return '表单 UI 的 TextField/CheckBox/submit/submitResult 必须挂在 root 渲染树内';
  }
  return null;
}

function collectReachableIds(components: Component[]): Set<string> {
  const byId = new Map(components.map((component) => [component.id, component]));
  const root = byId.get('root');
  const reachable = new Set<string>();
  if (!root) return reachable;

  const pending = [root.id];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (reachable.has(id)) continue;
    const component = byId.get(id);
    if (!component) continue;
    reachable.add(id);
    if (Array.isArray(component.children)) pending.push(...component.children);
    if (typeof component.child === 'string') pending.push(component.child);
    if (Array.isArray(component.tabs)) {
      for (const tab of component.tabs) {
        if (typeof tab?.child === 'string') pending.push(tab.child);
      }
    }
  }
  return reachable;
}

function validateWorkbenchContract(components: Component[]): string | null {
  const byId = new Map(components.map((component) => [component.id, component]));
  const root = byId.get('root');
  if (!root || root.component !== 'Column') return 'Workbench root 必须是 Column';

  const customer = byId.get('customer');
  if (!customer || customer.component !== 'CustomerSummary') {
    return 'Workbench UI 必须包含 id 为 customer 的 CustomerSummary';
  }
  const taskTitle = byId.get('taskTitle');
  if (
    !taskTitle ||
    taskTitle.component !== 'TextField' ||
    getDataBindingPath(taskTitle.value) !== '/taskTitle'
  ) {
    return 'Workbench UI 的 taskTitle 必须是绑定 /taskTitle 的 TextField';
  }
  const reminderAt = byId.get('reminderAt');
  if (
    !reminderAt ||
    reminderAt.component !== 'DateTimeInput' ||
    getDataBindingPath(reminderAt.value) !== '/reminderAt' ||
    reminderAt.enableDate !== true ||
    reminderAt.enableTime !== true
  ) {
    return 'Workbench UI 的 reminderAt 必须是同时启用日期和时间的 DateTimeInput';
  }
  const priority = byId.get('priority');
  if (
    !priority ||
    priority.component !== 'ChoicePicker' ||
    getDataBindingPath(priority.value) !== '/priority' ||
    priority.variant !== 'mutuallyExclusive'
  ) {
    return 'Workbench UI 的 priority 必须是绑定 /priority 的单选 ChoicePicker';
  }
  const priorityValues = getChoiceOptionValues(priority);
  if (
    priorityValues.length !== 3 ||
    !priorityValues.includes('high') ||
    !priorityValues.includes('normal') ||
    !priorityValues.includes('low')
  ) {
    return 'Workbench priority 必须提供 high/normal/low 三个选项';
  }
  const submitButton = byId.get('submitButton');
  if (
    !submitButton ||
    submitButton.component !== 'Button' ||
    submitButton.child !== 'submitLabel' ||
    submitButton.action?.event?.name !== 'submit'
  ) {
    return 'Workbench UI 必须包含 child 为 submitLabel 且 action 为 submit 的 Button';
  }
  const submitLabel = byId.get('submitLabel');
  const submitResult = byId.get('submitResult');
  if (
    !submitLabel ||
    submitLabel.component !== 'Text' ||
    getDataBindingPath(submitLabel.text) !== '/actionLabel' ||
    !submitResult ||
    submitResult.component !== 'Text' ||
    getDataBindingPath(submitResult.text) !== '/result'
  ) {
    return 'Workbench UI 必须包含 submitLabel 和 submitResult';
  }

  const context = submitButton.action?.event?.context ?? {};
  const contextPaths = new Set(
    Object.values(context)
      .map((value) => getDataBindingPath(value))
      .filter((path): path is string => path !== null),
  );
  if (
    !contextPaths.has('/taskTitle') ||
    !contextPaths.has('/reminderAt') ||
    !contextPaths.has('/priority') ||
    !contextPaths.has('/customer/customerId')
  ) {
    return 'Workbench submit context 必须绑定 /taskTitle、/reminderAt、/priority 和 /customer/customerId';
  }

  const reachableIds = collectReachableIds(components);
  const requiredIds = [
    'customer',
    'taskTitle',
    'priority',
    'reminderAt',
    'submitButton',
    'submitResult',
  ];
  if (!requiredIds.every((id) => reachableIds.has(id))) {
    return 'Workbench UI 的关键组件必须挂在 root 渲染树内';
  }
  return null;
}

export interface AgentStreamState {
  componentsById: Map<string, Component>;
  dataModel: unknown;
  hasRoot: boolean;
  hasBasicImage: boolean;
}

export interface AgentStreamValidationIssue {
  readonly message: string;
  readonly diagnostics?: readonly ComponentSchemaDiagnostic[];
}

export function createAgentStreamState(): AgentStreamState {
  return {
    componentsById: new Map(),
    dataModel: undefined,
    hasRoot: false,
    hasBasicImage: false,
  };
}

function collectCatalogDiagnostics(
  components: Iterable<Component>,
  dataModel: unknown,
  sequence: AgentSequenceOptions,
): ComponentSchemaDiagnostic[] {
  const registry = sequence.registry ?? agentCatalogRegistry;
  const catalogId = sequence.catalogId ?? BASIC_CATALOG;
  const diagnostics: ComponentSchemaDiagnostic[] = [];

  for (const component of components) {
    diagnostics.push(...registry.getComponentDiagnostics(catalogId, component, dataModel));
  }
  return diagnostics;
}

function formatDiagnostics(diagnostics: readonly ComponentSchemaDiagnostic[]): string {
  return diagnostics.map((diagnostic) => diagnostic.message).join('; ');
}

function createIssue(
  message: string,
  diagnostics: readonly ComponentSchemaDiagnostic[] = [],
): AgentStreamValidationIssue {
  return diagnostics.length > 0 ? { message, diagnostics } : { message };
}

/**
 * Validate cross-message bindings while preserving A2UI streaming semantics.
 * A text component and its URL value can arrive in different messages.
 */
export function validateAgentStreamMessageDetailed(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): AgentStreamValidationIssue | null {
  const sequenceError = validateAgentSequence(message, index, sequence);

  if ('updateComponents' in message) {
    const nextComponents = new Map(state.componentsById);
    for (const component of message.updateComponents.components) {
      nextComponents.set(component.id, component);
    }
    const components = [...nextComponents.values()];

    const catalogDiagnostics = collectCatalogDiagnostics(components, state.dataModel, sequence);
    if (sequenceError) return createIssue(sequenceError, catalogDiagnostics);
    if (catalogDiagnostics.length > 0) {
      return {
        message: formatDiagnostics(catalogDiagnostics),
        diagnostics: catalogDiagnostics,
      };
    }

    for (const component of components) {
      const textError = validateDynamicText(component, state.dataModel);
      if (textError) return createIssue(textError);
    }

    const requestHasImageUrl =
      (sequence.catalogId ?? BASIC_CATALOG) === BASIC_CATALOG &&
      typeof sequence.message === 'string' &&
      /https?:\/\//i.test(sequence.message);
    const hasRoot = state.hasRoot || components.some((component) => component.id === 'root');
    const hasBasicImage =
      state.hasBasicImage || components.some((component) => component.component === 'Image');
    if (requestHasImageUrl && hasRoot && !hasBasicImage) {
      return createIssue('包含图片 URL 的生成流必须包含 Basic Catalog Image 组件');
    }

    state.componentsById = nextComponents;
    state.hasRoot = hasRoot;
    state.hasBasicImage = hasBasicImage;
    return null;
  }

  if ('updateDataModel' in message) {
    const nextDataModel = applyDataModelUpdate(state.dataModel, message.updateDataModel);
    const catalogDiagnostics = collectCatalogDiagnostics(
      state.componentsById.values(),
      nextDataModel,
      sequence,
    );
    if (sequenceError) return createIssue(sequenceError, catalogDiagnostics);
    if (catalogDiagnostics.length > 0) {
      return {
        message: formatDiagnostics(catalogDiagnostics),
        diagnostics: catalogDiagnostics,
      };
    }

    for (const component of state.componentsById.values()) {
      const textError = validateDynamicText(component, nextDataModel);
      if (textError) return createIssue(textError);
    }
    state.dataModel = nextDataModel;
  }

  if (sequenceError) return createIssue(sequenceError);
  return null;
}

/** Backward-compatible string guard; detailed callers receive diagnostics. */
export function validateAgentStreamMessage(
  message: A2UIMessage,
  index: number,
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): string | null {
  return validateAgentStreamMessageDetailed(message, index, sequence, state)?.message ?? null;
}

export function validateAgentStreamFinal(
  sequence: AgentSequenceOptions,
  state: AgentStreamState,
): string | null {
  if (sequence.kind !== 'generate' || !state.hasRoot) return null;
  const components = [...state.componentsById.values()];
  if ((sequence.catalogId ?? BASIC_CATALOG) === WORKBENCH_CATALOG) {
    return validateWorkbenchContract(components);
  }
  if (isSearchRequest(sequence.message)) {
    return validateSearchContract(components);
  }
  if (isFormRequest(sequence.message) && (sequence.catalogId ?? BASIC_CATALOG) === BASIC_CATALOG) {
    return validateSubmitContract(components);
  }
  return null;
}
