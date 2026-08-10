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
  };

  /** a button's value is its submit value — page-authored, never anything a user typed */
  type Button = Base<'button'> & { readonly value: string };

  /**
   * §3.4 — whether it holds text, never which text. The tool may sign in, so an input's contents
   * are credentials as often as not; echoing them back would recirculate into the model's context
   * exactly what it just typed, and `isFilled` is all the model needs to know its fill landed.
   */
  type Input = Base<'input'> & { readonly isFilled: boolean; readonly type: HtmlInputElementType };

  /** a select's value is one of the page's own options, so it carries no user content */
  type Select = Base<'select'> & { readonly value: string };

  type TextArea = Base<'textarea'> & { readonly isFilled: boolean };

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
