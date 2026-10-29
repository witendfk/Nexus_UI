import assert from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/index';

describe('React public API surface', () => {
  it('exports only the documented root-entry contract', () => {
    assert.deepEqual(Object.keys(publicApi).sort(), [
      'A2UIPreview',
      'A2UIProvider',
      'A2UISurface',
      'AudioPlayer',
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
      'Slider',
      'Tabs',
      'Text',
      'TextField',
      'Video',
      'getReactCoreCompatibility',
      'injectNexusStyle',
      'standardRenderMap',
      'useA2UI',
      'useA2UIContext',
    ]);
  });

  it('reports the supported core range', () => {
    const compatibility = publicApi.getReactCoreCompatibility();

    assert.equal(compatibility.compatible, true);
    assert.equal(compatibility.reactApiVersion, 2);
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
      'AudioPlayer',
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
      'Slider',
      'Tabs',
      'Text',
      'TextField',
      'Video',
    ]);
  });
});
