import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listContentPermissionsTool = new Tool({
  name: 'list-content-permissions',
  description: `
List permissions for a specific piece of content (workbook, data source, or project) in Tableau Cloud/Server.

**Parameters:**
- \`contentType\`: Type of content - workbook, datasource, or project (required)
- \`contentId\`: ID of the content item (required)
- \`includeInherited\`: Include inherited permissions from parent projects (optional, default: true)
- \`includeDetails\`: Include detailed grantee information (optional, default: true)

**Content Types:**
- **Workbook**: Permissions for a specific workbook
- **Data Source**: Permissions for a published data source
- **Project**: Permissions for a project (affects inheritance)

**Permission Types:**
- **Direct**: Permissions explicitly set on the content
- **Inherited**: Permissions inherited from parent project
- **Effective**: Combined direct and inherited permissions

**Capability Analysis:**
- **Read Permissions**: View, Filter, ViewComments capabilities
- **Interaction Permissions**: AddComments, ExportImage, ExportData
- **Authoring Permissions**: Write, CreateRefreshMetrics capabilities
- **Administrative Permissions**: Delete, ChangePermissions, ChangeHierarchy

**Grantee Types:**
- **User**: Individual user permissions
- **Group**: Group-based permissions affecting all members

**Example Usage:**
- List workbook permissions: \`{ "contentType": "workbook", "contentId": "wb-123" }\`
- List project permissions: \`{ "contentType": "project", "contentId": "proj-456", "includeInherited": false }\`
- Detailed data source permissions: \`{ "contentType": "datasource", "contentId": "ds-789", "includeDetails": true }\`

**Use Cases:**
- **Permission Auditing**: Review who has access to content
- **Security Analysis**: Identify overprivileged or underprivileged users
- **Compliance Reporting**: Generate access control reports
- **Troubleshooting**: Investigate access issues
- **Permission Planning**: Understand current state before changes
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'project']),
    contentId: z.string().min(1, 'Content ID is required'),
    includeInherited: z.boolean().optional(),
    includeDetails: z.boolean().optional(),
  },
  annotations: {
    title: 'List Content Permissions',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ 
    contentType, 
    contentId, 
    includeInherited = true, 
    includeDetails = true 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listContentPermissionsTool.logAndExecute({
      requestId,
      args: { contentType, contentId, includeInherited, includeDetails },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify content exists and get details
          let contentName = 'Unknown';
          let contentInfo: any = {};
          
          try {
            switch (contentType) {
              case 'workbook':
                const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                contentName = workbook.name;
                contentInfo = {
                  name: workbook.name,
                  projectId: workbook.project?.id,
                  projectName: workbook.project?.name,
                  ownerId: workbook.owner?.id,
                  ownerName: workbook.owner?.name,
                  size: workbook.size,
                  createdAt: workbook.createdAt,
                  updatedAt: workbook.updatedAt,
                };
                break;
              case 'datasource':
                const datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                contentName = datasource.name;
                contentInfo = {
                  name: datasource.name,
                  type: datasource.type,
                  projectId: datasource.project?.id,
                  projectName: datasource.project?.name,
                  ownerId: datasource.owner?.id,
                  ownerName: datasource.owner?.name,
                  hasExtracts: datasource.hasExtracts,
                  isCertified: datasource.isCertified,
                  size: datasource.size,
                  createdAt: datasource.createdAt,
                  updatedAt: datasource.updatedAt,
                };
                break;
              case 'project':
                const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${contentId}`);
                const project = projects.projects[0];
                if (!project) {
                  throw new Error('Project not found');
                }
                contentName = project.name;
                contentInfo = {
                  name: project.name,
                  description: project.description,
                  parentProjectId: project.parentProject?.id,
                  parentProjectName: project.parentProject?.name,
                  createdAt: project.createdAt,
                  updatedAt: project.updatedAt,
                };
                break;
            }
          } catch (error) {
            return new Err(`${contentType} with ID '${contentId}' not found`);
          }
          
          // Get permissions for the content
          const permissions = await restApi.permissionsMethods.listContentPermissions(
            restApi.siteId,
            contentType,
            contentId
          );
          
          // Process and categorize permissions
          const processedPermissions = await Promise.all(permissions.map(async (permission: any) => {
            let granteeDetails: any = {};
            
            if (includeDetails) {
              try {
                if (permission.grantee.type === 'user') {
                  const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${permission.grantee.id}`);
                  const user = users.users[0];
                  if (user) {
                    granteeDetails = {
                      name: user.name,
                      fullName: user.fullName,
                      email: user.email,
                      siteRole: user.siteRole,
                    };
                  }
                } else if (permission.grantee.type === 'group') {
                  const group = await restApi.groupsMethods.getGroup(restApi.siteId, permission.grantee.id);
                  granteeDetails = {
                    name: group.name,
                    domainName: group.domain?.name,
                    minimumSiteRole: group.import?.siteRole,
                  };
                }
              } catch (error) {
                // Continue without detailed info
              }
            }
            
            // Categorize permissions by type
            const readPermissions = permission.permissions.filter((p: any) => 
              ['Read', 'Filter', 'ViewComments'].includes(p.permission));
            const interactionPermissions = permission.permissions.filter((p: any) => 
              ['AddComments', 'ExportImage', 'ExportData', 'ShareView', 'ViewUnderlyingData'].includes(p.permission));
            const authoringPermissions = permission.permissions.filter((p: any) => 
              ['Write', 'CreateRefreshMetrics', 'OverwriteRefreshMetrics', 'DeleteRefreshMetrics'].includes(p.permission));
            const adminPermissions = permission.permissions.filter((p: any) => 
              ['Delete', 'ChangePermissions', 'ChangeHierarchy'].includes(p.permission));
            
            // Calculate permission level
            const permissionLevel = (() => {
              if (adminPermissions.length > 0) return 'Admin';
              if (authoringPermissions.length > 0) return 'Author';
              if (interactionPermissions.length > 0) return 'Interactor';
              if (readPermissions.length > 0) return 'Viewer';
              return 'None';
            })();
            
            return {
              grantee: {
                id: permission.grantee.id,
                type: permission.grantee.type,
                ...granteeDetails,
              },
              permissions: permission.permissions,
              categorizedPermissions: {
                read: readPermissions,
                interaction: interactionPermissions,
                authoring: authoringPermissions,
                admin: adminPermissions,
              },
              permissionLevel,
              totalPermissions: permission.permissions.length,
              allowedPermissions: permission.permissions.filter((p: any) => p.mode === 'Allow').length,
              deniedPermissions: permission.permissions.filter((p: any) => p.mode === 'Deny').length,
            };
          }));
          
          // Analyze permission distribution
          const permissionStats = {
            totalGrantees: processedPermissions.length,
            userPermissions: processedPermissions.filter(p => p.grantee.type === 'user').length,
            groupPermissions: processedPermissions.filter(p => p.grantee.type === 'group').length,
            permissionLevels: {
              admin: processedPermissions.filter(p => p.permissionLevel === 'Admin').length,
              author: processedPermissions.filter(p => p.permissionLevel === 'Author').length,
              interactor: processedPermissions.filter(p => p.permissionLevel === 'Interactor').length,
              viewer: processedPermissions.filter(p => p.permissionLevel === 'Viewer').length,
              none: processedPermissions.filter(p => p.permissionLevel === 'None').length,
            },
            averagePermissionsPerGrantee: processedPermissions.length > 0 ? 
              Math.round(processedPermissions.reduce((sum, p) => sum + p.totalPermissions, 0) / processedPermissions.length) : 0,
          };
          
          // Identify potential security concerns
          const securityAnalysis = {
            hasAdminAccess: permissionStats.permissionLevels.admin > 0,
            multipleAdmins: permissionStats.permissionLevels.admin > 1,
            noPermissions: permissionStats.totalGrantees === 0,
            onlyOwnerAccess: permissionStats.totalGrantees === 1 && processedPermissions[0]?.grantee.id === contentInfo.ownerId,
            broadAccess: permissionStats.totalGrantees > 10,
            conflictingPermissions: processedPermissions.some(p => p.deniedPermissions > 0),
          };
          
          return new Ok({
            success: true,
            content: {
              id: contentId,
              type: contentType,
              name: contentName,
              ...contentInfo,
            },
            permissions: processedPermissions,
            statistics: permissionStats,
            analysis: {
              securityProfile: (() => {
                if (securityAnalysis.noPermissions) return 'Inaccessible';
                if (securityAnalysis.onlyOwnerAccess) return 'Owner Only';
                if (securityAnalysis.broadAccess) return 'Broadly Accessible';
                if (securityAnalysis.hasAdminAccess) return 'Administrative Access';
                return 'Standard Access';
              })(),
              riskLevel: (() => {
                let risk = 0;
                if (securityAnalysis.multipleAdmins) risk += 2;
                if (securityAnalysis.broadAccess) risk += 2;
                if (securityAnalysis.conflictingPermissions) risk += 1;
                if (securityAnalysis.noPermissions) risk += 3;
                
                if (risk >= 5) return 'High';
                if (risk >= 3) return 'Medium';
                return 'Low';
              })(),
              securityConcerns: securityAnalysis,
            },
            summary: {
              contentName,
              contentType,
              totalGrantees: permissionStats.totalGrantees,
              primaryPermissionLevel: Object.entries(permissionStats.permissionLevels)
                .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none',
              hasAdministrativeAccess: securityAnalysis.hasAdminAccess,
              accessibilityLevel: securityAnalysis.noPermissions ? 'None' : 
                                 securityAnalysis.broadAccess ? 'Broad' : 'Limited',
            },
            message: `Found ${permissionStats.totalGrantees} permission entries for ${contentType} '${contentName}'`,
            recommendations: {
              ...(securityAnalysis.noPermissions ? 
                { addPermissions: 'Content has no permissions - add appropriate access for users' } : {}),
              ...(securityAnalysis.multipleAdmins ? 
                { reviewAdmins: 'Multiple administrators detected - verify necessity of admin access' } : {}),
              ...(securityAnalysis.broadAccess ? 
                { accessReview: 'Broad access detected - review if all grantees need access' } : {}),
              ...(securityAnalysis.conflictingPermissions ? 
                { resolveConflicts: 'Conflicting (deny) permissions found - review permission logic' } : {}),
              ...(permissionStats.permissionLevels.admin === 0 && contentType !== 'project' ? 
                { adminAccess: 'Consider designating content administrators for management' } : {}),
              regularAudit: 'Regularly audit permissions to ensure they align with business needs',
              documentation: 'Document permission rationale for compliance and governance',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list permissions: ${error}`);
        }
      },
    });
  },
});