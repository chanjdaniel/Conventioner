// @vitest-environment happy-dom
/**
 * The sign-in code's one field, which both sign-ins use (T191 F21).
 *
 * How its digits sit on the box is measured in a real browser (`e2e/the-code-field.spec.ts`);
 * this holds what a caller relies on: what it passes through, and what the field asks of a phone.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';

import CodeInput from '@/components/CodeInput.vue';

describe('the code field', () => {
  it("keeps the caller's id, test id and rules on the input itself", () => {
    const wrapper = mount(CodeInput, {
      props: { modelValue: '' },
      attrs: {
        id: 'otp-code',
        'data-testid': 'login-otp-code-input',
        required: '',
        pattern: '[0-9]{6}',
      },
    });

    const input = wrapper.get('input');
    expect(input.attributes('id')).toBe('otp-code');
    expect(input.attributes('data-testid')).toBe('login-otp-code-input');
    expect(input.attributes('required')).toBeDefined();
    expect(input.attributes('pattern')).toBe('[0-9]{6}');
  });

  it('asks a phone for a one-time code of six figures, and shows six as its placeholder', () => {
    const input = mount(CodeInput, { props: { modelValue: '' } }).get('input');

    expect(input.attributes('autocomplete')).toBe('one-time-code');
    expect(input.attributes('inputmode')).toBe('numeric');
    expect(input.attributes('maxlength')).toBe('6');
    expect(input.attributes('placeholder')).toBe('000000');
  });

  it('is two-way bound, and focusable by its caller', async () => {
    const code = ref('12');
    const field = ref<InstanceType<typeof CodeInput> | null>(null);
    const Host = defineComponent(
      () => () =>
        h(CodeInput, {
          ref: field,
          modelValue: code.value,
          'onUpdate:modelValue': (value: string) => (code.value = value),
        }),
    );
    const wrapper = mount(Host, { attachTo: document.body });

    await wrapper.get('input').setValue('123456');
    field.value?.focus();

    expect(code.value).toBe('123456');
    expect(document.activeElement).toBe(wrapper.get('input').element);
    wrapper.unmount();
  });
});
