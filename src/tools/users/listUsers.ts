import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listUsersTool = new Tool({
  name: 'search-users',
  description: `
Retrieve a list of users from the Tableau Cloud site. Supports optional filtering via field:operator:value expressions for precise user discovery.

**Supported Filter Fields and Operators:**
| Field           | Operators                     |
|-----------------|-------------------------------|
| name            | eq, in                        |
| siteRole        | eq, in                        |
| lastLogin       | eq, gt, gte, lt, lte         |
| email           | eq, in                        |
| authSetting     | eq, in                        |

**Supported Operators:**
- \`eq\`: equals
- \`gt\`: greater than
- \`gte\`: greater than or equal
- \`in\`: any of [list]
- \`lt\`: less than
- \`lte\`: less than or equal

**Filter Expression Examples:**
- List users with Creator role: \`filter: "siteRole:eq:Creator"\`
- List users who logged in after 2023-01-01: \`filter: "lastLogin:gt:2023-01-01T00:00:00Z"\`
- List multiple roles: \`filter: "siteRole:in:[Creator,SiteAdministratorCreator]"\`
- Combined filters: \`filter: "siteRole:eq:Creator,lastLogin:gt:2023-01-01T00:00:00Z"\`

**Example Usage:**
- List all users: \`{}\`
- List Creators: \`{ "filter": "siteRole:eq:Creator" }\`
- List recent logins: \`{ "filter": "lastLogin:gt:2023-01-01T00:00:00Z" }\`
`,
  paramsSchema: {
    filter: z.string().optional(),
  },
  annotations: {
    title: 'Search Users',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listUsersTool.logAndExecute({
      requestId,
      args: { filter },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        const response = await restApi.usersMethods.listUsers(restApi.siteId, filter);
        
        return new Ok({
          success: true,
          users: response.users,
          totalCount: response.pagination?.totalAvailable || response.users.length,
          message: `Found ${response.users.length} users${filter ? ` matching filter: ${filter}` : ''}`,
        });
      },
    });
  },
});