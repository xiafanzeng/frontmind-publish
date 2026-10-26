/** One owner for publishing help links in both the module and standalone host. */
export const PUBLISHING_HELP_DOCUMENT_URL = 'https://my.feishu.cn/wiki/OqvjwjkVcicX6ekYimncmClnnCI?fromScene=spaceOverview';

/** ZCode must replace this with the verified Feishu chapter link after append/readback.
 * Empty means pending; never invent a Feishu block anchor. */
export const SOURCE_MATRIX_HELP_API_GUIDE_URL: string = '';
export const sourceMatrixApiHelpUrl = () => SOURCE_MATRIX_HELP_API_GUIDE_URL || PUBLISHING_HELP_DOCUMENT_URL;
