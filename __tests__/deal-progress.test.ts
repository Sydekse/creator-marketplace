import { describe, expect, it } from 'vitest';
import {
  DEAL_PROGRESS_SHORT_LABEL,
  DEAL_PROGRESS_STEPS,
  dealProgress,
  isBlockedDealStatus,
} from '../lib/deals/progress';

describe('dealProgress', () => {
  it('marks the current happy-path step and everything before it', () => {
    const nodes = dealProgress('funded', [
      { toStatus: 'pending' },
      { toStatus: 'accepted' },
      { toStatus: 'funded' },
    ]);

    expect(nodes.map((node) => node.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('treats a revision as still on the delivered step', () => {
    const nodes = dealProgress('revision_requested', [
      { toStatus: 'pending' },
      { toStatus: 'accepted' },
      { toStatus: 'funded' },
      { toStatus: 'delivered' },
      { toStatus: 'revision_requested' },
    ]);

    expect(nodes[3]).toEqual({ step: 'delivered', state: 'current' });
    expect(nodes[4].state).toBe('upcoming');
  });

  it('blocks the next step when the offer is declined', () => {
    const nodes = dealProgress('declined', [
      { toStatus: 'pending' },
      { toStatus: 'declined' },
    ]);

    expect(nodes[0].state).toBe('done');
    expect(nodes[1].state).toBe('blocked');
    expect(nodes.slice(2).every((node) => node.state === 'upcoming')).toBe(
      true
    );
  });

  it('covers every happy-path step', () => {
    expect(DEAL_PROGRESS_STEPS).toHaveLength(5);
    expect(isBlockedDealStatus('expired')).toBe(true);
    expect(isBlockedDealStatus('funded')).toBe(false);
    expect(Object.keys(DEAL_PROGRESS_SHORT_LABEL)).toEqual(
      expect.arrayContaining([...DEAL_PROGRESS_STEPS])
    );
  });
});
