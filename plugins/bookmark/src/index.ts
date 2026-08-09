import { plugin } from './plugin.ts';
import { ListTool } from './tools/list.tool.ts';
import { SaveTool } from './tools/save.tool.ts';

export default plugin.create({
  skills: ['saving-bookmarks'],
  tools: [ListTool, SaveTool]
});
