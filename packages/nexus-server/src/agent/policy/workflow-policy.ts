import type { Component } from '@nexus-ui/core';
import { NEXUS_BASIC_TASK_CATALOG, WORKBENCH_CATALOG } from '../catalog';
import { getDataBindingPath } from './component-policy';

function isSearchRequest(message?: string): boolean {
  return typeof message === 'string' && /搜索|search/i.test(message);
}

function isFormRequest(message?: string): boolean {
  return typeof message === 'string' && /表单|form|订阅|subscribe/i.test(message);
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

export interface WorkflowPolicyInput {
  catalogId: string;
  message?: string;
}

/** Final-surface workflow ownership; media safety is evaluated incrementally. */
export function validateWorkflowPolicy(
  input: WorkflowPolicyInput,
  components: Component[],
): string | null {
  if (input.catalogId === WORKBENCH_CATALOG) {
    return validateWorkbenchContract(components);
  }
  if (isSearchRequest(input.message)) {
    return validateSearchContract(components);
  }
  if (isFormRequest(input.message) && input.catalogId === NEXUS_BASIC_TASK_CATALOG) {
    return validateSubmitContract(components);
  }
  return null;
}
