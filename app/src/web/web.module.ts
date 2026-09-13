import { Module } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { CamoufoxLauncher } from './browser/browser.launcher.ts';
import { BrowserProcess } from './browser/browser.process.ts';
import { FetchClient } from './fetch/fetch.client.ts';
import { BraveSearchClient } from './search/brave.client.ts';
import { SearchService } from './search/search.service.ts';
import { WebService } from './web.service.ts';
import { SEARCH_SERVICE_TOKEN, WEB_SERVICE_TOKEN } from './web.tokens.ts';

@Module({
  exports: [SEARCH_SERVICE_TOKEN, WebService, WEB_SERVICE_TOKEN],
  providers: [
    BraveSearchClient,
    BrowserClient,
    BrowserProcess,
    CamoufoxLauncher,
    FetchClient,
    SearchService,
    WebService,
    { provide: SEARCH_SERVICE_TOKEN, useExisting: SearchService },
    { provide: WEB_SERVICE_TOKEN, useExisting: WebService }
  ]
})
export class WebModule {}
