import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const addUserToGroupTool = new Tool({
  name: 'add-user-to-group',
  description: `
Add a user to an existing group in Tableau Cloud/Server. Group membership automatically grants users all permissions assigned to the group.

**Parameters:**
- \`groupId\`: ID of the group to add the user to (required)
- \`userId\`: ID of the user to add to the group (required)
- \`groupName\`: Optional group name for reference (will be looked up if not provided)
- \`userName\`: Optional user name for reference (will be looked up if not provided)

**Group Membership Rules:**
- Users can belong to multiple groups simultaneously
- Group permissions are cumulative (users get all permissions from all groups)
- Active Directory groups sync membership automatically
- Local groups require manual membership management

**Permission Inheritance:**
- Users inherit all permissions granted to their groups
- Explicit user permissions combine with group permissions
- Deny permissions override allow permissions at any level

**Example Usage:**
- Simple addition: \`{ "groupId": "group-123", "userId": "user-456" }\`
- With names for clarity: \`{ "groupId": "group-123", "userId": "user-456", "groupName": "Marketing Team", "userName": "john.doe" }\`

**Best Practices:**
- Verify user and group exist before adding
- Document group membership changes for audit purposes
- Consider using AD groups for automatic membership management
- Review inherited permissions after group changes
- Use descriptive group names to clarify purpose

**Use Cases:**
- Onboarding new team members
- Reorganizing teams and responsibilities
- Granting temporary project access
- Implementing role-based access control
`,
  paramsSchema: {
    groupId: z.string().min(1, 'Group ID is required'),
    userId: z.string().min(1, 'User ID is required'),
    groupName: z.string().optional(),
    userName: z.string().optional(),
  },
  annotations: {
    title: 'Add User to Group',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ groupId, userId, groupName, userName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await addUserToGroupTool.logAndExecute({
      requestId,
      args: { groupId, userId, groupName, userName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify group exists and get details
          let group;
          try {
            group = await restApi.groupsMethods.getGroup(restApi.siteId, groupId);
          } catch (error) {
            return new Err(`Group with ID '${groupId}' not found`);
          }
          
          // Verify user exists
          let user;
          try {
            const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${userId}`);
            user = users.users[0];
            if (!user) {
              return new Err(`User with ID '${userId}' not found`);
            }
          } catch (error) {
            return new Err(`User with ID '${userId}' not found`);
          }
          
          // Check if user is already in the group
          try {
            const existingUsers = await restApi.groupsMethods.listGroupUsers(restApi.siteId, groupId);
            const isAlreadyMember = existingUsers.users.user.some(u => u.id === userId);
            
            if (isAlreadyMember) {
              return new Err(`User '${user.name}' is already a member of group '${group.name}'`);
            }
          } catch (error) {
            // Continue if we can't check membership
          }
          
          // Add user to group
          const addedUser = await restApi.groupsMethods.addUserToGroup(restApi.siteId, groupId, {
            userId,
          });
          
          // Get updated group membership count
          let memberCount = 0;
          try {
            const groupUsers = await restApi.groupsMethods.listGroupUsers(restApi.siteId, groupId);
            memberCount = parseInt(groupUsers.pagination.totalAvailable);
          } catch (error) {
            // Continue without member count
          }
          
          // Analyze group and user details
          const groupType = group.domain?.name === 'local' ? 'Local' : 'Active Directory';
          const hasMinimumRole = group.import?.siteRole ? true : false;
          const userSiteRole = user.siteRole;
          const minimumRole = group.import?.siteRole;
          
          // Check for site role conflicts
          const roleHierarchy = ['Unlicensed', 'Viewer', 'Explorer', 'Creator', 'SiteAdministrator'];
          const userRoleIndex = roleHierarchy.indexOf(userSiteRole);
          const minRoleIndex = minimumRole ? roleHierarchy.indexOf(minimumRole) : -1;
          const roleConflict = minRoleIndex > userRoleIndex;
          
          return new Ok({
            success: true,
            membership: {
              groupId: group.id,
              groupName: group.name,
              userId: addedUser.id,
              userName: addedUser.name,
              userSiteRole: addedUser.siteRole,
              groupType,
              groupDomain: group.domain?.name || 'local',
            },
            summary: {
              membershipAdded: true,
              totalGroupMembers: memberCount,
              hasMinimumRole,
              minimumSiteRole: minimumRole,
              currentUserRole: userSiteRole,
              roleConflict,
            },
            details: {
              groupId: group.id,
              userId: addedUser.id,
              addedUserName: addedUser.name,
              addedUserLocale: addedUser.locale,
              addedUserLanguage: addedUser.language,
              isLocalGroup: groupType === 'Local',
              isADGroup: groupType === 'Active Directory',
            },
            message: `Successfully added user '${addedUser.name}' to ${groupType.toLowerCase()} group '${group.name}'`,
            warnings: {
              ...(roleConflict ? 
                { siteRoleConflict: `User's site role '${userSiteRole}' is lower than group's minimum role '${minimumRole}'` } : {}),
              ...(groupType === 'Active Directory' ? 
                { adGroup: 'AD group membership may be overridden by directory synchronization' } : {}),
            },
            recommendations: {
              ...(roleConflict ? 
                { updateSiteRole: `Consider updating user's site role to '${minimumRole}' or higher` } : {}),
              permissionCheck: 'Review inherited permissions using the list-permissions tool',
              ...(memberCount > 50 ? 
                { largeGroup: 'Consider breaking down large groups for easier management' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to add user to group: ${error}`);
        }
      },
    });
  },
});