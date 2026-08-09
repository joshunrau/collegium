import { PLUGIN_NAME_SEPARATOR } from './plugins.constants.ts';

export function toQualifiedName<TPluginName extends string, TCapabilityName extends string>(
  pluginName: TPluginName,
  capabilityName: TCapabilityName
) {
  return `${pluginName}${PLUGIN_NAME_SEPARATOR}${capabilityName}` as const;
}
