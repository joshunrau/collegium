import { Module } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { CamoufoxLauncher } from './browser/browser.launcher.ts';
import { BrowserProcess } from './browser/browser.process.ts';
import { WebService } from './web.service.ts';
import { WEB_SERVICE_TOKEN } from './web.tokens.ts';

@Module({
  exports: [WebService, WEB_SERVICE_TOKEN],
  providers: [
    BrowserClient,
    BrowserProcess,
    CamoufoxLauncher,
    WebService,
    { provide: WEB_SERVICE_TOKEN, useExisting: WebService }
  ]
})
export class WebModule {}
