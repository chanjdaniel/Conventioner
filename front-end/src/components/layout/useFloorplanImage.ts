/**
 * A floorplan image as the page can draw it: fetched with the session, since the image is read on
 * its market by anyone with a role on it (T272), and held as an object URL until it changes or the
 * page goes.
 */
import { onUnmounted, ref, watch, type Ref } from 'vue';
import { api } from '@/utils/api';

export function useFloorplanImage(gridfsId: Ref<string | null | undefined>) {
  const url = ref('');
  const failed = ref(false);
  let asked = 0;

  function release() {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = '';
  }

  watch(
    gridfsId,
    async (id) => {
      const mine = ++asked;
      failed.value = false;
      if (!id) {
        release();
        return;
      }
      try {
        const { data } = await api.get(`/floorplans/${encodeURIComponent(id)}`, {
          responseType: 'blob',
        });
        if (mine !== asked) return;
        release();
        url.value = URL.createObjectURL(data);
      } catch {
        if (mine !== asked) return;
        release();
        failed.value = true;
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    asked++;
    release();
  });

  return { url, failed };
}
