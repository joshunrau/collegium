declare const SERVICE_INSTANCE: unique symbol;

/**
 * A NestJS-compatible injection token branded with the instance type it resolves to. Declared in a
 * leaf `<module>.tokens.ts` beside `import type` of the service alone, which is what keeps a
 * toolset declaration inert (§2): the entrypoint and provisioning import one without pulling the
 * service's runtime module into their graphs.
 */
export type ServiceToken<TInstance> = { readonly [SERVICE_INSTANCE]?: TInstance } & symbol;

export function createServiceToken<TInstance>(description: string): ServiceToken<TInstance> {
  return Symbol(description);
}
