import { describe, expect, it } from 'vitest';
import { cn } from '../lib/utils';

/**
 * KAN-58 — `cn` is the one shared classname combinator in `lib/`, and it was
 * the only pure helper with no tests (0% coverage dragged the gate). It is
 * trivial, but it is also the seam every component uses to merge conditional
 * classes, so a regression there misrenders the whole app.
 */
describe('cn', () => {
  it('joins truthy strings with a space', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values instead of rendering them', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('accepts objects and keeps only the truthy keys', () => {
    expect(cn({ on: true, off: false, 'also-on': 1, nope: 0 })).toBe(
      'on also-on'
    );
  });

  it('accepts arrays and flattens them', () => {
    expect(cn(['a', ['b', 'c'], false])).toBe('a b c');
  });

  it('lets tailwind-merge resolve conflicts in favour of the later class', () => {
    // `p-2` and `p-4` are the same utility group; the last one wins.
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});
