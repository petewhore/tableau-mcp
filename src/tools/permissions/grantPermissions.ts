import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const grantPermissionsTool = new Tool({
  name: 'grant-permissions',
  description: `
Grant permissions to users or groups for Tableau Cloud content. Supports granular permission control across workbooks, data sources, projects, views, and flows.

**Parameters:**
- \`contentType\`: Type of content to grant permissions for (required)
- \`contentId\`: ID of the specific content item (required)
- \`granteeType\`: Whether granting to 'user' or 'group' (required)
- \`granteeId\`: ID of the user or group (required)
- \`permissions\`: Array of permission objects with permission name and mode (required)

**Content Types:**
- \`workbook\`: Tableau workbooks
- \`datasource\`: Published data sources
- \`project\`: Projects (containers for content)
- \`view\`: Individual worksheet views
- \`flow\`: Tableau Prep flows

**Grantee Types:**
- \`user\`: Individual user account
- \`group\`: User group (permissions apply to all group members)

**Permission Modes:**
- \`Allow\`: Grant the permission
- \`Deny\`: Explicitly deny the permission (overrides group permissions)

**Available Permissions:**

**View Permissions:**
- \`Read\`: View content
- \`Filter\`: Apply filters to views
- \`ViewComments\`: See comments on content
- \`AddComments\`: Add comments to content
- \`ExportImage\`: Export images/PDFs
- \`ShareView\`: Share views with others

**Authoring Permissions:**
- \`ExportData\`: Export underlying data
- \`ViewUnderlyingData\`: See raw data behind views
- \`Write\`: Edit content
- \`CreateRefreshMetrics\`: Create and refresh metrics

**Administrative Permissions:**
- \`ChangeHierarchy\`: Move content between projects
- \`Delete\`: Delete content
- \`ChangePermissions\`: Modify permissions

**Permission Examples:**
- View access: \`[{ "permission": "Read", "mode": "Allow" }]\`
- Full authoring: \`[{ "permission": "Read", "mode": "Allow" }, { "permission": "Write", "mode": "Allow" }]\`
- Deny specific action: \`[{ "permission": "Delete", "mode": "Deny" }]\`

**Example Usage:**
- Grant view access: \`{ "contentType": "workbook", "contentId": "wb-123", "granteeType": "user", "granteeId": "user-456", "permissions": [{"permission": "Read", "mode": "Allow"}] }\`
- Grant full permissions: \`{ "contentType": "datasource", "contentId": "ds-789", "granteeType": "group", "granteeId": "group-012", "permissions": [{"permission": "Read", "mode": "Allow"}, {"permission": "Write", "mode": "Allow"}, {"permission": "ChangePermissions", "mode": "Allow"}] }\`

**Best Practices:**
- Start with minimal permissions and add as needed
- Use groups for easier permission management
- Document permission grants for audit purposes
- Test permissions with affected users
- Consider inheritance from project-level permissions
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'project', 'view', 'flow']),
    contentId: z.string().min(1, 'Content ID is required'),
    granteeType: z.enum(['user', 'group']),
    granteeId: z.string().min(1, 'Grantee ID is required'),
    permissions: z.array(z.object({
      permission: z.enum([
        'Read', 'Filter', 'ViewComments', 'AddComments',
        'ExportImage', 'ExportData', 'ShareView', 'ViewUnderlyingData',
        'Write', 'CreateRefreshMetrics', 'OverwriteRefreshMetrics', 'DeleteRefreshMetrics',
        'ChangeHierarchy', 'Delete', 'ChangePermissions'
      ]),
      mode: z.enum(['Allow', 'Deny']),
    })).min(1, 'At least one permission must be specified'),
  },
  annotations: {
    title: 'Grant Permissions',
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
    return await grantPermissionsTool.logAndExecute({
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
            // Continue with permission grant even if we can't get the name
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
            // Continue with permission grant even if we can't get the name
          }
          
          // Grant the permissions
          const result = await restApi.permissionsMethods.grantPermissions(restApi.siteId, {
            contentType,
            contentId,
            granteeType,
            granteeId,
            permissions,
          });
          
          // Analyze granted permissions
          const allowedPermissions = permissions.filter(p => p.mode === 'Allow');
          const deniedPermissions = permissions.filter(p => p.mode === 'Deny');
          
          const permissionLevel = (() => {
            const hasRead = allowedPermissions.some(p => p.permission === 'Read');
            const hasWrite = allowedPermissions.some(p => p.permission === 'Write');
            const hasAdmin = allowedPermissions.some(p => ['Delete', 'ChangePermissions'].includes(p.permission));
            
            if (hasAdmin) return 'Administrative';
            if (hasWrite) return 'Author/Editor';
            if (hasRead) return 'Viewer';
            return 'Custom';
          })();
          
          return new Ok({
            success: true,
            permissionGrant: {
              contentType,
              contentId,
              contentName,
              granteeType,
              granteeId,
              granteeName,
              permissionsGranted: permissions,
            },
            summary: {
              permissionLevel,
              allowedCount: allowedPermissions.length,
              deniedCount: deniedPermissions.length,
              totalPermissions: permissions.length,
            },
            details: {
              allowedPermissions: allowedPermissions.map(p => p.permission),
              deniedPermissions: deniedPermissions.map(p => p.permission),
              hasViewAccess: allowedPermissions.some(p => p.permission === 'Read'),
              hasEditAccess: allowedPermissions.some(p => p.permission === 'Write'),
              hasAdminAccess: allowedPermissions.some(p => ['Delete', 'ChangePermissions'].includes(p.permission)),
            },
            message: `Successfully granted ${permissions.length} permissions to ${granteeType} '${granteeName}' for ${contentType} '${contentName}'`,
            recommendations: {
              ...(deniedPermissions.length > 0 ? 
                { explicitDenials: 'Explicit deny permissions will override any group-level allow permissions' } : {}),
              ...(permissionLevel === 'Administrative' ? 
                { adminAccess: 'Administrative permissions granted - ensure this is intended for security' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to grant permissions: ${error}`);
        }
      },
    });
  },
});