import * as http from 'node:http';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPdf } from '@/testing/factories/pdf.factory.ts';

import { toMarkdown } from '../../web.utils.ts';
import { BrowserClient } from '../browser.client.ts';
import { CamoufoxLauncher } from '../browser.launcher.ts';
import { BrowserProcess } from '../browser.process.ts';
import { isBrowserProvisioned } from '../browser.utils.ts';
import { PolicyProxy } from '../policy.proxy.ts';

import type { FormElement } from '../../snapshot/snapshot.types.ts';
import type { BrowserSession } from '../browser.session.ts';

/** the roster exists nowhere in the document until the link is clicked: its href is never followed */
const SPA_MARKETING_SITE = `<!doctype html>
<html lang="en">
  <head><title>Northmoor Institute — Advancing What Comes Next</title></head>
  <body>
    <div id="app"></div>
    <script>
      const FACULTY = [
        ['Adeyemi, K.', 'adeyemi@northmoor.example'],
        ['Duval, P.', 'duval@northmoor.example']
      ];
      const app = document.getElementById('app');
      const renderPeople = () => {
        const rows = FACULTY.map(
          (person) =>
            '<tr><td>' + person[0] + '</td><td><a href="mailto:' + person[1] + '">' + person[1] + '</a></td></tr>'
        );
        app.innerHTML =
          '<h1>Our People</h1><table><thead><tr><th>Name</th><th>Email</th></tr></thead><tbody>' +
          rows.join('') +
          '</tbody></table>';
      };
      const renderIndex = () => {
        app.innerHTML = '<h1>Northmoor Institute</h1><a href="/people" id="view-people">View our people →</a>';
        document.getElementById('view-people').addEventListener('click', (event) => {
          event.preventDefault();
          renderPeople();
        });
      };
      window.setTimeout(renderIndex, 0);
    </script>
  </body>
</html>`;

/** the award page exists only after a successful submit, and only once its delay has elapsed */
const GATED_LOGIN = `<!doctype html>
<html lang="en">
  <head><title>Grants Portal — Northmoor University</title></head>
  <body>
    <main id="root">
      <h1>Grants Portal</h1>
      <form id="sign-in">
        <label for="username">Username</label><input id="username" name="username" type="text" />
        <label for="password">Password</label><input id="password" name="password" type="password" />
        <button type="submit">Sign in</button>
      </form>
      <p id="message"></p>
    </main>
    <script>
      document.getElementById('sign-in').addEventListener('submit', (event) => {
        event.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        if (username !== 'reviewer' || password !== 'northmoor-2026') {
          document.getElementById('message').textContent = 'Those credentials were not recognised.';
          return;
        }
        window.setTimeout(() => {
          document.getElementById('root').innerHTML =
            '<h1>Award Reference</h1><p>Secret Number <strong>892</strong></p>';
        }, 500);
      });
    </script>
  </body>
</html>`;

const MEMBER_DATABASE = `<!doctype html>
<html lang="fr">
  <head><title>Répertoire des professeurs</title></head>
  <body>
    <h1>Répertoire des professeurs</h1>
    <table>
      <thead><tr><th>Nom</th><th>Rang</th><th>Courriel</th></tr></thead>
      <tbody>
        <tr><td>Lachance, M.</td><td>Professeure titulaire</td><td>lachance@northmoor.example</td></tr>
      </tbody>
    </table>
  </body>
</html>`;

/** the submenu is in the document from the start and is revealed only under the pointer */
const PORTAL_MENU = `<!doctype html>
<html lang="fr">
  <head>
    <title>Portail Northmoor — Accueil</title>
    <style>
      .submenu {
        display: none;
      }
      .has-submenu:hover .submenu {
        display: block;
      }
    </style>
  </head>
  <body>
    <nav>
      <ul>
        <li><a href="/portal">Accueil</a></li>
        <li class="has-submenu">
          <a href="#equipe">Équipe</a>
          <ul class="submenu">
            <li><a href="/member-database" target="_blank">Répertoire des professeurs</a></li>
          </ul>
        </li>
      </ul>
    </nav>
  </body>
</html>`;

/** no URL addresses a filtered view: the rows are chosen by the keydown handler alone */
const SEARCHABLE_DIRECTORY = `<!doctype html>
<html lang="en">
  <head><title>People Directory — Northmoor Institute</title></head>
  <body>
    <h1>People Directory</h1>
    <input aria-label="Search people" type="search" />
    <table>
      <thead><tr><th>Name</th><th>Email</th></tr></thead>
      <tbody>
        <tr><td>Adeyemi, K.</td><td>adeyemi@northmoor.example</td></tr>
        <tr><td>Duval, P.</td><td>duval@northmoor.example</td></tr>
      </tbody>
    </table>
    <script>
      const rows = [...document.querySelectorAll('tbody tr')];
      document.querySelector('input').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        const query = event.target.value.toLowerCase();
        const matches = rows.filter((row) => row.textContent.toLowerCase().includes(query));
        document.querySelector('tbody').replaceChildren(...matches);
      });
    </script>
  </body>
</html>`;

/** a bot check that clears itself: refused at first, then moved on by its own script to the page it guarded */
const SELF_CLEARING_CHECK = `<!doctype html>
<html lang="en">
  <head><title>Just a moment...</title></head>
  <body>
    <h1>Verifying you are human.</h1>
    <script>
      window.addEventListener('load', () => window.setTimeout(() => window.location.replace('/cleared'), 200));
    </script>
  </body>
</html>`;

/** `/` and `/people` both serve the SPA: the roster route deliberately deep-links to the shell */
const DOCUMENT_BY_ROUTE: { [key: string]: string } = {
  '/': SPA_MARKETING_SITE,
  '/cleared': MEMBER_DATABASE,
  '/gated-login': GATED_LOGIN,
  '/member-database': MEMBER_DATABASE,
  '/people': SPA_MARKETING_SITE,
  '/portal': PORTAL_MENU,
  '/searchable-directory': SEARCHABLE_DIRECTORY
};

const PEOPLE_LINK_REF = /\[View our people →\]\([^)]+\)⟨(e\d+)⟩/u;

const ELSEWHERE_LINK_REF = /\[Elsewhere\]\([^)]+\)⟨(e\d+)⟩/u;

const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind to a port');
  }
  return `http://127.0.0.1:${address.port}`;
};

const close = (server: http.Server): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

describe('browsing the fixture sites', { timeout: 60_000 }, () => {
  let baseUrl: string;
  let client: BrowserClient;
  /** an origin the policy refuses; every request that reaches it is one the guard let through */
  let elsewhere: http.Server;
  let elsewhereRequests: number;
  let elsewhereUrl: string;
  let proxy: PolicyProxy;
  let server: http.Server;
  let session: BrowserSession;

  beforeAll(async () => {
    if (!isBrowserProvisioned()) {
      throw new Error(
        'the Camoufox browser is not installed, so the real-browser suite cannot run — `pnpm install` provisions it via the postinstall step'
      );
    }
    elsewhereRequests = 0;
    elsewhere = http.createServer((_request, response) => {
      elsewhereRequests += 1;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<h1>elsewhere-marker</h1>');
    });
    elsewhereUrl = await listen(elsewhere);
    server = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: `${elsewhereUrl}/` });
        response.end();
        return;
      }
      if (request.url === '/challenge') {
        response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
        response.end(SELF_CLEARING_CHECK);
        return;
      }
      if (request.url === '/handbook.pdf') {
        response.writeHead(200, { 'content-type': 'application/pdf' });
        response.end(createPdf([['Faculty Handbook']]));
        return;
      }
      if (request.url === '/outbound') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<a href="${elsewhereUrl}/">Elsewhere</a>`);
        return;
      }
      const page = DOCUMENT_BY_ROUTE[request.url ?? ''];
      if (!page) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>Not Found</h1>');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
    });
    baseUrl = await listen(server);
    // the production policy refuses loopback, which is where the fixtures are served from
    proxy = new PolicyProxy({
      vet: (url) => Promise.resolve(url.origin === baseUrl ? { address: '127.0.0.1', family: 4 } : undefined)
    });
    client = new BrowserClient(new BrowserProcess(new CamoufoxLauncher()), proxy);
  });

  beforeEach(async () => {
    elsewhereRequests = 0;
    session = (await client.createSession()).unwrap();
  }, 60_000);

  afterEach(async () => {
    await session.dispose();
  });

  afterAll(async () => {
    await client.disposeAll();
    await proxy.onApplicationShutdown();
    await close(server);
    await close(elsewhere);
  });

  it('should refuse a redirect the policy refuses before it reaches its target (§3.4)', async () => {
    const result = await session.navigate(`${baseUrl}/redirect`);
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe('navigation');
    expect(elsewhereRequests).toBe(0);
  });

  it('should refuse a same-session link click the policy refuses (§3.4)', async () => {
    const outbound = (await session.navigate(`${baseUrl}/outbound`)).unwrap();
    const ref = ELSEWHERE_LINK_REF.exec(toMarkdown(outbound.html))?.[1];
    if (!ref) {
      throw new Error('the outbound link ref was not found in the markdown');
    }
    const after = await session.click(ref);
    expect(after.success ? toMarkdown(after.value.html) : '').not.toContain('elsewhere-marker');
    expect(elsewhereRequests).toBe(0);
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
      const ref = line === undefined ? undefined : /⟨(e\d+)⟩(?<hidden> \(hidden\))?/u.exec(line);
      if (!ref) {
        throw new Error(`no ref found for ${label}`);
      }
      return ref[0];
    };
    // the roster link is in the document from the start, so it is stamped — and unactionable
    expect(refFor(portal.html, 'Répertoire des professeurs')).toMatch(/\(hidden\)$/u);
    const menuRef = /⟨(e\d+)⟩/u.exec(refFor(portal.html, 'Équipe'))![1]!;
    const revealed = (await session.hover(menuRef)).unwrap();
    expect(refFor(revealed.html, 'Répertoire des professeurs')).not.toMatch(/\(hidden\)$/u);
  });

  it('should refuse a click on a ref CSS hides rather than time out unexplained', async () => {
    const portal = (await session.navigate(`${baseUrl}/portal`)).unwrap();
    const hidden = /⟨(e\d+)⟩ \(hidden\)/u.exec(toMarkdown(portal.html));
    if (!hidden) {
      throw new Error('no hidden ref was marked on the portal fixture');
    }
    const refused = await session.click(hidden[1]!);
    expect(refused.success).toBe(false);
    expect(refused.error?.kind).toBe('not-visible');
  });

  it('should stay on the page when a link opens a tab, reporting the address it was closed at', async () => {
    const portal = (await session.navigate(`${baseUrl}/portal`)).unwrap();
    const menuRef = /\[Équipe\]\([^)]*\)⟨(e\d+)⟩/u.exec(toMarkdown(portal.html))![1]!;
    const revealed = (await session.hover(menuRef)).unwrap();
    const rosterRef = /\[Répertoire des professeurs\]\([^)]*\)⟨(e\d+)⟩/u.exec(toMarkdown(revealed.html))![1]!;
    const after = (await session.click(rosterRef)).unwrap();
    expect(after.url).toContain('/portal');
    expect(after.openedUrls).toStrictEqual([`${baseUrl}/member-database`]);
    const roster = (await session.navigate(after.openedUrls[0]!)).unwrap();
    expect(roster.openedUrls).toStrictEqual([]);
    expect(toMarkdown(roster.html)).toContain('lachance@northmoor.example');
  });

  it('should report the status of the document the page settled on, not the first one served (§3.4)', async () => {
    const capture = (await session.navigate(`${baseUrl}/challenge`)).unwrap();
    expect(capture.status).toBe(200);
    expect(toMarkdown(capture.html)).toContain('lachance@northmoor.example');
  });

  it('should hand back a 404 as a page with a status, not a failure', async () => {
    const capture = (await session.navigate(`${baseUrl}/missing`)).unwrap();
    expect(capture.status).toBe(404);
    expect(toMarkdown(capture.html)).toContain('Not Found');
  });

  it('should refuse a PDF as not HTML, leaving it to web::fetch (§3.4)', async () => {
    const result = await session.navigate(`${baseUrl}/handbook.pdf`);
    expect(result.error).toStrictEqual({
      contentType: 'application/pdf',
      kind: 'not-html',
      url: `${baseUrl}/handbook.pdf`
    });
  });
});
