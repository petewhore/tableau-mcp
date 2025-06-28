import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listPermissionsTool = new Tool({
  name: 'list-permissions',
  description: `
List all permissions for specific content in Tableau Cloud/Server. This shows who has access and what level of permissions they have.

**Parameters:**
- \`contentType\`: Type of content to list permissions for (required)
- \`contentId\`: ID of the specific content item (required)
- \`contentName\`: Optional content name for reference (will be looked up if not provided)

**Content Types:**
- \`workbook\`: Tableau workbooks
- \`datasource\`: Published data sources
- \`project\`: Projects (containers for content)
- \`view\`: Individual worksheet views
- \`flow\`: Tableau Prep flows

**Permission Information:**
- **Grantee Details**: User or group with permissions
- **Permission Type**: Specific capability granted
- **Permission Mode**: Allow or Deny
- **Inheritance**: Whether permissions come from project or explicit grants

**Permission Categories:**
- **View**: Read, Filter, ViewComments, AddComments, ExportImage, ShareView
- **Authoring**: ExportData, ViewUnderlyingData, Write, CreateRefreshMetrics
- **Administrative**: ChangeHierarchy, Delete, ChangePermissions

**Example Usage:**
- List workbook permissions: \`{ "contentType": "workbook", "contentId": "wb-123" }\`
- Check data source access: \`{ "contentType": "datasource", "contentId": "ds-789", "contentName": "Sales Data" }\`
- Audit project permissions: \`{ "contentType": "project", "contentId": "proj-456" }\`

**Use Cases:**
- Security auditing and compliance
- Troubleshooting access issues
- Planning permission changes
- Understanding current access patterns
- Documenting permission structures
- Identifying unused or excessive permissions

**Best Practices:**
- Regular permission audits for security
- Document business justification for administrative permissions
- Review permissions after organizational changes
- Monitor for permission drift over time
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'project', 'view', 'flow']),
    contentId: z.string().min(1, 'Content ID is required'),
    contentName: z.string().optional(),
  },
  annotations: {
    title: 'List Permissions',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ contentType, contentId, contentName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listPermissionsTool.logAndExecute({
      requestId,
      args: { contentType, contentId, contentName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate content exists and get name if not provided
          let resolvedContentName = contentName || 'Unknown';
          try {
            switch (contentType) {
              case 'workbook':
                const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                resolvedContentName = workbook.name;
                break;
              case 'datasource':
                const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                resolvedContentName = datasource.name;
                break;
              case 'project':
                const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${contentId}`);
                resolvedContentName = projects.projects[0]?.name || 'Unknown';
                break;
              // Note: view and flow would require additional API methods
            }
          } catch (error) {
            // Continue with permission listing even if we can't get the name
          }
          
          // Get all permissions for the content
          const permissions = await restApi.permissionsMethods.listContentPermissions(
            restApi.siteId,
            contentType,
            contentId
          );
          
          // Analyze permission structure
          const userPermissions = permissions.filter(p => p.grantee.type === 'user');
          const groupPermissions = permissions.filter(p => p.grantee.type === 'group');
          
          // Count permission types
          const allGrantedPerms = permissions.flatMap(p => p.permissions.filter(perm => perm.mode === 'Allow'));
          const allDeniedPerms = permissions.flatMap(p => p.permissions.filter(perm => perm.mode === 'Deny'));
          
          // Categorize permissions
          const viewPermissions = ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ShareView'];
          const authoringPermissions = ['ExportData', 'ViewUnderlyingData', 'Write', 'CreateRefreshMetrics'];
          const adminPermissions = ['ChangeHierarchy', 'Delete', 'ChangePermissions'];
          
          const permissionsByCategory = {
            view: allGrantedPerms.filter(p => viewPermissions.includes(p.permission)).length,
            authoring: allGrantedPerms.filter(p => authoringPermissions.includes(p.permission)).length,
            admin: allGrantedPerms.filter(p => adminPermissions.includes(p.permission)).length,
          };
          
          // Identify permission levels
          const granteeAnalysis = permissions.map(p => {
            const allowedPerms = p.permissions.filter(perm => perm.mode === 'Allow');
            const deniedPerms = p.permissions.filter(perm => perm.mode === 'Deny');
            
            const hasRead = allowedPerms.some(perm => perm.permission === 'Read');
            const hasWrite = allowedPerms.some(perm => perm.permission === 'Write');
            const hasAdmin = allowedPerms.some(perm => adminPermissions.includes(perm.permission));
            
            let accessLevel = 'None';
            if (hasAdmin) accessLevel = 'Administrator';
            else if (hasWrite) accessLevel = 'Author/Editor';
            else if (hasRead) accessLevel = 'Viewer';
            
            return {
              grantee: p.grantee,
              accessLevel,
              totalPermissions: p.permissions.length,
              allowedPermissions: allowedPerms.length,
              deniedPermissions: deniedPerms.length,
              hasRestrictiveDenials: deniedPerms.length > 0,
              permissions: p.permissions,
            };
          });
          
          return new Ok({
            success: true,
            content: {
              type: contentType,
              id: contentId,
              name: resolvedContentName,
            },
            permissions: permissions.map(p => ({
              grantee: {
                id: p.grantee.id,
                name: p.grantee.name,
                type: p.grantee.type,
              },
              permissions: p.permissions.map(perm => ({
                permission: perm.permission,
                mode: perm.mode,
              })),
            })),
            summary: {
              totalGrantees: permissions.length,
              userGrantees: userPermissions.length,
              groupGrantees: groupPermissions.length,
              totalAllowPermissions: allGrantedPerms.length,
              totalDenyPermissions: allDeniedPerms.length,
              hasRestrictivePermissions: allDeniedPerms.length > 0,
            },
            analysis: {
              permissionsByCategory,
              granteeAnalysis,
              securityRisk: (() => {
                const hasPublicRead = permissions.some(p => 
                  p.grantee.name.toLowerCase().includes('all') && 
                  p.permissions.some(perm => perm.permission === 'Read' && perm.mode === 'Allow')
                );
                const hasAdminAccess = permissions.some(p => 
                  p.permissions.some(perm => adminPermissions.includes(perm.permission) && perm.mode === 'Allow')
                );
                
                if (hasPublicRead) return 'High - Public Access';
                if (hasAdminAccess) return 'Medium - Administrative Access Present';
                return 'Low - Standard Permissions';
              })(),
              accessDistribution: {
                administrators: granteeAnalysis.filter(g => g.accessLevel === 'Administrator').length,
                authors: granteeAnalysis.filter(g => g.accessLevel === 'Author/Editor').length,
                viewers: granteeAnalysis.filter(g => g.accessLevel === 'Viewer').length,
                noAccess: granteeAnalysis.filter(g => g.accessLevel === 'None').length,
              },
            },
            message: `Found ${permissions.length} permission grants for ${contentType} '${resolvedContentName}'`,
            recommendations: {
              ...(allDeniedPerms.length > 0 ? 
                { denyPermissions: 'Review explicit deny permissions - they override any allow permissions' } : {}),
              ...(groupPermissions.length === 0 ? 
                { groupManagement: 'Consider using groups instead of individual user permissions for easier management' } : {}),
              ...(granteeAnalysis.filter(g => g.accessLevel === 'Administrator').length > 3 ? 
                { adminAccess: 'Consider reducing the number of users with administrative permissions' } : {}),
              regularAudit: 'Regularly audit permissions to ensure they align with current business needs',
              leastPrivilege: 'Follow principle of least privilege - grant minimum necessary permissions',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list permissions: ${error}`);
        }
      },
    });
  },
});