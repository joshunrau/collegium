import { defineTool } from '@collegium/sdk';

export const conceptTool = defineTool({
  execute: (_, { settings }) => {
    return settings.foo;
  }
});
