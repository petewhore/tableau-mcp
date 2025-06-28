import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const revokePermissionsTool = new Tool({
  name: 'revoke-permissions',
  description: `
Revoke permissions from users or groups for Tableau Cloud content. This removes specific permissions while preserving others.

**Parameters:**
- \`contentType\`: Type of content to revoke permissions from (required)
- \`contentId\`: ID of the specific content item (required)
- \`granteeType\`: Whether revoking from 'user' or 'group' (required)
- \`granteeId\`: ID of the user or group (required)
- \`permissions\`: Array of permission names to revoke (required)

**Content Types:**
- \`workbook\`: Tableau workbooks
- \`datasource\`: Published data sources
- \`project\`: Projects (containers for content)
- \`view\`: Individual worksheet views
- \`flow\`: Tableau Prep flows

**Grantee Types:**
- \`user\`: Individual user account
- \`group\`: User group (affects all group members)

**Revokable Permissions:**

**View Permissions:**
- \`Read\`: Remove view access
- \`Filter\`: Remove filtering capability
- \`ViewComments\`: Remove comment viewing
- \`AddComments\`: Remove comment creation
- \`ExportImage\`: Remove image/PDF export
- \`ShareView\`: Remove sharing capability

**Authoring Permissions:**
- \`ExportData\`: Remove data export capability
- \`ViewUnderlyingData\`: Remove raw data access
- \`Write\`: Remove edit capability
- \`CreateRefreshMetrics\`: Remove metrics creation

**Administrative Permissions:**
- \`ChangeHierarchy\`: Remove content moving capability
- \`Delete\`: Remove deletion capability
- \`ChangePermissions\`: Remove permission management

**Important Notes:**
- Revoking only removes explicit permissions, not inherited ones
- Users may still have access through group memberships
- Project-level permissions may still grant access
- Consider using explicit Deny permissions for stronger restrictions

**Example Usage:**
- Remove edit access: \`{ "contentType": "workbook", "contentId": "wb-123", "granteeType": "user", "granteeId": "user-456", "permissions": ["Write"] }\`
- Remove multiple permissions: \`{ "contentType": "datasource", "contentId": "ds-789", "granteeType": "group", "granteeId": "group-012", "permissions": ["Delete", "ChangePermissions"] }\`

**Best Practices:**
- Verify impact before revoking critical permissions
- Consider using Deny permissions instead of revoke for stronger control
- Document permission changes for audit purposes
- Test access after permission changes
- Review group memberships that might grant access
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'project', 'view', 'flow']),
    contentId: z.string().min(1, 'Content ID is required'),
    granteeType: z.enum(['user', 'group']),
    granteeId: z.string().min(1, 'Grantee ID is required'),
    permissions: z.array(z.enum([
      'Read', 'Filter', 'ViewComments', 'AddComments',
      'ExportImage', 'ExportData', 'ShareView', 'ViewUnderlyingData',
      'Write', 'CreateRefreshMetrics', 'OverwriteRefreshMetrics', 'DeleteRefreshMetrics',
      'ChangeHierarchy', 'Delete', 'ChangePermissions'
    ])).min(1, 'At least one permission must be specified'),
  },
  annotations: {
    title: 'Revoke Permissions',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    contentType, 
    contentId, 
    granteeType, 
    granteeId, 
    permissions 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await revokePermissionsTool.logAndExecute({
      requestId,
      args: { contentType, contentId, granteeType, granteeId, permissions },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate content exists
          let contentName = 'Unknown';
          try {
            switch (contentType) {
              case 'workbook':
                const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                contentName = workbook.name;
                break;
              case 'datasource':
                const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                contentName = datasource.name;
                break;
              case 'project':
                const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${contentId}`);
                contentName = projects.projects[0]?.name || 'Unknown';
                break;
              // Note: view and flow validation would require additional API methods
            }
          } catch (error) {
            // Continue with permission revoke even if we can't get the name
          }
          
          // Validate grantee exists
          let granteeName = 'Unknown';
          try {
            if (granteeType === 'user') {
              const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${granteeId}`);
              granteeName = users.users[0]?.name || 'Unknown';
            }
            // Note: group validation would require group API methods
          } catch (error) {
            // Continue with permission revoke even if we can't get the name
          }
          
          // Revoke the permissions
          await restApi.permissionsMethods.revokePermissions(
            restApi.siteId,
            contentType,
            contentId,
            granteeType,
            granteeId,
            permissions
          );
          
          // Analyze revoked permissions impact
          const criticalPermissions = ['Read', 'Write', 'Delete', 'ChangePermissions'];
          const revokedCritical = permissions.filter(p => criticalPermissions.includes(p));
          const revokedBasic = permissions.filter(p => !criticalPermissions.includes(p));
          
          const impactLevel = (() => {
            if (revokedCritical.includes('Read')) return 'Critical - Access Removed';
            if (revokedCritical.includes('Delete') || revokedCritical.includes('ChangePermissions')) return 'High - Administrative Access Reduced';
            if (revokedCritical.includes('Write')) return 'Medium - Edit Access Removed';
            return 'Low - Feature Access Reduced';
          })();
          
          return new Ok({
            success: true,
            permissionRevocation: {
              contentType,
              contentId,
              contentName,
              granteeType,
              granteeId,
              granteeName,
              permissionsRevoked: permissions,
            },
            summary: {
              totalPermissionsRevoked: permissions.length,
              criticalPermissionsRevoked: revokedCritical.length,
              basicPermissionsRevoked: revokedBasic.length,
              impactLevel,
              accessMayRemain: true, // Due to potential group memberships or project permissions
            },
            details: {
              revokedCriticalPermissions: revokedCritical,
              revokedBasicPermissions: revokedBasic,
              hasReadAccess: !revokedCritical.includes('Read'),
              hasEditAccess: !revokedCritical.includes('Write'),
              hasAdminAccess: !revokedCritical.some(p => ['Delete', 'ChangePermissions'].includes(p)),
            },
            message: `Successfully revoked ${permissions.length} permissions from ${granteeType} '${granteeName}' for ${contentType} '${contentName}'`,
            warnings: {
              inheritedAccess: 'User may still have access through group memberships or project-level permissions',
              ...(revokedCritical.includes('Read') ? 
                { accessLoss: 'Read permission revoked - user may lose all access to this content' } : {}),
              ...(granteeType === 'group' ? 
                { groupImpact: 'All members of this group are affected by permission revocation' } : {}),
            },
            recommendations: {
              accessVerification: 'Verify user access after revocation to ensure intended restrictions',
              ...(revokedCritical.length > 0 ? 
                { considerDeny: 'Consider using explicit Deny permissions for stronger restrictions' } : {}),
              groupReview: 'Review group memberships if user should not have any access',
              ...(revokedCritical.includes('Read') ? 
                { alternativeAccess: 'Ensure user has alternative access paths if needed for business continuity' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to revoke permissions: ${error}`);
        }
      },
    });
  },
});