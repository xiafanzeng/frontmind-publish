/** One owner for publishing help links in both the module and standalone host. */
export const PUBLISHING_HELP_DOCUMENT_URL = 'https://my.feishu.cn/wiki/OqvjwjkVcicX6ekYimncmClnnCI?fromScene=spaceOverview';

/** Verified Feishu chapter anchor "七、AI API 连接指南" (doc revision 287, block
 * located via outline read-back on 2026-10-26). Never invent a block anchor. */
export const SOURCE_MATRIX_HELP_API_GUIDE_URL: string = 'https://my.feishu.cn/wiki/OqvjwjkVcicX6ekYimncmClnnCI#doxcnftKptBMLPBlHrscRwnz6Ve';
export const sourceMatrixApiHelpUrl = () => SOURCE_MATRIX_HELP_API_GUIDE_URL || PUBLISHING_HELP_DOCUMENT_URL;
