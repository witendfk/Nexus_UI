import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'mocha';
import { validateNexusProfileMessage, validateProtocolMessage } from '../src/protocol/validator';

const examplesDirectory = '../../../specification/v0_9/json/catalogs/basic/examples';

describe('official Basic Catalog compatibility boundary', () => {
  const files = readdirSync(new URL(examplesDirectory, import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .sort();

  it('classifies every official example at the protocol and profile layers', () => {
    assert.equal(files.length, 33);

    const result = files.map((file) => {
      const example = JSON.parse(
        readFileSync(new URL(`${examplesDirectory}/${file}`, import.meta.url), 'utf8'),
      ) as { messages: unknown[] };
      return {
        file,
        protocolValid: example.messages.every((message) => validateProtocolMessage(message).ok),
        profileSupported: example.messages.every(
          (message) => validateNexusProfileMessage(message) === null,
        ),
      };
    });

    assert.deepEqual(
      result.filter((item) => item.protocolValid).length,
      files.length,
      'every official fixture must be protocol-valid even when unsupported',
    );
    assert.equal(
      result.some((item) => !item.profileSupported),
      true,
    );
  });
});
