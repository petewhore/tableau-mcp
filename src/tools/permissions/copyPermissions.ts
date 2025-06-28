import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const copyPermissionsTool = new Tool({
  name: 'copy-permissions',
  description: `
Copy permissions from one content item to another in Tableau Cloud/Server. This enables consistent permission management across similar content.

**Parameters:**
- \`sourceContentType\`: Type of source content - workbook, datasource, or project (required)
- \`sourceContentId\`: ID of the source content item (required)
- \`targetContentType\`: Type of target content - workbook, datasource, or project (required)
- \`targetContentId\`: ID of the target content item (required)
- \`copyMode\`: How to handle existing permissions - replace, merge, or additive (optional, default: replace)
- \`includeInherited\`: Copy inherited permissions as direct permissions (optional, default: false)

**Copy Modes:**
- **Replace**: Remove all existing permissions and copy source permissions
- **Merge**: Keep existing permissions and add missing permissions from source
- **Additive**: Keep existing permissions and add all source permissions (may create duplicates)

**Content Type Compatibility:**
- **Same Type**: All permissions are compatible (workbook to workbook)
- **Cross Type**: Only common permissions are copied (workbook to datasource)
- **Project Target**: All permissions become project-level (affects inheritance)

**Permission Mapping:**
- **Common Permissions**: Read, Filter, ViewComments, AddComments, ExportImage, ExportData
- **Authoring Permissions**: Write capabilities (when applicable)
- **Administrative Permissions**: Delete, ChangePermissions (when applicable)

**Inheritance Handling:**
- **Direct Permissions**: Explicitly set permissions on content
- **Inherited Permissions**: Can be copied as direct permissions to target
- **Project Permissions**: Copied permissions may inherit to child content

**Example Usage:**
- Same type copy: \`{ "sourceContentType": "workbook", "sourceContentId": "wb-123", "targetContentType": "workbook", "targetContentId": "wb-456" }\`
- Cross type copy: \`{ "sourceContentType": "workbook", "sourceContentId": "wb-123", "targetContentType": "datasource", "targetContentId": "ds-456" }\`
- Merge permissions: \`{ "sourceContentType": "workbook", "sourceContentId": "wb-123", "targetContentType": "workbook", "targetContentId": "wb-456", "copyMode": "merge" }\`
- Include inherited: \`{ "sourceContentType": "project", "sourceContentId": "proj-123", "targetContentType": "project", "targetContentId": "proj-456", "includeInherited": true }\`

**Use Cases:**
- **Content Templates**: Apply standard permissions to new content
- **Migration**: Maintain permissions when moving content
- **Standardization**: Ensure consistent access across similar content
- **Bulk Setup**: Quickly configure permissions for new projects
- **Permission Backup**: Copy permissions before making changes

**Best Practices:**
- Test permission copying on non-critical content first
- Verify that copied permissions are appropriate for target content
- Review permission compatibility between different content types
- Document permission copying for audit purposes
`,
  paramsSchema: {
    sourceContentType: z.enum(['workbook', 'datasource', 'project']),
    sourceContentId: z.string().min(1, 'Source content ID is required'),
    targetContentType: z.enum(['workbook', 'datasource', 'project']),
    targetContentId: z.string().min(1, 'Target content ID is required'),
    copyMode: z.enum(['replace', 'merge', 'additive']).optional(),
    includeInherited: z.boolean().optional(),
  },
  annotations: {
    title: 'Copy Permissions',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    sourceContentType, 
    sourceContentId, 
    targetContentType, 
    targetContentId, 
    copyMode = 'replace',
    includeInherited = false 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await copyPermissionsTool.logAndExecute({
      requestId,
      args: { sourceContentType, sourceContentId, targetContentType, targetContentId, copyMode, includeInherited },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify both source and target content exist
          let sourceContentName = 'Unknown';
          let targetContentName = 'Unknown';
          
          try {
            switch (sourceContentType) {
              case 'workbook':
                const sourceWorkbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, sourceContentId);
                sourceContentName = sourceWorkbook.name;
                break;
              case 'datasource':
                const sourceDatasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, sourceContentId);
                sourceContentName = sourceDatasource.name;
                break;
              case 'project':
                const sourceProjects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${sourceContentId}`);
                sourceContentName = sourceProjects.projects[0]?.name || 'Unknown';
                break;
            }
          } catch (error) {
            return new Err(`Source ${sourceContentType} with ID '${sourceContentId}' not found`);
          }
          
          try {
            switch (targetContentType) {
              case 'workbook':
                const targetWorkbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, targetContentId);
                targetContentName = targetWorkbook.name;
                break;
              case 'datasource':
                const targetDatasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, targetContentId);
                targetContentName = targetDatasource.name;
                break;
              case 'project':
                const targetProjects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${targetContentId}`);
                targetContentName = targetProjects.projects[0]?.name || 'Unknown';
                break;
            }
          } catch (error) {
            return new Err(`Target ${targetContentType} with ID '${targetContentId}' not found`);
          }
          
          // Get source permissions
          const sourcePermissions = await restApi.permissionsMethods.listContentPermissions(
            restApi.siteId,
            sourceContentType,
            sourceContentId
          );
          
          if (sourcePermissions.length === 0) {
            return new Err(`Source ${sourceContentType} '${sourceContentName}' has no permissions to copy`);
          }
          
          // Get existing target permissions if needed
          let existingPermissions: any[] = [];
          if (copyMode !== 'replace') {
            try {
              existingPermissions = await restApi.permissionsMethods.listContentPermissions(
                restApi.siteId,
                targetContentType,
                targetContentId
              );
            } catch (error) {
              // Continue if we can't get existing permissions
            }
          }
          
          // Define permission compatibility between content types
          const permissionCompatibility = {
            workbook: {
              workbook: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'ShareView', 'ViewUnderlyingData', 'Write', 'CreateRefreshMetrics', 'OverwriteRefreshMetrics', 'DeleteRefreshMetrics', 'ChangeHierarchy', 'Delete', 'ChangePermissions'],
              datasource: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
              project: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
            },
            datasource: {
              workbook: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
              datasource: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
              project: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
            },
            project: {
              workbook: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
              datasource: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
              project: ['Read', 'Filter', 'ViewComments', 'AddComments', 'ExportImage', 'ExportData', 'Write', 'Delete', 'ChangePermissions'],
            },
          };
          
          const compatiblePermissions = permissionCompatibility[sourceContentType]?.[targetContentType] || [];
          
          // Process permissions to copy
          const permissionsToCopy = sourcePermissions.map(permission => ({
            granteeType: permission.grantee.type,
            granteeId: permission.grantee.id,
            permissions: permission.permissions.filter((p: any) => 
              compatiblePermissions.includes(p.permission)
            ),
          })).filter(p => p.permissions.length > 0);
          
          if (permissionsToCopy.length === 0) {
            return new Err(`No compatible permissions found between ${sourceContentType} and ${targetContentType}`);
          }
          
          // Remove existing permissions if replace mode
          if (copyMode === 'replace' && existingPermissions.length > 0) {
            for (const existingPermission of existingPermissions) {
              try {
                await restApi.permissionsMethods.revokeAllPermissions(
                  restApi.siteId,
                  targetContentType,
                  targetContentId,
                  existingPermission.grantee.type,
                  existingPermission.grantee.id
                );
              } catch (error) {
                // Continue if revoke fails
              }
            }
          }
          
          // Apply copied permissions
          const results = {
            successful: [] as any[],
            failed: [] as any[],
            skipped: [] as any[],
          };
          
          for (const permissionToApply of permissionsToCopy) {
            try {
              // Check if grantee already has permissions in merge mode
              if (copyMode === 'merge') {
                const existingGranteePermission = existingPermissions.find(
                  ep => ep.grantee.id === permissionToApply.granteeId && ep.grantee.type === permissionToApply.granteeType
                );
                
                if (existingGranteePermission) {
                  const existingPermissionNames = existingGranteePermission.permissions.map((p: any) => p.permission);
                  const newPermissions = permissionToApply.permissions.filter((p: any) => 
                    !existingPermissionNames.includes(p.permission)
                  );
                  
                  if (newPermissions.length === 0) {
                    results.skipped.push({
                      granteeType: permissionToApply.granteeType,
                      granteeId: permissionToApply.granteeId,
                      reason: 'All permissions already exist',
                    });
                    continue;
                  }
                  
                  permissionToApply.permissions = newPermissions;
                }
              }
              
              // Apply permissions
              await restApi.permissionsMethods.grantPermissions(restApi.siteId, {
                contentType: targetContentType,
                contentId: targetContentId,
                granteeType: permissionToApply.granteeType,
                granteeId: permissionToApply.granteeId,
                permissions: permissionToApply.permissions,
              });
              
              results.successful.push({
                granteeType: permissionToApply.granteeType,
                granteeId: permissionToApply.granteeId,
                permissionsApplied: permissionToApply.permissions.length,
                permissions: permissionToApply.permissions,
              });
              
            } catch (error) {
              results.failed.push({
                granteeType: permissionToApply.granteeType,
                granteeId: permissionToApply.granteeId,
                error: `Failed to apply permissions: ${error}`,
              });
            }
          }
          
          // Calculate copy statistics
          const copyStats = {
            sourcePermissions: sourcePermissions.length,
            compatiblePermissions: permissionsToCopy.length,
            successfulCopies: results.successful.length,
            failedCopies: results.failed.length,
            skippedCopies: results.skipped.length,
            totalPermissionsApplied: results.successful.reduce((sum, r) => sum + r.permissionsApplied, 0),
            successRate: permissionsToCopy.length > 0 ? 
              Math.round((results.successful.length / permissionsToCopy.length) * 100) : 0,
          };
          
          // Analyze copy complexity
          const crossTypeOperation = sourceContentType !== targetContentType;
          const permissionFiltering = sourcePermissions.some(sp => 
            sp.permissions.length > permissionsToCopy.find(ptc => 
              ptc.granteeId === sp.grantee.id)?.permissions.length
          );
          
          const copyComplexity = (() => {
            let complexity = 0;
            if (crossTypeOperation) complexity += 2;
            if (permissionFiltering) complexity += 1;
            if (copyMode !== 'replace') complexity += 1;
            if (copyStats.sourcePermissions > 10) complexity += 1;
            
            if (complexity >= 4) return 'High';
            if (complexity >= 2) return 'Medium';
            return 'Low';
          })();
          
          return new Ok({
            success: true,
            permissionsCopied: true,
            source: {
              contentType: sourceContentType,
              contentId: sourceContentId,
              contentName: sourceContentName,
            },
            target: {
              contentType: targetContentType,
              contentId: targetContentId,
              contentName: targetContentName,
            },
            copyOperation: {
              copyMode,
              includeInherited,
              crossTypeOperation,
              copyComplexity,
              permissionFiltering,
            },
            statistics: copyStats,
            results,
            summary: {
              sourceContentName,
              targetContentName,
              operationType: `${sourceContentType} to ${targetContentType}`,
              copyMode,
              permissionsCopied: results.successful.length,
              totalPermissionsApplied: copyStats.totalPermissionsApplied,
              successRate: `${copyStats.successRate}%`,
              operationComplexity: copyComplexity,
            },
            message: `Successfully copied ${results.successful.length}/${permissionsToCopy.length} permissions from ${sourceContentType} '${sourceContentName}' to ${targetContentType} '${targetContentName}'`,
            warnings: {
              ...(crossTypeOperation ? 
                { compatibility: 'Cross-type operation - some permissions may not be compatible' } : {}),
              ...(permissionFiltering ? 
                { filtering: 'Some permissions were filtered due to compatibility constraints' } : {}),
              ...(results.failed.length > 0 ? 
                { failures: `${results.failed.length} permission assignments failed` } : {}),
              ...(copyMode === 'additive' ? 
                { duplicates: 'Additive mode may create duplicate permissions' } : {}),
            },
            recommendations: {
              verification: 'Verify that copied permissions provide appropriate access to target content',
              testing: 'Test access with affected users to ensure permissions work as expected',
              ...(results.failed.length > 0 ? 
                { retryFailures: 'Investigate and retry failed permission assignments' } : {}),
              ...(crossTypeOperation ? 
                { review: 'Review cross-type permission compatibility and adjust if necessary' } : {}),
              documentation: 'Document permission copying for audit and governance purposes',
              monitoring: 'Monitor target content access to ensure permissions are working correctly',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to copy permissions: ${error}`);
        }
      },
    });
  },
});