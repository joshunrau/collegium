import type { ReactNode } from 'react';

import { navigate } from 'astro:transitions/client';
import type { AstroProviderProps } from 'fumadocs-core/framework/astro';
import type { Root } from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsPage } from 'fumadocs-ui/layouts/docs/page';
import type { DocsPageProps } from 'fumadocs-ui/layouts/docs/page';
import { RootProvider } from 'fumadocs-ui/provider/astro';

import SearchDialog from './search.tsx';

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
export const Docs = ({ children, page, params, pathname, tree }: DocsProps) => {
  return (
    <RootProvider
      navigate={navigate}
      params={params}
      pathname={pathname}
      search={{ SearchDialog }}
      theme={{ enabled: false }}
    >
      <DocsLayout nav={{ title: 'Collegium' }} themeSwitch={{ enabled: false }} tree={tree}>
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
};
