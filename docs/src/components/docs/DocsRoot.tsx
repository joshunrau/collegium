import type { ReactNode } from 'react';

import { navigate } from 'astro:transitions/client';
import type { AstroProviderProps } from 'fumadocs-core/framework/astro';
import type { Root } from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsPage } from 'fumadocs-ui/layouts/docs/page';
import type { DocsPageProps } from 'fumadocs-ui/layouts/docs/page';
import { RootProvider } from 'fumadocs-ui/provider/astro';

import { DocsSearchDialog } from './DocsSearchDialog.tsx';

type DocsProps = {
  children: ReactNode;
  page?: DocsPageProps;
  params: AstroProviderProps['params'];
  pathname: string;
  tree: Root;
};

/**
 * The single React island the docs shell lives in. Route information cannot be inferred from the
 * browser here, so it is handed down from the `.astro` page that renders this.
 */
export const DocsRoot = ({ children, page, params, pathname, tree }: DocsProps) => {
  return (
    <RootProvider
      navigate={navigate}
      params={params}
      pathname={pathname}
      search={{ SearchDialog: DocsSearchDialog }}
      // `enableColorScheme` writes `color-scheme` as an inline style, which would take the property over from the shell style in `Layout.astro` on docs pages only. It is declared there for every route.
      theme={{ enableColorScheme: false, storageKey: 'collegium-theme' }}
    >
      <DocsLayout
        githubUrl="https://github.com/joshunrau/collegium"
        nav={{ title: 'Collegium' }}
        themeSwitch={{ mode: 'light-dark' }}
        tree={tree}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
};
