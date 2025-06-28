import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const removeUserFromGroupTool = new Tool({
  name: 'remove-user-from-group',
  description: `
Remove a user from a group in Tableau Cloud/Server. This revokes all permissions that the user inherited from the group.

**Parameters:**
- \`groupId\`: ID of the group to remove the user from (required)
- \`userId\`: ID of the user to remove from the group (required)
- \`groupName\`: Optional group name for reference (will be looked up if not provided)
- \`userName\`: Optional user name for reference (will be looked up if not provided)

**Impact of Removal:**
- User loses all permissions inherited from the group
- User retains permissions from other groups they belong to
- User retains direct permissions granted to their account
- Content access may be immediately affected

**Permission Considerations:**
- Review user's remaining permissions after removal
- Ensure user has necessary access through other groups or direct permissions
- Consider impact on shared content and dashboards
- Document permission changes for audit purposes

**Active Directory Groups:**
- Local group changes are permanent until manually modified
- AD group membership may be restored by directory sync
- Manual removal from AD groups may be overridden

**Example Usage:**
- Simple removal: \`{ "groupId": "group-123", "userId": "user-456" }\`
- With names for clarity: \`{ "groupId": "group-123", "userId": "user-456", "groupName": "Marketing Team", "userName": "john.doe" }\`

**Best Practices:**
- Verify user is currently a member before removal
- Check user's remaining access after removal
- Consider temporary permission grants if needed during transitions
- Use with caution for users with critical content dependencies
- Document organizational changes that trigger membership changes

**Use Cases:**
- Team reorganization and role changes
- Offboarding users from specific projects
- Removing temporary access grants
- Implementing least-privilege access policies
- Responding to security incidents
`,
  paramsSchema: {
    groupId: z.string().min(1, 'Group ID is required'),
    userId: z.string().min(1, 'User ID is required'),
    groupName: z.string().optional(),
    userName: z.string().optional(),
  },
  annotations: {
    title: 'Remove User from Group',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ groupId, userId, groupName, userName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await removeUserFromGroupTool.logAndExecute({
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
          
          // Check if user is currently in the group
          let isMember = false;
          let membersBefore = 0;
          try {
            const existingUsers = await restApi.groupsMethods.listGroupUsers(restApi.siteId, groupId);
            membersBefore = parseInt(existingUsers.pagination.totalAvailable);
            isMember = existingUsers.users.user.some(u => u.id === userId);
            
            if (!isMember) {
              return new Err(`User '${user.name}' is not a member of group '${group.name}'`);
            }
          } catch (error) {
            // Continue even if we can't check membership
          }
          
          // Get user's other groups before removal
          let otherGroups: string[] = [];
          try {
            const userGroups = await restApi.groupsMethods.getUserGroups(restApi.siteId, userId);
            otherGroups = userGroups.groups.group
              .filter(g => g.id !== groupId)
              .map(g => g.name);
          } catch (error) {
            // Continue without other groups info
          }
          
          // Remove user from group
          await restApi.groupsMethods.removeUserFromGroup(restApi.siteId, groupId, userId);
          
          // Get updated group membership count
          let membersAfter = 0;
          try {
            const groupUsers = await restApi.groupsMethods.listGroupUsers(restApi.siteId, groupId);
            membersAfter = parseInt(groupUsers.pagination.totalAvailable);
          } catch (error) {
            membersAfter = Math.max(0, membersBefore - 1);
          }
          
          // Analyze group and user details
          const groupType = group.domain?.name === 'local' ? 'Local' : 'Active Directory';
          const hasMinimumRole = group.import?.siteRole ? true : false;
          const hasOtherGroups = otherGroups.length > 0;
          
          return new Ok({
            success: true,
            membership: {
              groupId: group.id,
              groupName: group.name,
              userId: user.id,
              userName: user.name,
              userSiteRole: user.siteRole,
              groupType,
              groupDomain: group.domain?.name || 'local',
            },
            summary: {
              membershipRemoved: true,
              totalGroupMembersBefore: membersBefore,
              totalGroupMembersAfter: membersAfter,
              hasMinimumRole,
              minimumSiteRole: group.import?.siteRole,
              userHasOtherGroups: hasOtherGroups,
              otherGroupCount: otherGroups.length,
            },
            details: {
              groupId: group.id,
              userId: user.id,
              removedUserName: user.name,
              removedUserSiteRole: user.siteRole,
              remainingGroups: otherGroups,
              isLocalGroup: groupType === 'Local',
              isADGroup: groupType === 'Active Directory',
            },
            message: `Successfully removed user '${user.name}' from ${groupType.toLowerCase()} group '${group.name}'`,
            warnings: {
              ...(groupType === 'Active Directory' ? 
                { adGroup: 'AD group membership may be restored by directory synchronization' } : {}),
              ...(otherGroups.length === 0 ? 
                { noGroups: 'User is no longer a member of any groups - verify direct permissions exist' } : {}),
              permissionLoss: 'User has lost all permissions inherited from this group',
            },
            recommendations: {
              ...(otherGroups.length === 0 ? 
                { checkPermissions: 'Verify user has sufficient direct permissions or belongs to other appropriate groups' } : {}),
              ...(hasMinimumRole ? 
                { roleCheck: `User may need direct site role assignment if no longer meeting minimum role from groups` } : {}),
              accessReview: 'Review user\'s remaining access to ensure business continuity',
              ...(membersAfter === 0 ? 
                { emptyGroup: 'Group is now empty - consider if group is still needed' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to remove user from group: ${error}`);
        }
      },
    });
  },
});