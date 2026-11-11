// @vitest-environment happy-dom
/**
 * A write over a market that changed since the screen read it is refused, and stores nothing
 * (ADR 0024): the server answers one 409, `{"error": <the sentence>, "code": "market_changed"}`.
 * Every such answer re-reads the open market, so each screen reading the market store shows the
 * market as it now stands, and the screen that wrote says the server's sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, storeToRefs } from 'pinia';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import AutomaticRejections from '@/components/application/AutomaticRejections.vue';
import { api, isMarketChanged, MARKET_CHANGED_CODE, onMarketChanged } from '@/utils/api';
import { installMarketChanged, useMarketStore } from '@/stores/market';
import { useRejectionRules } from '@/utils/rejectionRules';

const SENTENCE =
  'This market changed while you were working on it, so your change was not saved. ' +
  'Reload to see the latest, then make your change again.';
const CHANGED = { error: SENTENCE, code: MARKET_CHANGED_CODE };

function failure(status: number | null, data?: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response =
    status === null ? undefined : { status, data, statusText: '', headers: {}, config };
  return new AxiosError('Request failed', undefined, config, {}, response as never);
}

describe('isMarketChanged', () => {
  it('is a 409 whose body says the market changed', () => {
    expect(isMarketChanged(failure(409, CHANGED))).toBe(true);
  });

  it.each([
    ['another 409', failure(409, { error: 'The form is locked.' })],
    ['a 409 with no body', failure(409)],
    ['another status carrying the code', failure(400, CHANGED)],
    ['no answer at all', failure(null)],
    ['something that is not a request', new Error('market_changed')],
  ])('is not %s', (_kind, err) => {
    expect(isMarketChanged(err)).toBe(false);
  });
});

/** The server: each request's answer by method and path, any other a 404. */
type Answer = { status: number; data?: unknown };
let answers: Record<string, Answer | (() => Promise<Answer>)>;
const asked: string[] = [];

function serve() {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const key = `${config.method?.toUpperCase()} ${config.url}`;
    asked.push(key);
    const found = answers[key];
    const { status, data } =
      typeof found === 'function' ? await found() : (found ?? { status: 404 });
    const response = { data, status, statusText: '', headers: {}, config };
    if (status < 400) return response;
    throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response);
  };
}

const QUESTIONS = [
  {
    key: 'no_shows',
    label: 'I understand that no-shows',
    answers: [
      { value: 'ticked', label: 'Ticked' },
      { value: 'not ticked', label: 'Not ticked' },
    ],
  },
];

function stored(fields: Record<string, unknown> = {}): Answer {
  return {
    status: 200,
    data: {
      market: {
        id: 'm-1',
        name: 'Fixture Market',
        creationDate: '2026-01-01T00:00:00Z',
        roles: {},
        modificationList: [],
        assignmentObject: { vendorAssignments: [] },
        phase: 'applications',
        rejectionQuestions: QUESTIONS,
        rejectionRules: [],
        ...fields,
      },
    },
  };
}

describe('onMarketChanged', () => {
  let remove: () => void;
  const handler = vi.fn();

  beforeEach(() => {
    handler.mockReset();
    remove = onMarketChanged(handler);
  });
  afterEach(() => remove());

  it('runs on a write the server refused because the market changed, and the write still fails', async () => {
    answers = { 'PUT /markets/m-1/name': { status: 409, data: CHANGED } };
    serve();

    await expect(api.put('/markets/m-1/name', { name: 'x' })).rejects.toSatisfy(isMarketChanged);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not run on another refusal, nor once removed', async () => {
    answers = {
      'PUT /markets/m-1/name': { status: 409, data: { error: 'Locked.' } },
      'PUT /markets/m-1/plan': { status: 409, data: CHANGED },
    };
    serve();

    await expect(api.put('/markets/m-1/name', {})).rejects.toThrow();
    remove();
    await expect(api.put('/markets/m-1/plan', {})).rejects.toThrow();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('a write that met a market that changed', () => {
  let uninstall: () => void;

  beforeEach(() => {
    setActivePinia(createPinia());
    asked.length = 0;
    uninstall = installMarketChanged();
  });
  afterEach(() => uninstall());

  it('re-reads the open market, so every screen reading the store follows', async () => {
    answers = { 'GET /markets/m-1': stored({ phase: 'draft' }) };
    serve();
    const store = useMarketStore();
    await store.open('m-1');
    answers['GET /markets/m-1'] = stored({ phase: 'applications', name: 'Fixture Renamed' });
    answers['PUT /markets/m-1/name'] = { status: 409, data: CHANGED };

    await expect(api.put('/markets/m-1/name', { name: 'Mine' })).rejects.toThrow();
    await flushPromises();

    expect(asked).toEqual(['GET /markets/m-1', 'PUT /markets/m-1/name', 'GET /markets/m-1']);
    expect(store.market?.name).toBe('Fixture Renamed');
  });

  it('leaves the market alone on any other refusal', async () => {
    answers = {
      'GET /markets/m-1': stored(),
      'PUT /markets/m-1/name': { status: 400, data: { error: 'A market needs a name.' } },
    };
    serve();
    await useMarketStore().open('m-1');

    await expect(api.put('/markets/m-1/name', { name: '' })).rejects.toThrow();
    await flushPromises();

    expect(asked).toEqual(['GET /markets/m-1', 'PUT /markets/m-1/name']);
  });

  it.each([
    ['before the refusal reaches the screen', false],
    ['after it', true],
  ])(
    "puts the server's automatic rejections back on screen, with the sentence, the re-read landing %s",
    async (_when, later) => {
      const theirs = [{ key: 'no_shows', answers: ['not ticked'] }];
      answers = { 'GET /markets/m-1': stored({ rejectionRules: [] }) };
      serve();
      const store = useMarketStore();
      await store.open('m-1');

      const Screen = defineComponent(() => {
        const { market } = storeToRefs(useMarketStore());
        const { rules, error, save } = useRejectionRules(market);
        return () => [
          h(AutomaticRejections, {
            questions: QUESTIONS,
            rules: rules.value,
            lockReason: null,
            'onUpdate:rules': save,
          }),
          error.value ? h('p', { 'data-testid': 'rules-error' }, error.value) : null,
        ];
      });
      const wrapper = mount(Screen);
      // Another organizer's rule landed after this screen read the market; this one's is refused.
      let reread: (answer: Answer) => void = () => {};
      answers['GET /markets/m-1'] = later
        ? () => new Promise<Answer>((resolve) => (reread = resolve))
        : stored({ rejectionRules: theirs });
      answers['PUT /markets/m-1/rejection-rules'] = { status: 409, data: CHANGED };

      await wrapper.get('[data-testid="rejection-rule-question"]').setValue('no_shows');
      await wrapper.get('[data-testid="rejection-rule-add"]').trigger('click');
      await flushPromises();
      if (later) {
        // The refusal is on screen, and the re-read is still on its way.
        expect(wrapper.get('[data-testid="rules-error"]').text()).toBe(SENTENCE);
        reread(stored({ rejectionRules: theirs }));
        await flushPromises();
      }

      expect(asked).toContain('PUT /markets/m-1/rejection-rules');
      expect(asked.at(-1)).toBe('GET /markets/m-1');
      expect(store.market?.rejectionRules).toEqual(theirs);
      const ticked = wrapper.get('[data-testid="rejection-answer-no_shows-not ticked"] input');
      expect((ticked.element as HTMLInputElement).checked).toBe(true);
      expect(wrapper.get('[data-testid="rules-error"]').text()).toBe(SENTENCE);
    },
  );
});
