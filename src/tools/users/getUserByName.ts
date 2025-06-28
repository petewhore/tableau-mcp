import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const getUserByNameTool = new Tool({
  name: 'get-user-by-name',
  description: `
Retrieve detailed information about a specific user by their username. This tool provides comprehensive user details including site role, authentication settings, and activity information.

**Parameters:**
- \`username\`: The username of the user to retrieve (required)

**Returned Information:**
- User ID and basic details
- Site role and permissions level
- Authentication method (SAML, OpenID, ServerDefault)
- Email address and full name (if available)
- Last login information
- Account creation and update timestamps

**Example Usage:**
- Get user details: \`{ "username": "john.doe" }\`
- Look up administrator: \`{ "username": "admin.user" }\`

**Use Cases:**
- Verify user exists before operations
- Check user permissions and role
- Audit user information and activity
- Troubleshoot user access issues
- Validate user details before content assignment

**Note:** This tool performs an exact username match. For searching multiple users or partial matches, use the 'search-users' tool instead.
`,
  paramsSchema: {
    username: z.string().min(1, 'Username is required'),
  },
  annotations: {
    title: 'Get User By Name',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ username }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getUserByNameTool.logAndExecute({
      requestId,
      args: { username },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        const user = await restApi.usersMethods.getUserByName(restApi.siteId, username);
        
        if (!user) {
          return new Err(`User not found: ${username}`);
        }
        
        return new Ok({
          success: true,
          user,
          message: `Found user '${user.name}'`,
          details: {
            hasEmail: !!user.email,
            hasFullName: !!user.fullName,
            lastLogin: user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never',
            isAdmin: user.siteRole.includes('SiteAdministrator'),
            canPublish: ['Creator', 'ExplorerCanPublish', 'SiteAdministratorCreator'].includes(user.siteRole),
          },
        });
      },
    });
  },
});