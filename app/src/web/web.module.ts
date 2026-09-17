import { Module } from '@nestjs/common';

import { BrowserClient } from './browser/browser.client.ts';
import { CamoufoxLauncher } from './browser/browser.launcher.ts';
import { BrowserProcess } from './browser/browser.process.ts';
import { PolicyProxy } from './browser/policy.proxy.ts';
import { FetchClient } from './fetch/fetch.client.ts';
import { BraveSearchClient } from './search/brave.client.ts';
import { SearchService } from './search/search.service.ts';
import { PRODUCTION_ADDRESS_POLICY } from './web.policy.ts';
import { WebService } from './web.service.ts';
import { ADDRESS_POLICY_TOKEN, SEARCH_SERVICE_TOKEN, WEB_SERVICE_TOKEN } from './web.tokens.ts';

@Module({
  exports: [SEARCH_SERVICE_TOKEN, WebService, WEB_SERVICE_TOKEN],
  providers: [
    BraveSearchClient,
    BrowserClient,
    BrowserProcess,
    CamoufoxLauncher,
    FetchClient,
    PolicyProxy,
    SearchService,
    WebService,
    { provide: ADDRESS_POLICY_TOKEN, useValue: PRODUCTION_ADDRESS_POLICY },
    { provide: SEARCH_SERVICE_TOKEN, useExisting: SearchService },
    { provide: WEB_SERVICE_TOKEN, useExisting: WebService }
  ]
})
export class WebModule {}
