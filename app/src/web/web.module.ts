import { Module } from '@nestjs/common';

import { ConfigService } from '@/config/config.service.ts';
import { LoggerFactory } from '@/logging/logging.factory.ts';

import { BrowserClient } from './browser/browser.client.ts';
import { CamoufoxLauncher } from './browser/browser.launcher.ts';
import { BrowserProcess } from './browser/browser.process.ts';
import { PolicyProxy } from './browser/policy.proxy.ts';
import { FetchClient } from './fetch/fetch.client.ts';
import { UnpdfTextExtractor } from './pdf/adapters/unpdf.extractor.ts';
import { PdfTextExtractor } from './pdf/pdf-text.extractor.ts';
import { BraveSearchClient } from './search/brave.client.ts';
import { SearchService } from './search/search.service.ts';
import { createAddressPolicy } from './web.policy.ts';
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
    { provide: PdfTextExtractor, useClass: UnpdfTextExtractor },
    {
      inject: [ConfigService, LoggerFactory],
      provide: ADDRESS_POLICY_TOKEN,
      useFactory: (configService: ConfigService, loggerFactory: LoggerFactory) => {
        const allowPrivateAddresses = configService.get('web.allowPrivateAddresses');
        if (allowPrivateAddresses) {
          loggerFactory
            .createLogger('WebModule')
            .warn('web.allowPrivateAddresses is on: loopback and private-network addresses are browsable (§3.4)');
        }
        return createAddressPolicy({ allowPrivateAddresses });
      }
    },
    { provide: SEARCH_SERVICE_TOKEN, useExisting: SearchService },
    { provide: WEB_SERVICE_TOKEN, useExisting: WebService }
  ]
})
export class WebModule {}
