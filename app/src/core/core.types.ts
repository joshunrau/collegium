import type { LiteralUnion } from 'type-fest';

import type { $ModelRef } from '@/config/config.schemas.ts';

export type ProviderName = $ModelRef['provider'];

/** the common cases named for autocomplete; open-ended, since a MIME type is whatever a sender declared */
export type MimeType = LiteralUnion<
  | 'application/gzip'
  | 'application/json'
  | 'application/msword'
  | 'application/octet-stream'
  | 'application/pdf'
  | 'application/rtf'
  | 'application/vnd.ms-excel'
  | 'application/vnd.ms-powerpoint'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/xml'
  | 'application/zip'
  | 'audio/mpeg'
  | 'image/gif'
  | 'image/heic'
  | 'image/jpeg'
  | 'image/png'
  | 'image/svg+xml'
  | 'image/tiff'
  | 'image/webp'
  | 'message/rfc822'
  | 'text/calendar'
  | 'text/csv'
  | 'text/html'
  | 'text/markdown'
  | 'text/plain'
  | 'video/mp4'
  | 'video/quicktime',
  string
>;

/** a tool as described to a model: parameters are JSON Schema, produced from the definition's Zod schema */
export type ToolSchema = {
  readonly description: string;
  readonly name: string;
  readonly parameters: { [key: string]: unknown };
};
