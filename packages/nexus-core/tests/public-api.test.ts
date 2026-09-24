import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import * as publicApi from '../src/index';

describe('core public API surface', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'A2UIRuntime',
      'CORE_API_VERSION',
      'CatalogRegistry',
      'JSONLBuffer',
      'PROTOCOL_VERSION',
      'VERSION',
      'applyDataModelUpdate',
      'buildActionEvent',
      'buildTree',
      'createCatalogPromptContract',
      'createCoreStore',
      'getByPath',
      'isA2UIMessage',
      'removeAtPath',
      'resolveContext',
      'resolveDynamic',
      'setValueAtPath',
      'toDisplayString',
      'validateA2UIMessage',
      'validateComponentProps',
      'validateComponentPropsDiagnostics',
      'validateComponentSchema',
    ]);
  });

  it('marks the current root API and protocol contract', () => {
    assert.equal(publicApi.CORE_API_VERSION, 1);
    assert.equal(publicApi.PROTOCOL_VERSION, 'v0.9');
    assert.equal(publicApi.VERSION, '0.1.0');
  });
});
