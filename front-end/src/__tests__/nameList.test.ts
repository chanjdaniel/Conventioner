import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import NameList from '@/components/NameList.vue';

const NAMES = [
  'Ana',
  'Ben',
  'Cai',
  'Dee',
  'Eli',
  'Fay',
  'Gus',
  'Hal',
  'Ivy',
  'Jon',
  'Kit',
  'Lou',
] as const;
const NOUN = { one: 'reviewer', many: 'reviewers' };

function mountLine(count: number, named?: number) {
  return mount(NameList, {
    props: { names: NAMES.slice(0, count), noun: NOUN, testid: 'line', named },
  });
}

/** The sentence as a reader hears it: the element's text, its white space collapsed. */
const sentence = (wrapper: ReturnType<typeof mountLine>) =>
  wrapper.get('[data-testid="line"]').element.textContent?.replace(/\s+/g, ' ').trim();
const more = (wrapper: ReturnType<typeof mountLine>) => wrapper.find('[data-testid="line-more"]');

describe('the line', () => {
  it.each([
    [0, 'No reviewers'],
    [1, '1 reviewer: Ana'],
    [2, '2 reviewers: Ana and Ben'],
    [3, '3 reviewers: Ana, Ben and Cai'],
    [4, '4 reviewers: Ana, Ben, Cai and 1 more reviewer'],
    [12, '12 reviewers: Ana, Ben, Cai and 9 more reviewers'],
  ])('reads %i names as one sentence', (count, words) => {
    expect(sentence(mountLine(count))).toBe(words);
  });

  it('is one paragraph holding no list, so it is read as a sentence and not item by item', () => {
    const wrapper = mountLine(12);
    expect(wrapper.element.tagName).toBe('P');
    expect(wrapper.findAll('ul, ol, li')).toHaveLength(0);
  });

  it.each([0, 1, 3])('draws no button for %i names, since none is left unsaid', (count) => {
    expect(more(mountLine(count)).exists()).toBe(false);
  });

  it('names as many as it is told before the rest', () => {
    expect(sentence(mountLine(12, 5))).toBe(
      '12 reviewers: Ana, Ben, Cai, Dee, Eli and 7 more reviewers',
    );
    expect(sentence(mountLine(5, 5))).toBe('5 reviewers: Ana, Ben, Cai, Dee and Eli');
    expect(more(mountLine(5, 5)).exists()).toBe(false);
  });
});

describe('"and N more"', () => {
  it('is a plain button, never submitting a form it sits in', () => {
    const button = more(mountLine(12));
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.attributes('type')).toBe('button');
    expect(button.text()).toBe('and 9 more reviewers');
    expect(button.get('.visually-hidden').text()).toBe('reviewers');
  });

  it('emits more when pressed', async () => {
    const wrapper = mountLine(4);
    expect(wrapper.emitted('more')).toBeUndefined();
    await more(wrapper).trigger('click');
    expect(wrapper.emitted('more')).toHaveLength(1);
  });
});

describe('what a screen draws in the sentence', () => {
  const drawn = (count: number, slots: Record<string, unknown>) =>
    mount(NameList, {
      props: { names: NAMES.slice(0, count), noun: NOUN, testid: 'line' },
      slots: slots as never,
    });

  it('draws each name it names through the name slot, keeping the sentence', () => {
    const wrapper = drawn(12, {
      name: ({ text, index }: { text: string; index: number }) =>
        h('b', { 'data-testid': 'a-name' }, `${index + 1}. ${text}`),
    });
    expect(wrapper.findAll('[data-testid="a-name"]').map((b) => b.text())).toEqual([
      '1. Ana',
      '2. Ben',
      '3. Cai',
    ]);
    expect(sentence(wrapper)).toBe('12 reviewers: 1. Ana, 2. Ben, 3. Cai and 9 more reviewers');
  });

  it('with nothing folded, joins them as a sentence does', () => {
    const wrapper = drawn(3, { name: ({ text }: { text: string }) => h('b', text) });
    expect(wrapper.findAll('b')).toHaveLength(3);
    expect(sentence(wrapper)).toBe('3 reviewers: Ana, Ben and Cai');
  });

  it('ends the sentence with the end slot, after the button', () => {
    const wrapper = drawn(12, { end: () => h('i', 'and so on') });
    expect(sentence(wrapper)).toBe('12 reviewers: Ana, Ben, Cai and 9 more reviewersand so on');
    expect(wrapper.get('[data-testid="line-more"]').element.nextElementSibling?.tagName).toBe('I');
  });
});
