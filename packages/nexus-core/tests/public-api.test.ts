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
      'NEXUS_SESSION_VERSION',
      'PROTOCOL_VERSION',
      'VERSION',
      'applyDataModelUpdate',
      'buildActionEvent',
      'buildTree',
      'compileSafeRegExp',
      'createCatalogPromptContract',
      'createCoreStore',
      'getByPath',
      'isA2UIMessage',
      'isSafeMediaUrl',
      'removeAtPath',
      'resolveContext',
      'resolveDynamic',
      'setValueAtPath',
      'standardCatalogComponentDeclarations',
      'toDisplayString',
      'validateA2UIMessage',
      'validateComponentPolicyDiagnostics',
      'validateComponentProps',
      'validateComponentPropsDiagnostics',
      'validateComponentSchema',
      'validateInputValueSchema',
      'validateNexusProfileMessage',
      'validateProtocolMessage',
    ]);
  });

  it('marks the current root API and protocol contract', () => {
    assert.equal(publicApi.CORE_API_VERSION, 1);
    assert.equal(publicApi.PROTOCOL_VERSION, 'v0.9');
    assert.equal(publicApi.VERSION, '0.1.0');
  });
});
