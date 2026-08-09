import type { LiteralUnion } from 'type-fest';

/** the DOM's `.type` getter sanitizes unknown attributes to 'text', so the open arm only admits future spec additions */
type HtmlInputElementType = LiteralUnion<
  | 'button'
  | 'checkbox'
  | 'color'
  | 'date'
  | 'datetime-local'
  | 'email'
  | 'file'
  | 'hidden'
  | 'image'
  | 'month'
  | 'number'
  | 'password'
  | 'radio'
  | 'range'
  | 'reset'
  | 'search'
  | 'submit'
  | 'tel'
  | 'text'
  | 'time'
  | 'url'
  | 'week',
  string
>;

export declare namespace FormElement {
  type Base<TKind extends keyof HTMLElementTagNameMap> = {
    readonly kind: TKind;
    readonly label: string;
    readonly ref: string;
    readonly value: string;
  };

  type Button = Base<'button'>;

  type Input = Base<'input'> & { readonly type: HtmlInputElementType };

  type Select = Base<'select'>;

  type TextArea = Base<'textarea'>;

  type Any = Button | Input | Select | TextArea;
}

/** a form control whose semantics do not survive markdown conversion, described for the model */
export type FormElement = FormElement.Any;

/** what `captureSnapshot` hands back across the `page.evaluate` boundary — JSON-serializable by contract */
export type SnapshotCapture = {
  readonly formElements: readonly FormElement[];
  readonly html: string;
  readonly nextRefIndex: number;
};
