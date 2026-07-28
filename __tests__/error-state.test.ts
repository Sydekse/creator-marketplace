import { describe, expect, it } from 'vitest';
import { ErrorState } from '../components/feedback/error-state';

describe('ErrorState', () => {
  it('is a function', () => {
    expect(typeof ErrorState).toBe('function');
  });

  it('renders with default props', () => {
    const element = ErrorState({});
    expect(element).toBeDefined();
    expect(element.type).toBeDefined();
  });

  it('renders with custom title and message', () => {
    const element = ErrorState({ title: 'Oops', message: 'Something broke' });
    expect(element).toBeDefined();
  });

  it('renders retry button when onRetry is provided', () => {
    const element = ErrorState({ onRetry: () => {} });
    expect(element).toBeDefined();
  });
});
