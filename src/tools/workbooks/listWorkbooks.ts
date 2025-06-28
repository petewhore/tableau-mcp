import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listWorkbooksTool = new Tool({
  name: 'list-workbooks',
  description: `
Retrieves a list of published workbooks from a specified Tableau site using the Tableau REST API. Supports optional filtering via field:operator:value expressions for precise workbook discovery.

**Supported Filter Fields and Operators**
| Field                  | Operators                                 |
|------------------------|-------------------------------------------|
| name                   | eq, in                                    |
| contentUrl             | eq, in                                    |
| createdAt              | eq, gt, gte, lt, lte                      |
| updatedAt              | eq, gt, gte, lt, lte                      |
| ownerName              | eq, in                                    |
| projectName            | eq, in                                    |
| size                   | eq, gt, gte, lt, lte                      |
| showTabs               | eq                                        |
| tags                   | eq, in                                    |

**Supported Operators**
- \`eq\`: equals
- \`gt\`: greater than
- \`gte\`: greater than or equal
- \`in\`: any of [list] (for searching tags)
- \`lt\`: less than
- \`lte\`: less than or equal

**Filter Expression Examples:**
- List workbooks by name: \`filter: "name:eq:Sales Dashboard"\`
- List workbooks in Finance project: \`filter: "projectName:eq:Finance"\`
- List large workbooks: \`filter: "size:gt:10000000"\`
- List recently updated: \`filter: "updatedAt:gt:2023-01-01T00:00:00Z"\`
- List by owner: \`filter: "ownerName:eq:john.doe"\`
- Multiple filters: \`filter: "projectName:eq:Finance,updatedAt:gt:2023-01-01T00:00:00Z"\`

**Example Usage:**
- List all workbooks: \`{}\`
- List Finance workbooks: \`{ "filter": "projectName:eq:Finance" }\`
- List recent workbooks: \`{ "filter": "updatedAt:gt:2023-01-01T00:00:00Z" }\`
`,
  paramsSchema: {
    filter: z.string().optional(),
  },
  annotations: {
    title: 'List Workbooks',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listWorkbooksTool.logAndExecute({
      requestId,
      args: { filter },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        const response = await restApi.workbooksMethods.listWorkbooks(restApi.siteId, filter);
        
        return new Ok({
          success: true,
          workbooks: response.workbooks,
          totalCount: response.pagination?.totalAvailable || response.workbooks.length,
          message: `Found ${response.workbooks.length} workbooks${filter ? ` matching filter: ${filter}` : ''}`,
        });
      },
    });
  },
});