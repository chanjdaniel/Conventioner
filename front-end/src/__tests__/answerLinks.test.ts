import { describe, expect, it } from 'vitest';
import { answerSegments } from '@/utils/answerLinks';

describe('an answer names its web addresses', () => {
  it('makes a whole-answer address a link', () => {
    expect(answerSegments('https://shop.example/portfolio')).toEqual([
      { text: 'https://shop.example/portfolio', href: 'https://shop.example/portfolio' },
    ]);
  });

  it('keeps the words around an address as words', () => {
    expect(answerSegments('Etsy: https://shop.example and in person')).toEqual([
      { text: 'Etsy: ' },
      { text: 'https://shop.example', href: 'https://shop.example/' },
      { text: ' and in person' },
    ]);
  });

  it('splits a list of uploads into one link each', () => {
    const segments = answerSegments('https://a.example/1, https://a.example/2');
    expect(segments.filter((s) => s.href).map((s) => s.text)).toEqual([
      'https://a.example/1',
      'https://a.example/2',
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('https://a.example/1, https://a.example/2');
  });

  it('leaves the punctuation that ends a sentence outside the link', () => {
    expect(answerSegments('See https://shop.example/a.').map((s) => s.text)).toEqual([
      'See ',
      'https://shop.example/a',
      '.',
    ]);
    expect(answerSegments('(https://shop.example/a)').map((s) => s.text)).toEqual([
      '(',
      'https://shop.example/a',
      ')',
    ]);
    expect(answerSegments('https://en.example/Wiki_(art)')[0].text).toBe(
      'https://en.example/Wiki_(art)',
    );
  });

  it('never links anything but http and https', () => {
    for (const answer of ['javascript:alert(1)', 'data:text/html,hi', 'shop.example', '@handle']) {
      expect(answerSegments(answer).some((s) => s.href)).toBe(false);
    }
  });

  it('says nothing about an empty answer', () => {
    expect(answerSegments('')).toEqual([]);
  });
});
