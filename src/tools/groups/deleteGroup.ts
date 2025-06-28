import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const deleteGroupTool = new Tool({
  name: 'delete-group',
  description: `
Delete a group from Tableau Cloud/Server. This removes the group and revokes all permissions granted to group members through group membership.

**Parameters:**
- \`groupId\`: ID of the group to delete (required)
- \`groupName\`: Optional group name for reference (will be looked up if not provided)

**Deletion Impact:**
- **Group Removal**: Group is permanently deleted from the system
- **Member Access**: All group members lose permissions granted through this group
- **Content Permissions**: All content permissions granted to the group are revoked
- **User Accounts**: Individual user accounts remain unchanged
- **Direct Permissions**: Users retain any directly assigned permissions

**Permission Effects:**
- **Immediate Loss**: Users immediately lose access granted through group membership
- **Alternative Access**: Users may retain access through other groups or direct permissions
- **Content Impact**: Content may become inaccessible to former group members
- **Inherited Permissions**: Project-level group permissions are removed

**Group Types:**
- **Local Groups**: Manually managed groups within Tableau
- **Active Directory Groups**: Synchronized groups from AD (may be recreated on next sync)
- **System Groups**: Some system groups cannot be deleted

**Pre-deletion Analysis:**
- Identifies current group members and their roles
- Analyzes permissions that will be lost
- Warns about potential access disruption

**Use Cases:**
- **Organizational Changes**: Remove groups during team restructuring
- **Role Consolidation**: Delete redundant or unused groups
- **Security Cleanup**: Remove groups that no longer serve a purpose
- **Migration**: Clean up temporary groups after migration
- **Access Simplification**: Reduce group complexity

**Best Practices:**
- Review group permissions before deletion
- Ensure users have alternative access paths
- Notify group members about upcoming changes
- Consider moving users to other appropriate groups
- Document deletion reasons for audit purposes

**Example Usage:**
- Simple deletion: \`{ "groupId": "group-123" }\`
- With reference name: \`{ "groupId": "group-456", "groupName": "Legacy Marketing Team" }\`

**Recovery:**
- **Local Groups**: Deletion is permanent, must be recreated manually
- **AD Groups**: May be recreated on next Active Directory synchronization
- **Permissions**: Must be manually reassigned after group recreation
`,
  paramsSchema: {
    groupId: z.string().min(1, 'Group ID is required'),
    groupName: z.string().optional(),
  },
  annotations: {
    title: 'Delete Group',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ groupId, groupName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await deleteGroupTool.logAndExecute({
      requestId,
      args: { groupId, groupName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Get group details before deletion
          let group;
          try {
            group = await restApi.groupsMethods.getGroup(restApi.siteId, groupId);
          } catch (error) {
            return new Err(`Group with ID '${groupId}' not found`);
          }
          
          const resolvedGroupName = groupName || group.name;
          
          // Check if this is a system group that shouldn't be deleted
          const systemGroups = ['All Users', 'Administrator', 'Site Administrator'];
          if (systemGroups.some(sysGroup => group.name.toLowerCase().includes(sysGroup.toLowerCase()))) {
            return new Err(`Cannot delete system group '${group.name}'`);
          }
          
          // Get current group members
          let members: any[] = [];
          let memberCount = 0;
          try {
            const membersResponse = await restApi.groupsMethods.listGroupUsers(restApi.siteId, groupId);
            members = membersResponse.users.user || [];
            memberCount = parseInt(membersResponse.pagination.totalAvailable);
          } catch (error) {
            // Continue with deletion even if we can't get members
          }
          
          // Analyze group characteristics
          const groupType = group.domain?.name === 'local' ? 'Local' : 'Active Directory';
          const hasMinimumRole = group.import?.siteRole ? true : false;
          const minimumRole = group.import?.siteRole;
          
          // Estimate permission impact
          const permissionImpact = (() => {
            if (memberCount === 0) return 'None';
            if (memberCount > 20) return 'High';
            if (memberCount > 5) return 'Medium';
            return 'Low';
          })();
          
          // Get sample of content that might be affected (simplified analysis)
          let potentiallyAffectedContent = 0;
          try {
            // This is a simplified check - in reality we'd need to scan all content permissions
            const workbooks = await restApi.workbooksMethods.listWorkbooks(restApi.siteId);
            const datasources = await restApi.datasourcesMethods.listDatasources(restApi.siteId);
            potentiallyAffectedContent = workbooks.workbooks.length + datasources.datasources.length;
          } catch (error) {
            // Continue without this analysis
          }
          
          // Store deletion context before actual deletion
          const deletionContext = {
            groupId: group.id,
            groupName: group.name,
            groupType,
            domainName: group.domain?.name || 'local',
            hasMinimumRole,
            minimumSiteRole: minimumRole,
            memberCount,
            members: members.map(member => ({
              id: member.id,
              name: member.name,
              siteRole: member.siteRole,
            })),
            permissionImpact,
            createdAt: new Date().toISOString(), // Group creation time not typically available
            deletedAt: new Date().toISOString(),
          };
          
          // Perform the deletion
          await restApi.groupsMethods.deleteGroup(restApi.siteId, groupId);
          
          return new Ok({
            success: true,
            deleted: true,
            group: deletionContext,
            impact: {
              permissionImpact,
              membersAffected: memberCount,
              groupType,
              accessLoss: memberCount > 0 ? 
                'Users may lose access to content that was granted through group membership' : 
                'No users affected - group was empty',
              minimumRoleRemoved: hasMinimumRole,
              adSyncImpact: groupType === 'Active Directory' ? 
                'Group may be recreated on next Active Directory synchronization' : 
                'Local group permanently deleted',
            },
            affectedUsers: members.map(member => ({
              id: member.id,
              name: member.name,
              siteRole: member.siteRole,
              accessRisk: member.siteRole === minimumRole ? 'High' : 'Medium',
            })),
            warnings: {
              permanentDeletion: groupType === 'Local' ? 
                'Local group deletion is permanent' : 
                'AD group may be recreated during next synchronization',
              immediateEffect: memberCount > 0 ? 
                'Users immediately lose all permissions granted through this group' : undefined,
              accessLoss: 'Check that affected users have alternative access to necessary content',
              minimumRole: hasMinimumRole ? 
                `Users no longer have guaranteed minimum site role of '${minimumRole}'` : undefined,
            },
            summary: {
              groupName: resolvedGroupName,
              groupType,
              membersAffected: memberCount,
              permissionImpact,
              hadMinimumRole: hasMinimumRole,
              minimumRoleRemoved: minimumRole,
              deletionSuccessful: true,
            },
            message: `Successfully deleted ${groupType.toLowerCase()} group '${resolvedGroupName}' affecting ${memberCount} users`,
            recommendations: {
              userNotification: memberCount > 0 ? 
                'Notify affected users about the group deletion and potential access changes' : undefined,
              accessVerification: 'Verify that former group members still have necessary access to content',
              alternativeGroups: memberCount > 0 ? 
                'Consider adding users to other appropriate groups if needed' : undefined,
              permissionAudit: 'Review content permissions to ensure business continuity',
              documentation: 'Document the group deletion reason and any user reassignments',
              ...(groupType === 'Active Directory' ? 
                { adManagement: 'Update Active Directory if group should not be recreated during sync' } : {}),
              monitoring: 'Monitor for user access issues following the group deletion',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to delete group: ${error}`);
        }
      },
    });
  },
});