import { Module } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { CamoufoxLauncher } from './browser/browser.launcher.ts';
import { BrowserProcess } from './browser/browser.process.ts';
import { WebService } from './web.service.ts';

@Module({
  exports: [WebService],
  providers: [BrowserClient, BrowserProcess, CamoufoxLauncher, WebService]
})
export class WebModule {}
