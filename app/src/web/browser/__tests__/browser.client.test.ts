import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toMarkdown } from '../../web.utils.ts';
import { BrowserClient } from '../browser.client.ts';
import { CamoufoxLauncher } from '../browser.launcher.ts';
import { BrowserProcess } from '../browser.process.ts';
import { isBrowserProvisioned } from '../browser.utils.ts';

import type { FormElement } from '../../snapshot/snapshot.types.ts';
import type { BrowserSession } from '../browser.session.ts';

const FIXTURES_DIR = path.resolve(import.meta.dirname, '../../__tests__/fixtures');

/** `/` and `/people` both serve the SPA: the roster route deliberately deep-links to the shell */
const FIXTURE_BY_ROUTE: { [key: string]: string } = {
  '/': 'spa-marketing-site',
  '/gated-login': 'gated-login',
  '/member-database': 'member-database',
  '/people': 'spa-marketing-site',
  '/portal': 'portal-menu',
  '/searchable-directory': 'searchable-directory'
};

const PEOPLE_LINK_REF = /\[View our people →\]\([^)]+\)⟨(e\d+)⟩/u;

describe('browsing the fixture sites', { timeout: 60_000 }, () => {
  let baseUrl: string;
  let client: BrowserClient;
  let server: http.Server;
  let session: BrowserSession;

  beforeAll(async () => {
    if (!isBrowserProvisioned()) {
      throw new Error(
        'the Camoufox browser is not installed, so the real-browser suite cannot run — `pnpm install` provisions it via the postinstall step'
      );
    }
    server = http.createServer((request, response) => {
      const fixture = FIXTURE_BY_ROUTE[request.url ?? ''];
      if (!fixture) {
        response.writeHead(404, { 'content-type': 'text/html' });
        response.end('<h1>Not Found</h1>');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(fs.readFileSync(path.join(FIXTURES_DIR, `${fixture}.html`)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the fixture server did not bind to a port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    client = new BrowserClient(new BrowserProcess(new CamoufoxLauncher()));
  });

  beforeEach(async () => {
    session = (await client.createSession()).unwrap();
  }, 60_000);

  afterEach(async () => {
    await session.dispose();
  });

  afterAll(async () => {
    await client.disposeAll();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const peopleLinkRef = (html: string): string => {
    const ref = PEOPLE_LINK_REF.exec(toMarkdown(html))?.[1];
    if (!ref) {
      throw new Error('the people link ref was not found in the markdown');
    }
    return ref;
  };

  it('should reach the roster only by clicking, with each ref landing in its own row', async () => {
    const home = (await session.navigate(`${baseUrl}/`)).unwrap();
    expect(home.status).toBe(200);
    expect(toMarkdown(home.html)).not.toContain('Duval');
    const roster = (await session.click(peopleLinkRef(home.html))).unwrap();
    const row = toMarkdown(roster.html)
      .split('\n')
      .find((line) => line.includes('Duval, P.'));
    expect(row).toContain('duval@northmoor.example');
  });

  it('should serve the marketing page for a deep link to the roster route', async () => {
    const capture = (await session.navigate(`${baseUrl}/people`)).unwrap();
    expect(capture.status).toBe(200);
    expect(toMarkdown(capture.html)).not.toContain('Duval');
  });

  it('should filter the searchable directory by filling the search box and pressing Enter', async () => {
    const all = (await session.navigate(`${baseUrl}/searchable-directory`)).unwrap();
    expect(toMarkdown(all.html)).toContain('Adeyemi, K.');
    const search = all.formElements.find((element): element is FormElement.Input => element.kind === 'input');
    if (!search) {
      throw new Error('the search input was not captured');
    }
    expect(search.type).toBe('search');
    const filtered = toMarkdown((await session.fill(search.ref, 'duval', true)).unwrap().html);
    expect(filtered).toContain('Duval, P.');
    expect(filtered).not.toContain('Adeyemi, K.');
  });

  it('should read a view rendered half a second after the click that triggered it', async () => {
    const login = (await session.navigate(`${baseUrl}/gated-login`)).unwrap();
    const refOf = (label: string): string => {
      const control = login.formElements.find((element) => element.label === label);
      if (!control) {
        throw new Error(`the control labelled ${label} was not captured`);
      }
      return control.ref;
    };
    (await session.fill(refOf('Username'), 'reviewer')).unwrap();
    (await session.fill(refOf('Password'), 'northmoor-2026')).unwrap();
    const award = (await session.click(refOf('Sign in'))).unwrap();
    expect(toMarkdown(award.html)).toContain('892');
  });

  it('should keep the gate shut on the wrong password', async () => {
    const login = (await session.navigate(`${baseUrl}/gated-login`)).unwrap();
    const inputs = login.formElements.filter((element): element is FormElement.Input => element.kind === 'input');
    for (const input of inputs) {
      (await session.fill(input.ref, 'wrong')).unwrap();
    }
    const button = login.formElements.find((element) => element.kind === 'button');
    if (!button) {
      throw new Error('the submit button was not captured');
    }
    const refused = toMarkdown((await session.click(button.ref)).unwrap().html);
    expect(refused).toContain('not recognised');
    expect(refused).not.toContain('892');
  });

  it('should report a stale ref once the page has moved on', async () => {
    const home = (await session.navigate(`${baseUrl}/`)).unwrap();
    const ref = peopleLinkRef(home.html);
    (await session.click(ref)).unwrap();
    const again = await session.click(ref);
    expect(again.success).toBe(false);
    expect(again.error?.kind).toBe('stale-ref');
  });

  it('should report a navigation failure when the host does not answer', async () => {
    const result = await session.navigate('http://127.0.0.1:9/');
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe('navigation');
  });

  it('should mark a submenu ref CSS hides, then act on it once a hover reveals it', async () => {
    const portal = (await session.navigate(`${baseUrl}/portal`)).unwrap();
    const refFor = (html: string, label: string): string => {
      const line = toMarkdown(html)
        .split('\n')
        .find((candidate) => candidate.includes(label));
      const ref = line === undefined ? undefined : /⟨(e\d+)(?<hidden> hidden)?⟩/u.exec(line);
      if (!ref) {
        throw new Error(`no ref found for ${label}`);
      }
      return ref[0];
    };
    // the roster link is in the document from the start, so it is stamped — and unactionable
    expect(refFor(portal.html, 'Répertoire des professeurs')).toMatch(/ hidden⟩$/u);
    const menuRef = /⟨(e\d+)⟩/u.exec(refFor(portal.html, 'Équipe'))![1]!;
    const revealed = (await session.hover(menuRef)).unwrap();
    expect(refFor(revealed.html, 'Répertoire des professeurs')).not.toMatch(/ hidden⟩$/u);
  });

  it('should refuse a click on a ref CSS hides rather than time out unexplained', async () => {
    const portal = (await session.navigate(`${baseUrl}/portal`)).unwrap();
    const hidden = /⟨(e\d+) hidden⟩/u.exec(toMarkdown(portal.html));
    if (!hidden) {
      throw new Error('no hidden ref was marked on the portal fixture');
    }
    const refused = await session.click(hidden[1]!);
    expect(refused.success).toBe(false);
    expect(refused.error?.kind).toBe('not-visible');
  });

  it('should follow a target=_blank link into the tab it opens', async () => {
    const portal = (await session.navigate(`${baseUrl}/portal`)).unwrap();
    const menuRef = /\[Équipe\]\([^)]*\)⟨(e\d+)⟩/u.exec(toMarkdown(portal.html))![1]!;
    const revealed = (await session.hover(menuRef)).unwrap();
    const rosterRef = /\[Répertoire des professeurs\]\([^)]*\)⟨(e\d+)⟩/u.exec(toMarkdown(revealed.html))![1]!;
    const opened = (await session.click(rosterRef)).unwrap();
    expect(opened.url).toContain('/member-database');
    expect(opened.status).toBe(200);
    expect(toMarkdown(opened.html)).toContain('lachance@northmoor.example');
  });

  it('should hand back a 404 as a page with a status, not a failure', async () => {
    const capture = (await session.navigate(`${baseUrl}/missing`)).unwrap();
    expect(capture.status).toBe(404);
    expect(toMarkdown(capture.html)).toContain('Not Found');
  });
});
