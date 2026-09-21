import { CORE_API_VERSION, PROTOCOL_VERSION, VERSION as CORE_VERSION } from '@nexus-ui/core';

export const REACT_RENDERER_VERSION = '0.1.0';
export const REACT_API_VERSION = 1;
export const SUPPORTED_CORE_API_VERSION = 1;
export const SUPPORTED_CORE_VERSION_RANGE = '0.1.x';

export interface ReactCoreCompatibility {
  compatible: boolean;
  coreVersion: string;
  rendererVersion: string;
  protocolVersion: string;
  coreApiVersion: number;
  reactApiVersion: number;
  supportedCoreVersionRange: string;
}

function isSupportedCoreVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (!match) return false;
  return match[1] === '0' && match[2] === '1';
}

export function getReactCoreCompatibility(
  coreVersion: string = CORE_VERSION,
  coreApiVersion: number = CORE_API_VERSION,
): ReactCoreCompatibility {
  return {
    compatible:
      coreApiVersion === SUPPORTED_CORE_API_VERSION &&
      isSupportedCoreVersion(coreVersion) &&
      PROTOCOL_VERSION === 'v0.9',
    coreVersion,
    rendererVersion: REACT_RENDERER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    coreApiVersion,
    reactApiVersion: REACT_API_VERSION,
    supportedCoreVersionRange: SUPPORTED_CORE_VERSION_RANGE,
  };
}

export { CORE_VERSION, PROTOCOL_VERSION };
