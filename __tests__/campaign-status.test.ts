import { describe, expect, it } from 'vitest';
import {
  campaignStatusLabel,
  campaignStatusTone,
} from '../lib/campaigns/status';

/**
 * §10.3 — campaign status label and tone mapping.
 *
 * `campaignStatusLabel` is a pure function that humanises an underscored slug.
 * `campaignStatusTone` is a constant mapping every status to its chip tone.
 */

describe('campaignStatusLabel', () => {
  it('replaces underscores with spaces', () => {
    expect(campaignStatusLabel('in_progress')).toBe('in progress');
  });

  it('returns single-word statuses unchanged', () => {
    expect(campaignStatusLabel('draft')).toBe('draft');
    expect(campaignStatusLabel('funded')).toBe('funded');
    expect(campaignStatusLabel('cancelled')).toBe('cancelled');
  });

  it('handles multiple underscores', () => {
    expect(campaignStatusLabel('some_long_status')).toBe('some long status');
  });

  it('returns empty string for empty input', () => {
    expect(campaignStatusLabel('')).toBe('');
  });
});

describe('campaignStatusTone', () => {
  it('has a tone for every known status', () => {
    expect(campaignStatusTone.draft).toBe('gray');
    expect(campaignStatusTone.confirmed).toBe('amber');
    expect(campaignStatusTone.funded).toBe('teal');
    expect(campaignStatusTone.in_progress).toBe('teal');
    expect(campaignStatusTone.completed).toBe('success');
    expect(campaignStatusTone.cancelled).toBe('gray');
  });

  it('uses teal for funded and in_progress', () => {
    expect(campaignStatusTone.funded).toBe('teal');
    expect(campaignStatusTone.in_progress).toBe('teal');
  });

  it('uses amber for confirmed (awaiting action)', () => {
    expect(campaignStatusTone.confirmed).toBe('amber');
  });
});
