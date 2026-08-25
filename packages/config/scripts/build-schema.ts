import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildConfigJsonSchema } from '@collegium/config';

// resolved through the package's own exports, so the artifact derives from the build it ships with
const outputPath = path.resolve(import.meta.dirname, '../dist/config.schema.json');

fs.writeFileSync(outputPath, `${JSON.stringify(buildConfigJsonSchema(), null, 2)}\n`);
