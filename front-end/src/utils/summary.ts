/** One label/value pair on a summary row. */
export interface SummaryFact {
  label: string;
  value: string;
  /** Styled as an absence rather than a value: a thing that should be here and is not. */
  missing?: boolean;
}
