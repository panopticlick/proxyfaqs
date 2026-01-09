import { describe, expect, it } from 'bun:test';
import { buildTsQuery, normalizeSearchQuery } from './search';

describe('search helpers', () => {
  it('normalizes and trims query', () => {
    expect(normalizeSearchQuery('  Residential   Proxy!! ')).toBe('residential proxy');
  });

  it('limits term count', () => {
    const query = 'one two three four five six seven eight nine';
    expect(normalizeSearchQuery(query)).toBe('one two three four five six seven eight');
  });

  it('builds tsquery with & separators', () => {
    expect(buildTsQuery('proxy scraping')).toBe('proxy & scraping');
  });
});
