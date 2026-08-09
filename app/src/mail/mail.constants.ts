/**
 * A leaf constant only: `config.schemas.ts` needs the tool name while its module evaluates, and
 * the tool class reaches runtime services — deriving the name from the class would close an
 * import cycle at boot (see `tools.constants.ts`).
 */
export const MAIL_TOOL_NAME = 'mail';
