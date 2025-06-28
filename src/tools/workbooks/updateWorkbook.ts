import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const updateWorkbookTool = new Tool({
  name: 'update-workbook',
  description: `
Update properties of an existing workbook in Tableau Cloud/Server. This allows you to modify metadata and settings without republishing the entire workbook.

**Parameters:**
- \`workbookId\`: ID of the workbook to update (required)
- \`name\`: New name for the workbook (optional)
- \`description\`: New description for the workbook (optional)
- \`projectId\`: ID of the project to move the workbook to (optional)
- \`showTabs\`: Whether to show sheet tabs in the workbook (optional)
- \`recentlyViewed\`: Mark workbook as recently viewed (optional)
- \`encryptExtracts\`: Whether to encrypt workbook extracts (optional)

**Updatable Properties:**
- **Name**: Change the display name of the workbook
- **Description**: Update or add descriptive text
- **Project**: Move workbook to a different project
- **Sheet Tabs**: Control visibility of worksheet tabs
- **Recently Viewed**: Update the recently viewed status
- **Extract Encryption**: Enable/disable extract encryption

**Project Movement:**
- Moving workbooks between projects may affect permissions
- Users need appropriate permissions in both source and destination projects
- Consider permission inheritance when moving content
- Notify users of project changes that affect their access

**Example Usage:**
- Rename workbook: \`{ "workbookId": "wb-123", "name": "Updated Sales Dashboard" }\`
- Move to project: \`{ "workbookId": "wb-123", "projectId": "proj-456" }\`
- Update multiple properties: \`{ "workbookId": "wb-123", "name": "New Name", "description": "Updated description", "showTabs": false }\`
- Enable encryption: \`{ "workbookId": "wb-123", "encryptExtracts": true }\`

**Best Practices:**
- Use descriptive names that reflect current content
- Keep descriptions current and meaningful
- Plan project moves carefully to maintain user access
- Consider impact of tab visibility on user experience
- Enable extract encryption for sensitive data

**Use Cases:**
- Reorganizing content structure
- Updating outdated descriptions
- Moving content between team spaces
- Enhancing security with extract encryption
- Improving workbook discoverability
`,
  paramsSchema: {
    workbookId: z.string().min(1, 'Workbook ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    projectId: z.string().optional(),
    showTabs: z.boolean().optional(),
    recentlyViewed: z.boolean().optional(),
    encryptExtracts: z.boolean().optional(),
  },
  annotations: {
    title: 'Update Workbook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    workbookId, 
    name, 
    description, 
    projectId, 
    showTabs, 
    recentlyViewed, 
    encryptExtracts 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await updateWorkbookTool.logAndExecute({
      requestId,
      args: { workbookId, name, description, projectId, showTabs, recentlyViewed, encryptExtracts },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify workbook exists and get current details
          let originalWorkbook;
          try {
            originalWorkbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, workbookId);
          } catch (error) {
            return new Err(`Workbook with ID '${workbookId}' not found`);
          }
          
          // Verify destination project exists if moving
          let destinationProject;
          if (projectId && projectId !== originalWorkbook.project?.id) {
            try {
              const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${projectId}`);
              destinationProject = projects.projects[0];
              if (!destinationProject) {
                return new Err(`Destination project with ID '${projectId}' not found`);
              }
            } catch (error) {
              return new Err(`Destination project with ID '${projectId}' not found`);
            }
          }
          
          // Check if any updates are actually being made
          const hasChanges = name !== undefined || 
                           description !== undefined || 
                           projectId !== undefined || 
                           showTabs !== undefined || 
                           recentlyViewed !== undefined || 
                           encryptExtracts !== undefined;
          
          if (!hasChanges) {
            return new Err('No update parameters provided - specify at least one property to update');
          }
          
          // Update the workbook
          const updatedWorkbook = await restApi.workbooksMethods.updateWorkbook(restApi.siteId, workbookId, {
            name,
            description,
            projectId,
            showTabs,
            recentlyViewed,
            encryptExtracts,
          });
          
          // Analyze changes made
          const changes = {
            nameChanged: name !== undefined && name !== originalWorkbook.name,
            descriptionChanged: description !== undefined && description !== (originalWorkbook.description || ''),
            projectChanged: projectId !== undefined && projectId !== originalWorkbook.project?.id,
            tabsChanged: showTabs !== undefined && showTabs !== originalWorkbook.showTabs,
            viewedChanged: recentlyViewed !== undefined,
            encryptionChanged: encryptExtracts !== undefined && encryptExtracts !== originalWorkbook.encryptExtracts,
          };
          
          const changeCount = Object.values(changes).filter(Boolean).length;
          
          return new Ok({
            success: true,
            workbook: {
              id: updatedWorkbook.id,
              name: updatedWorkbook.name,
              description: updatedWorkbook.description,
              contentUrl: updatedWorkbook.contentUrl,
              projectId: updatedWorkbook.project?.id,
              projectName: updatedWorkbook.project?.name,
              showTabs: updatedWorkbook.showTabs,
              size: updatedWorkbook.size,
              encryptExtracts: updatedWorkbook.encryptExtracts,
              createdAt: updatedWorkbook.createdAt,
              updatedAt: updatedWorkbook.updatedAt,
            },
            changes: {
              totalChanges: changeCount,
              nameChanged: changes.nameChanged,
              descriptionChanged: changes.descriptionChanged,
              projectChanged: changes.projectChanged,
              tabsVisibilityChanged: changes.tabsChanged,
              recentlyViewedUpdated: changes.viewedChanged,
              encryptionChanged: changes.encryptionChanged,
            },
            summary: {
              originalName: originalWorkbook.name,
              newName: updatedWorkbook.name,
              originalProject: originalWorkbook.project?.name,
              newProject: updatedWorkbook.project?.name,
              projectMoved: changes.projectChanged,
              securityEnhanced: changes.encryptionChanged && encryptExtracts,
            },
            details: {
              workbookId: updatedWorkbook.id,
              originalProjectId: originalWorkbook.project?.id,
              newProjectId: updatedWorkbook.project?.id,
              destinationProjectName: destinationProject?.name,
              lastModified: updatedWorkbook.updatedAt,
              hasDescription: !!updatedWorkbook.description,
              tabsVisible: updatedWorkbook.showTabs,
              extractsEncrypted: updatedWorkbook.encryptExtracts,
            },
            message: `Successfully updated workbook '${updatedWorkbook.name}' with ${changeCount} change${changeCount !== 1 ? 's' : ''}`,
            warnings: {
              ...(changes.projectChanged ? 
                { permissionImpact: 'Moving workbook to different project may affect user permissions' } : {}),
              ...(changes.encryptionChanged && !encryptExtracts ? 
                { securityReduced: 'Extract encryption has been disabled - consider security implications' } : {}),
            },
            recommendations: {
              ...(changes.projectChanged ? 
                { permissionReview: 'Review and update workbook permissions after project move' } : {}),
              ...(changes.nameChanged ? 
                { notifyUsers: 'Notify users of workbook name changes to avoid confusion' } : {}),
              ...(changes.encryptionChanged && encryptExtracts ? 
                { securityBenefit: 'Extract encryption enabled - enhanced data security for sensitive content' } : {}),
              versionControl: 'Document workbook changes for audit and version control purposes',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to update workbook: ${error}`);
        }
      },
    });
  },
});