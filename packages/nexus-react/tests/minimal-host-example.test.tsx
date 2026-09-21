import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ActionEvent } from '@nexus-ui/core';
import { MinimalA2UIHost } from '../examples/minimal-host';

afterEach(cleanup);

describe('minimal host example', () => {
  it('renders a custom catalog from the public React API', () => {
    render(<MinimalA2UIHost />);

    expect(screen.getByText('Marketing campaign approval')).to.exist;
    expect(screen.getByText('USD 12,000')).to.exist;
    expect(screen.getByRole('button', { name: 'Approve' })).to.exist;
  });

  it('returns the latest resolved action context to the host', () => {
    const events: ActionEvent[] = [];
    render(<MinimalA2UIHost onAction={(event) => events.push(event)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(events).to.have.length(1);
    expect(events[0]).to.deep.equal({
      name: 'approve',
      surfaceId: 'approval-001',
      sourceComponentId: 'approve',
      context: { approvalId: 'approval-001', amount: 'USD 12,000' },
    });
  });
});
