/**
 * @nexus-ui/core/catalog/standard —— 标准组件的 SDK 声明。
 *
 * 17 个标准组件的字段、checks、可写输入与 action 要求使用与宿主 Catalog
 * 完全相同的声明机制（CatalogComponentDeclaration）；validator 的按名分支
 * 只保留协议/安全基线，不在此重复组件语义。schema 语义来自 Nexus Basic
 * Task Profile 的既有契约（含 `dynamic` 绑定策略）；无 props 约束的结构
 * 组件使用开放 schema，保持与既有 Profile 一致的宽容度。
 */
import type { CatalogChecksPolicy, CatalogComponentDeclaration } from './schema';

const basicChecks: CatalogChecksPolicy = {
  enabled: true,
  functions: ['required', 'regex', 'length', 'numeric', 'email'],
  maxRules: 8,
  maxMessageLength: 200,
  maxPatternLength: 256,
};

const declarations: Readonly<Record<string, CatalogComponentDeclaration>> = {
  Text: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', dynamic: 'allowed' },
        variant: { type: 'string', enum: ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'] },
      },
    },
    fields: {
      text: { origin: 'official-basic' },
      variant: { origin: 'official-basic' },
    },
    origin: 'official-basic',
  },
  Image: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', dynamic: 'allowed' },
        description: { type: 'string', dynamic: 'allowed' },
        fit: { type: 'string', enum: ['cover', 'contain'] },
        variant: { type: 'string', enum: ['avatar'] },
      },
    },
    fields: {
      url: { origin: 'official-basic' },
      description: { origin: 'official-basic' },
      fit: { origin: 'official-basic' },
      variant: { origin: 'official-basic' },
    },
    origin: 'official-basic',
  },
  Icon: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Row: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Column: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  List: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Card: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Tabs: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Divider: {
    schema: { type: 'object' },
    origin: 'official-basic',
  },
  Button: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        variant: { type: 'string', enum: ['default', 'primary', 'borderless'] },
        disabled: { type: 'boolean', dynamic: 'forbidden' },
      },
    },
    fields: { child: { componentRef: true, origin: 'official-basic' } },
    checks: basicChecks,
    origin: 'nexus-extension',
  },
  TextField: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        value: { type: 'string', dynamic: 'required' },
        variant: { type: 'string', enum: ['longText', 'number', 'shortText', 'obscured'] },
        validationRegexp: { type: 'string', maxLength: 256 },
      },
    },
    fields: {
      label: { origin: 'official-basic' },
      value: { origin: 'official-basic' },
      variant: { origin: 'official-basic' },
      validationRegexp: { origin: 'official-basic' },
    },
    inputs: { value: { type: 'string' } },
    checks: basicChecks,
    origin: 'official-basic',
  },
  CheckBox: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        value: { type: 'boolean', dynamic: 'required' },
      },
    },
    fields: {
      label: { origin: 'official-basic' },
      value: { origin: 'official-basic' },
    },
    inputs: { value: { type: 'boolean' } },
    origin: 'official-basic',
  },
  ChoicePicker: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        variant: { type: 'string', enum: ['multipleSelection', 'mutuallyExclusive'] },
        options: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', dynamic: 'allowed' },
              value: { type: 'string', minLength: 1 },
            },
          },
        },
        value: { type: 'array', dynamic: 'required' },
        displayStyle: { type: 'string', enum: ['checkbox', 'chips'] },
        filterable: { type: 'boolean' },
      },
    },
    fields: {
      label: { origin: 'official-basic' },
      variant: { origin: 'official-basic' },
      options: { origin: 'official-basic' },
      value: { origin: 'official-basic' },
      displayStyle: { origin: 'official-basic' },
      filterable: { origin: 'official-basic' },
    },
    inputs: { value: { type: 'array', minItems: 1, items: { type: 'string' } } },
    origin: 'official-basic',
  },
  DateTimeInput: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        value: { type: 'string', dynamic: 'required' },
        enableDate: { type: 'boolean' },
        enableTime: { type: 'boolean' },
        min: { type: 'string', dynamic: 'allowed' },
        max: { type: 'string', dynamic: 'allowed' },
      },
    },
    fields: {
      label: { origin: 'official-basic' },
      value: { origin: 'official-basic' },
      enableDate: { origin: 'official-basic' },
      enableTime: { origin: 'official-basic' },
      min: { origin: 'official-basic' },
      max: { origin: 'official-basic' },
    },
    inputs: { value: { type: 'string' } },
    origin: 'official-basic',
  },
  Slider: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string', dynamic: 'allowed' },
        min: { type: 'number', dynamic: 'forbidden' },
        max: { type: 'number', dynamic: 'forbidden' },
        value: { type: 'number', dynamic: 'required' },
      },
    },
    fields: {
      label: { origin: 'official-basic' },
      min: { origin: 'official-basic' },
      max: { origin: 'official-basic' },
      value: { origin: 'official-basic' },
    },
    inputs: { value: { type: 'number' } },
    checks: basicChecks,
    origin: 'official-basic',
  },
  Video: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string', dynamic: 'allowed' } },
    },
    fields: { url: { origin: 'official-basic' } },
    origin: 'official-basic',
  },
  AudioPlayer: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', dynamic: 'allowed' },
        description: { type: 'string', dynamic: 'allowed' },
      },
    },
    fields: {
      url: { origin: 'official-basic' },
      description: { origin: 'official-basic' },
    },
    origin: 'official-basic',
  },
};

/**
 * 返回 17 个标准组件的 SDK 声明深拷贝。宿主在 Catalog 中按名组合，
 * 也可对个别标准组件覆盖字段元数据（schema 覆盖须保持类型兼容）；
 * 各次调用互不共享嵌套对象，宿主修改返回值不影响 SDK 与后续调用。
 */
export function standardCatalogComponentDeclarations(): Readonly<
  Record<string, CatalogComponentDeclaration>
> {
  return structuredClone(declarations) as Readonly<Record<string, CatalogComponentDeclaration>>;
}
