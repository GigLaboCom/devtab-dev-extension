/**
 * What the SQL Formatter remembers between uses (D21; docs/tools/settings.md): Dialect, Keyword case, Indent and Layout
 * — never the query (it can hold a password), the result or a file's name (the history keeps the query, D17). Tabular
 * with Tab turns Indent to 2 spaces, and both are saved; a stored Tab with Tabular opens as 2 spaces. A paste from the
 * start page and an opened file bring only the text. A value a list no longer has (a dialect dropped) opens as its
 * default.
 */
import { DEFAULT_OPTIONS, DIALECTS } from '@workspace/tool-logic-sql-format';
import { declareSettings, setting } from '@workspace/tools-host';

export const sqlFormatSettings = declareSettings({
  schema: 1,
  fields: {
    dialect: setting.oneOf(DIALECTS, DEFAULT_OPTIONS.dialect),
    keywordCase: setting.oneOf(['upper', 'lower', 'preserve'], DEFAULT_OPTIONS.keywordCase),
    indent: setting.oneOf([2, 4, 'tab'], DEFAULT_OPTIONS.indent),
    layout: setting.oneOf(['standard', 'tabularLeft', 'tabularRight'], DEFAULT_OPTIONS.layout),
  },
});
