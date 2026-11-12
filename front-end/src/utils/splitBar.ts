/**
 * A split bar's parts (T201): one bar of a whole, cut into parts in a fixed order, each sized by its
 * count and filled in its own colour (`components/charts/SplitBar.vue`). The Stats tab draws the
 * review's state with it.
 */
import type { Counted } from '@/utils/barLedger';

export interface SplitPart extends Counted {
  /** Its fill, a colour token of `base.css` held to 3:1 on white: `--mm-blue`. */
  fill: string;
}
