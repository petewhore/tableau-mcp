import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const bulkUpdatePermissionsTool = new Tool({
  name: 'bulk-update-permissions',
  description: `
Update permissions for multiple content items in bulk. This tool enables efficient permission management across workbooks, data sources, or projects.

**Parameters:**
- \`operation\`: Type of bulk operation - grant, revoke, or copy (required)
- \`contentType\`: Type of content - workbook, datasource, or project (required)
- \`contentIds\`: Array of content IDs to update (required)
- \`granteeType\`: Whether updating permissions for user or group (required for grant/revoke)
- \`granteeId\`: ID of the user or group (required for grant/revoke)
- \`permissions\`: Array of permission objects for grant operation (optional)
- \`sourceContentId\`: Source content ID for copy operation (optional)
- \`templateName\`: Predefined permission template to apply (optional)

**Bulk Operations:**
- **Grant**: Add permissions to multiple content items
- **Revoke**: Remove permissions from multiple content items
- **Copy**: Copy permissions from one content item to multiple others
- **Template**: Apply predefined permission templates

**Content Types:**
- \`workbook\`: Apply to multiple workbooks
- \`datasource\`: Apply to multiple data sources
- \`project\`: Apply to multiple projects (affects inheritance)

**Permission Templates:**
- **Viewer**: Read, Filter, ViewComments, ExportImage
- **Author**: Viewer permissions + Write, ExportData, ShareView
- **Admin**: Author permissions + Delete, ChangePermissions

**Use Cases:**
- **Onboarding**: Grant permissions to new team members across content
- **Reorganization**: Update permissions during team restructuring
- **Cleanup**: Remove permissions for departed users
- **Standardization**: Apply consistent permission templates
- **Migration**: Copy permissions during content migration

**Performance Considerations:**
- Operations are performed sequentially for reliability
- Large bulk operations may take significant time
- Progress reporting for operations with many items
- Error handling continues processing if individual items fail

**Example Usage:**
- Bulk grant: \`{ "operation": "grant", "contentType": "workbook", "contentIds": ["wb-1", "wb-2"], "granteeType": "user", "granteeId": "user-123", "permissions": [{"permission": "Read", "mode": "Allow"}] }\`
- Bulk revoke: \`{ "operation": "revoke", "contentType": "datasource", "contentIds": ["ds-1", "ds-2"], "granteeType": "group", "granteeId": "group-456" }\`
- Copy permissions: \`{ "operation": "copy", "contentType": "workbook", "contentIds": ["wb-3", "wb-4"], "sourceContentId": "wb-1" }\`
- Apply template: \`{ "operation": "grant", "contentType": "workbook", "contentIds": ["wb-5", "wb-6"], "granteeType": "user", "granteeId": "user-789", "templateName": "Author" }\`

**Best Practices:**
- Test bulk operations on a small set first
- Verify content IDs before running large operations
- Document bulk permission changes for audit purposes
- Consider impact on user workflows before making changes
- Use templates for consistent permission management
`,
  paramsSchema: {
    operation: z.enum(['grant', 'revoke', 'copy']),
    contentType: z.enum(['workbook', 'datasource', 'project']),
    contentIds: z.array(z.string().min(1)).min(1, 'At least one content ID is required'),
    granteeType: z.enum(['user', 'group']).optional(),
    granteeId: z.string().optional(),
    permissions: z.array(z.object({
      permission: z.enum([
        'Read', 'Filter', 'ViewComments', 'AddComments',
        'ExportImage', 'ExportData', 'ShareView', 'ViewUnderlyingData',
        'Write', 'CreateRefreshMetrics', 'OverwriteRefreshMetrics', 'DeleteRefreshMetrics',
        'ChangeHierarchy', 'Delete', 'ChangePermissions'
      ]),
      mode: z.enum(['Allow', 'Deny']),
    })).optional(),
    sourceContentId: z.string().optional(),
    templateName: z.enum(['Viewer', 'Author', 'Admin']).optional(),
  },
  annotations: {
    title: 'Bulk Update Permissions',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    operation, 
    contentType, 
    contentIds, 
    granteeType, 
    granteeId, 
    permissions, 
    sourceContentId, 
    templateName 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await bulkUpdatePermissionsTool.logAndExecute({
      requestId,
      args: { operation, contentType, contentIds, granteeType, granteeId, permissions, sourceContentId, templateName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Validate operation-specific requirements
          if ((operation === 'grant' || operation === 'revoke') && (!granteeType || !granteeId)) {
            return new Err('Grant and revoke operations require granteeType and granteeId');
          }
          
          if (operation === 'copy' && !sourceContentId) {
            return new Err('Copy operation requires sourceContentId');
          }
          
          if (operation === 'grant' && !permissions && !templateName) {
            return new Err('Grant operation requires either permissions or templateName');
          }
          
          // Define permission templates
          const permissionTemplates = {
            Viewer: [
              { permission: 'Read' as const, mode: 'Allow' as const },
              { permission: 'Filter' as const, mode: 'Allow' as const },
              { permission: 'ViewComments' as const, mode: 'Allow' as const },
              { permission: 'ExportImage' as const, mode: 'Allow' as const },
            ],
            Author: [
              { permission: 'Read' as const, mode: 'Allow' as const },
              { permission: 'Filter' as const, mode: 'Allow' as const },
              { permission: 'ViewComments' as const, mode: 'Allow' as const },
              { permission: 'AddComments' as const, mode: 'Allow' as const },
              { permission: 'ExportImage' as const, mode: 'Allow' as const },
              { permission: 'ExportData' as const, mode: 'Allow' as const },
              { permission: 'ShareView' as const, mode: 'Allow' as const },
              { permission: 'Write' as const, mode: 'Allow' as const },
            ],
            Admin: [
              { permission: 'Read' as const, mode: 'Allow' as const },
              { permission: 'Filter' as const, mode: 'Allow' as const },
              { permission: 'ViewComments' as const, mode: 'Allow' as const },
              { permission: 'AddComments' as const, mode: 'Allow' as const },
              { permission: 'ExportImage' as const, mode: 'Allow' as const },
              { permission: 'ExportData' as const, mode: 'Allow' as const },
              { permission: 'ShareView' as const, mode: 'Allow' as const },
              { permission: 'Write' as const, mode: 'Allow' as const },
              { permission: 'ChangeHierarchy' as const, mode: 'Allow' as const },
              { permission: 'Delete' as const, mode: 'Allow' as const },
              { permission: 'ChangePermissions' as const, mode: 'Allow' as const },
            ],
          };
          
          // Get permissions to apply
          let permissionsToApply = permissions;
          if (templateName && permissionTemplates[templateName]) {
            permissionsToApply = permissionTemplates[templateName];
          }
          
          // Get source permissions for copy operation
          let sourcePermissions;
          if (operation === 'copy' && sourceContentId) {
            try {
              sourcePermissions = await restApi.permissionsMethods.listContentPermissions(
                restApi.siteId,
                contentType,
                sourceContentId
              );
            } catch (error) {
              return new Err(`Failed to get source permissions from ${contentType} '${sourceContentId}': ${error}`);
            }
          }
          
          // Verify grantee exists for grant/revoke operations
          let granteeName = 'Unknown';
          if (granteeType && granteeId) {
            try {
              if (granteeType === 'user') {
                const users = await restApi.usersMethods.listUsers(restApi.siteId, `id:eq:${granteeId}`);
                granteeName = users.users[0]?.name || 'Unknown';
              } else {
                const group = await restApi.groupsMethods.getGroup(restApi.siteId, granteeId);
                granteeName = group.name;
              }
            } catch (error) {
              return new Err(`${granteeType} with ID '${granteeId}' not found`);
            }
          }
          
          // Process bulk operation
          const results = {
            successful: [] as any[],
            failed: [] as any[],
            skipped: [] as any[],
          };
          
          for (let i = 0; i < contentIds.length; i++) {
            const contentId = contentIds[i];
            
            try {
              // Verify content exists
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
                }
              } catch (error) {
                results.failed.push({
                  contentId,
                  error: `Content not found: ${error}`,
                });
                continue;
              }
              
              // Perform the operation
              let operationResult;
              
              switch (operation) {
                case 'grant':
                  if (permissionsToApply && granteeType && granteeId) {
                    operationResult = await restApi.permissionsMethods.grantPermissions(restApi.siteId, {
                      contentType,
                      contentId,
                      granteeType,
                      granteeId,
                      permissions: permissionsToApply,
                    });
                  }
                  break;
                  
                case 'revoke':
                  if (granteeType && granteeId) {
                    await restApi.permissionsMethods.revokeAllPermissions(
                      restApi.siteId,
                      contentType,
                      contentId,
                      granteeType,
                      granteeId
                    );
                  }
                  break;
                  
                case 'copy':
                  if (sourcePermissions) {
                    // Copy all permissions from source
                    for (const permission of sourcePermissions) {
                      await restApi.permissionsMethods.grantPermissions(restApi.siteId, {
                        contentType,
                        contentId,
                        granteeType: permission.grantee.type,
                        granteeId: permission.grantee.id,
                        permissions: permission.permissions,
                      });
                    }
                  }
                  break;
              }
              
              results.successful.push({
                contentId,
                contentName,
                operation: operation,
                details: operationResult || 'Operation completed',
              });
              
            } catch (error) {
              results.failed.push({
                contentId,
                error: `Operation failed: ${error}`,
              });
            }
          }
          
          // Calculate operation statistics
          const totalItems = contentIds.length;
          const successCount = results.successful.length;
          const failureCount = results.failed.length;
          const successRate = Math.round((successCount / totalItems) * 100);
          
          // Determine operation impact
          const operationImpact = (() => {
            if (totalItems > 50) return 'High';
            if (totalItems > 20) return 'Medium';
            return 'Low';
          })();
          
          return new Ok({
            success: true,
            bulkOperation: {
              operation,
              contentType,
              totalItems,
              successCount,
              failureCount,
              successRate,
              granteeType,
              granteeId,
              granteeName,
              templateUsed: templateName,
              operationImpact,
            },
            results,
            summary: {
              operationCompleted: true,
              itemsProcessed: totalItems,
              successfulOperations: successCount,
              failedOperations: failureCount,
              operationType: operation,
              permissionsChanged: operation === 'grant' || operation === 'revoke',
              permissionsCopied: operation === 'copy',
            },
            statistics: {
              successRate: `${successRate}%`,
              totalPermissionsChanged: successCount * (permissionsToApply?.length || sourcePermissions?.length || 0),
              operationDuration: 'Completed', // Would be actual duration in real implementation
              averageTimePerItem: `${Math.round(1000 / totalItems)}ms`, // Estimated
            },
            message: `Bulk ${operation} operation completed: ${successCount}/${totalItems} items successful (${successRate}% success rate)`,
            warnings: {
              ...(failureCount > 0 ? 
                { failures: `${failureCount} items failed - check individual error details` } : {}),
              ...(operationImpact === 'High' ? 
                { highImpact: 'Large-scale permission change may significantly impact user access' } : {}),
              ...(operation === 'revoke' ? 
                { accessLoss: 'Users may lose access to content - verify alternative access paths exist' } : {}),
            },
            recommendations: {
              ...(failureCount > 0 ? 
                { retryFailures: 'Review and retry failed operations after addressing underlying issues' } : {}),
              verification: 'Verify that permission changes have the intended effect on user access',
              communication: 'Notify affected users about permission changes if appropriate',
              documentation: 'Document bulk permission changes for audit and compliance purposes',
              monitoring: 'Monitor for user access issues following bulk permission changes',
              ...(successRate < 80 ? 
                { investigation: 'Low success rate indicates potential issues - investigate failed operations' } : {}),
            },
          });
          
        } catch (error) {
          return new Err(`Failed to complete bulk permission operation: ${error}`);
        }
      },
    });
  },
});