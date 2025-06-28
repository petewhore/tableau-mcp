import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const updateUserTool = new Tool({
  name: 'update-user',
  description: `
Update an existing user's properties in Tableau Cloud. You can specify the user by either ID or username, and update their site role, authentication settings, or other properties.

**Parameters:**
- \`userId\`: ID of the user to update (use this OR username)
- \`username\`: Name of the user to update (use this OR userId)
- \`siteRole\`: New site role for the user (optional)
- \`authSetting\`: New authentication method (optional)
- \`email\`: New email address (optional)
- \`fullName\`: New full name (optional)

**Site Roles:**
- \`Viewer\`: Can view shared content
- \`Explorer\`: Can explore and interact with content
- \`ExplorerCanPublish\`: Explorer with publish permissions
- \`Creator\`: Full content creation and publishing permissions
- \`SiteAdministratorExplorer\`: Site admin with Explorer permissions
- \`SiteAdministratorCreator\`: Site admin with Creator permissions

**Authentication Settings:**
- \`ServerDefault\`: Use server default authentication
- \`SAML\`: SAML-based authentication
- \`OpenID\`: OpenID Connect authentication

**Example Usage:**
- Update user role by username: \`{ "username": "john.doe", "siteRole": "Creator" }\`
- Update user by ID: \`{ "userId": "user-id-123", "siteRole": "Explorer", "email": "newemail@company.com" }\`
- Change auth method: \`{ "username": "jane.smith", "authSetting": "SAML" }\`
`,
  paramsSchema: {
    userId: z.string().optional(),
    username: z.string().optional(),
    siteRole: z.enum([
      'Viewer',
      'Explorer', 
      'ExplorerCanPublish',
      'Creator',
      'SiteAdministratorExplorer',
      'SiteAdministratorCreator'
    ]).optional(),
    authSetting: z.enum(['ServerDefault', 'SAML', 'OpenID']).optional(),
    email: z.string().email().optional(),
    fullName: z.string().optional(),
  },
  annotations: {
    title: 'Update User',
    readOnlyHint: false,
    openWorldHint: false,
  },
  argsValidator: (args) => {
    if (!args.userId && !args.username) {
      throw new Error('Either userId or username must be provided');
    }
    if (!args.siteRole && !args.authSetting && !args.email && !args.fullName) {
      throw new Error('At least one property to update must be provided');
    }
  },
  callback: async ({ userId, username, siteRole, authSetting, email, fullName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await updateUserTool.logAndExecute({
      requestId,
      args: { userId, username, siteRole, authSetting, email, fullName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        let targetUserId = userId;
        
        // If username provided, find the user ID
        if (!targetUserId && username) {
          const user = await restApi.usersMethods.getUserByName(restApi.siteId, username);
          if (!user) {
            return new Err(`User not found: ${username}`);
          }
          targetUserId = user.id;
        }
        
        if (!targetUserId) {
          return new Err('Could not determine user ID');
        }
        
        // Build update request
        const updateRequest: any = {};
        if (siteRole) updateRequest.siteRole = siteRole;
        if (authSetting) updateRequest.authSetting = authSetting;
        if (email) updateRequest.email = email;
        if (fullName) updateRequest.fullName = fullName;
        
        const updatedUser = await restApi.usersMethods.updateUser(restApi.siteId, targetUserId, updateRequest);
        
        return new Ok({
          success: true,
          user: updatedUser,
          message: `Successfully updated user '${updatedUser.name}'`,
          updatedFields: Object.keys(updateRequest),
        });
      },
    });
  },
});