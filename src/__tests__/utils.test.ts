/**
 * Utility Function Tests
 *
 * Unit tests for utility functions.
 * Run with: bun test
 */

import { describe, it, expect } from 'bun:test';
import {
  generateMetaDescription,
  formatDate,
  generateFAQSchema,
  generateBreadcrumbSchema,
  generateArticleSchema,
  slugify,
} from '../lib/utils';

describe('generateMetaDescription', () => {
  it('should truncate long text to 160 characters', () => {
    const longText = 'a'.repeat(200);
    const result = generateMetaDescription(longText);
    expect(result.length).toBeLessThanOrEqual(160);
  });

  it('should add ellipsis when truncating', () => {
    const longText = 'a'.repeat(200);
    const result = generateMetaDescription(longText);
    expect(result.endsWith('...')).toBe(true);
  });

  it('should not modify short text', () => {
    const shortText = 'This is a short description.';
    const result = generateMetaDescription(shortText);
    expect(result).toBe(shortText);
  });

  it('should strip HTML tags', () => {
    const htmlText = '<p>This is <strong>bold</strong> text.</p>';
    const result = generateMetaDescription(htmlText);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});

describe('formatDate', () => {
  it('should format ISO date string', () => {
    const date = '2024-01-15T10:30:00Z';
    const result = formatDate(date);
    expect(result).toContain('2024');
  });

  it('should handle invalid dates gracefully', () => {
    const result = formatDate('invalid-date');
    expect(result).toBeTruthy();
  });
});

describe('generateFAQSchema', () => {
  it('should generate valid FAQ schema', () => {
    const faqs = [
      { question: 'What is a proxy?', answer: 'A proxy is an intermediary server.' },
    ];
    const schema = generateFAQSchema(faqs);

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toHaveLength(1);
    expect(schema.mainEntity[0]['@type']).toBe('Question');
  });

  it('should handle multiple FAQs', () => {
    const faqs = [
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
      { question: 'Q3', answer: 'A3' },
    ];
    const schema = generateFAQSchema(faqs);

    expect(schema.mainEntity).toHaveLength(3);
  });
});

describe('generateBreadcrumbSchema', () => {
  it('should generate valid breadcrumb schema', () => {
    const items = [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Category', url: 'https://example.com/category' },
    ];
    const schema = generateBreadcrumbSchema(items);

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('BreadcrumbList');
    expect(schema.itemListElement).toHaveLength(2);
  });

  it('should set correct positions', () => {
    const items = [
      { name: 'Home', url: 'https://example.com' },
      { name: 'Category', url: 'https://example.com/category' },
      { name: 'Item', url: 'https://example.com/category/item' },
    ];
    const schema = generateBreadcrumbSchema(items);

    expect(schema.itemListElement[0].position).toBe(1);
    expect(schema.itemListElement[1].position).toBe(2);
    expect(schema.itemListElement[2].position).toBe(3);
  });
});

describe('generateArticleSchema', () => {
  it('should generate valid article schema', () => {
    const article = {
      title: 'Test Article',
      description: 'Test description',
      url: 'https://example.com/article',
      datePublished: '2024-01-01',
      dateModified: '2024-01-15',
    };
    const schema = generateArticleSchema(article);

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('Article');
    expect(schema.headline).toBe('Test Article');
  });
});

describe('slugify', () => {
  it('should convert text to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugify('hello world test')).toBe('hello-world-test');
  });

  it('should remove special characters', () => {
    expect(slugify('hello@world!')).toBe('helloworld');
  });

  it('should handle multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });
});
