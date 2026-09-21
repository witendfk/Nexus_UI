import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index';

describe('React public API surface', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'A2UIProvider',
      'Button',
      'CORE_VERSION',
      'Card',
      'CheckBox',
      'ChoicePicker',
      'Column',
      'DateTimeInput',
      'Divider',
      'Icon',
      'Image',
      'List',
      'PROTOCOL_VERSION',
      'REACT_API_VERSION',
      'REACT_RENDERER_VERSION',
      'ReactRenderer',
      'Row',
      'SUPPORTED_CORE_API_VERSION',
      'SUPPORTED_CORE_VERSION_RANGE',
      'Tabs',
      'Text',
      'TextField',
      'getReactCoreCompatibility',
      'standardRenderMap',
      'useA2UI',
    ]);
  });

  it('reports the supported core range', () => {
    const compatibility = publicApi.getReactCoreCompatibility();

    assert.equal(compatibility.compatible, true);
    assert.equal(compatibility.coreVersion, publicApi.CORE_VERSION);
    assert.equal(compatibility.coreApiVersion, publicApi.SUPPORTED_CORE_API_VERSION);
    assert.equal(compatibility.supportedCoreVersionRange, '0.1.x');
  });

  it('rejects a core version outside the supported range', () => {
    expect(publicApi.getReactCoreCompatibility('0.2.0').compatible).toBe(false);
    expect(publicApi.getReactCoreCompatibility('0.1.3', 1).compatible).toBe(true);
  });

  it('maps every standard Basic Catalog component in the current MVP subset', () => {
    assert.deepEqual(Object.keys(publicApi.standardRenderMap).sort(), [
      'Button',
      'Card',
      'CheckBox',
      'ChoicePicker',
      'Column',
      'DateTimeInput',
      'Divider',
      'Icon',
      'Image',
      'List',
      'Row',
      'Tabs',
      'Text',
      'TextField',
    ]);
  });
});
