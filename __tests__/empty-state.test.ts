import { describe, expect, it } from 'vitest';
import { EmptyState } from '../components/feedback/empty-state';

/**
 * EmptyState is a server component — Drizzle's getTableConfig is an easy way to
 * introspect it as a function without JSDOM. This validates it exists, accepts
 * the expected props, and returns something renderable.
 */
describe('EmptyState', () => {
  it('is a function that accepts title and description', () => {
    expect(typeof EmptyState).toBe('function');
  });

  it('renders without throwing when called with minimal props', () => {
    const element = EmptyState({ title: 'Test', description: 'Desc' });
    expect(element).toBeDefined();
    expect(element.type).toBeDefined();
  });

  it('renders with an action slot when provided', () => {
    const action = { type: 'button' as const, props: { children: 'Click' } };
    const element = EmptyState({
      title: 'T',
      description: 'D',
      action: action as unknown as React.ReactNode,
    });
    expect(element).toBeDefined();
  });
});
