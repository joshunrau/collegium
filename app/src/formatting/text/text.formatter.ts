import { format } from '@collegium/core/utils';
import type { Placeholders } from '@collegium/core/utils';
import { Injectable } from '@nestjs/common';

/** the locale is fixed because the framework speaks one language (§3.2) */
@Injectable()
export class TextFormatter {
  private readonly conjunction = new Intl.ListFormat('en-US', { type: 'conjunction' });

  formatBullets(items: readonly string[]): string {
    return items.map((item) => `- ${item}`).join('\n');
  }

  formatConjunction(items: readonly string[]): string {
    return this.conjunction.format(items);
  }

  /** the paragraphs' own text decides which names the values must carry, as with a single template */
  formatParagraphs<TParagraph extends string>(
    paragraphs: readonly TParagraph[],
    values: { readonly [K in Placeholders<TParagraph>]: number | string }
  ): string {
    return paragraphs.map((paragraph) => format(paragraph, values)).join('\n\n');
  }
}
