import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const deleteUserTool = new Tool({
  name: 'delete-user',
  description: `
Remove a user from Tableau Cloud. You can specify the user by either ID or username. This action permanently removes the user from the site.

**⚠️ Warning:** This action cannot be undone. The user will lose access to all content and their account will be permanently removed from the site.

**Parameters:**
- \`userId\`: ID of the user to delete (use this OR username)
- \`username\`: Name of the user to delete (use this OR userId)

**Important Notes:**
- Content owned by the user will need to be reassigned before deletion
- The user must not be the only site administrator
- Active jobs or schedules associated with the user may be affected
- Consider updating content ownership before deleting users

**Example Usage:**
- Delete user by username: \`{ "username": "john.doe" }\`
- Delete user by ID: \`{ "userId": "user-id-123" }\`

**Best Practices:**
1. Always verify the correct user before deletion
2. Reassign or transfer important content first
3. Consider deactivating instead of deleting for audit purposes
4. Document the reason for user removal
`,
  paramsSchema: {
    userId: z.string().optional(),
    username: z.string().optional(),
  },
  annotations: {
    title: 'Delete User',
    readOnlyHint: false,
    openWorldHint: false,
  },
  argsValidator: (args) => {
    if (!args.userId && !args.username) {
      throw new Error('Either userId or username must be provided');
    }
  },
  callback: async ({ userId, username }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await deleteUserTool.logAndExecute({
      requestId,
      args: { userId, username },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        let targetUserId = userId;
        let targetUsername = username;
        
        // If username provided, find the user ID and get user details
        if (!targetUserId && username) {
          const user = await restApi.usersMethods.getUserByName(restApi.siteId, username);
          if (!user) {
            return new Err(`User not found: ${username}`);
          }
          targetUserId = user.id;
          targetUsername = user.name;
        }
        
        // If userId provided but no username, get user details for confirmation
        if (targetUserId && !targetUsername) {
          try {
            const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${targetUserId}`);
            const user = users.users.find(u => u.id === targetUserId);
            if (user) {
              targetUsername = user.name;
            }
          } catch (error) {
            // Continue with deletion even if we can't get the username
          }
        }
        
        if (!targetUserId) {
          return new Err('Could not determine user ID');
        }
        
        // Perform the deletion
        await restApi.usersMethods.deleteUser(restApi.siteId, targetUserId);
        
        return new Ok({
          success: true,
          message: `Successfully deleted user '${targetUsername || targetUserId}'`,
          deletedUser: {
            id: targetUserId,
            name: targetUsername || 'Unknown',
          },
          warning: 'User has been permanently removed from the site. This action cannot be undone.',
        });
      },
    });
  },
});