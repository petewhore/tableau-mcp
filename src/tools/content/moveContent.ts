import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const moveContentTool = new Tool({
  name: 'move-content',
  description: `
Move content (workbooks, data sources, or projects) between projects in Tableau Cloud/Server. This operation updates the content's project assignment and may affect permissions.

**Parameters:**
- \`contentType\`: Type of content to move (required)
- \`contentId\`: ID of the content item to move (required)
- \`destinationProjectId\`: ID of the destination project (required)
- \`contentName\`: Optional content name for reference (will be looked up if not provided)

**Content Types:**
- \`workbook\`: Move workbook to different project
- \`datasource\`: Move published data source to different project
- \`project\`: Move project (changes parent project for nested projects)

**Permission Impact:**
- Content inherits permissions from the new project
- Users may gain or lose access based on destination project permissions
- Explicit content permissions are preserved
- Project-level permissions override content permissions

**Project Hierarchy:**
- Projects can be nested within other projects
- Moving projects affects all contained content
- Nested project permissions inherit from parent
- Consider impact on all child content when moving projects

**Example Usage:**
- Move workbook: \`{ "contentType": "workbook", "contentId": "wb-123", "destinationProjectId": "proj-456" }\`
- Move data source: \`{ "contentType": "datasource", "contentId": "ds-789", "destinationProjectId": "proj-456" }\`
- Reorganize project: \`{ "contentType": "project", "contentId": "proj-123", "destinationProjectId": "proj-parent" }\`

**Best Practices:**
- Verify user permissions in destination project
- Consider impact on all users with access to the content
- Plan moves during low-usage periods
- Document organizational changes
- Test access after moving critical content

**Use Cases:**
- Reorganizing content structure
- Team reorganization and project handoffs
- Consolidating related content
- Implementing new governance structures
- Moving development content to production
`,
  paramsSchema: {
    contentType: z.enum(['workbook', 'datasource', 'project']),
    contentId: z.string().min(1, 'Content ID is required'),
    destinationProjectId: z.string().min(1, 'Destination project ID is required'),
    contentName: z.string().optional(),
  },
  annotations: {
    title: 'Move Content',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    contentType, 
    contentId, 
    destinationProjectId, 
    contentName 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await moveContentTool.logAndExecute({
      requestId,
      args: { contentType, contentId, destinationProjectId, contentName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify destination project exists
          let destinationProject;
          try {
            const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${destinationProjectId}`);
            destinationProject = projects.projects[0];
            if (!destinationProject) {
              return new Err(`Destination project with ID '${destinationProjectId}' not found`);
            }
          } catch (error) {
            return new Err(`Destination project with ID '${destinationProjectId}' not found`);
          }
          
          // Get current content details and verify existence
          let currentContent: any;
          let currentProjectName = 'Unknown';
          let currentProjectId = '';
          
          try {
            switch (contentType) {
              case 'workbook':
                currentContent = await restApi.workbooksMethods.getWorkbook(restApi.siteId, contentId);
                currentProjectName = currentContent.project?.name || 'Unknown';
                currentProjectId = currentContent.project?.id || '';
                break;
              case 'datasource':
                currentContent = await restApi.datasourcesMethods.getDatasource(restApi.siteId, contentId);
                currentProjectName = currentContent.project?.name || 'Unknown';
                currentProjectId = currentContent.project?.id || '';
                break;
              case 'project':
                const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${contentId}`);
                currentContent = projects.projects[0];
                if (!currentContent) {
                  return new Err(`Project with ID '${contentId}' not found`);
                }
                currentProjectName = currentContent.parentProject?.name || 'Root';
                currentProjectId = currentContent.parentProject?.id || '';
                break;
            }
          } catch (error) {
            return new Err(`${contentType} with ID '${contentId}' not found`);
          }
          
          // Check if already in destination project
          if (currentProjectId === destinationProjectId) {
            return new Err(`${contentType} '${currentContent.name}' is already in project '${destinationProject.name}'`);
          }
          
          // Perform the move operation
          let movedContent: any;
          switch (contentType) {
            case 'workbook':
              movedContent = await restApi.workbooksMethods.updateWorkbook(restApi.siteId, contentId, {
                projectId: destinationProjectId,
              });
              break;
            case 'datasource':
              movedContent = await restApi.datasourcesMethods.updateDatasource(restApi.siteId, contentId, {
                projectId: destinationProjectId,
              });
              break;
            case 'project':
              movedContent = await restApi.projectsMethods.updateProject(restApi.siteId, contentId, {
                parentProjectId: destinationProjectId,
              });
              break;
          }
          
          // Get child content count for projects
          let childContentCount = 0;
          if (contentType === 'project') {
            try {
              // Count workbooks and data sources in the moved project
              const [workbooks, datasources] = await Promise.all([
                restApi.workbooksMethods.listWorkbooks(restApi.siteId, `projectName:eq:${currentContent.name}`),
                restApi.datasourcesMethods.listDatasources(restApi.siteId, `projectName:eq:${currentContent.name}`)
              ]);
              childContentCount = workbooks.workbooks.length + datasources.datasources.length;
            } catch (error) {
              // Continue without child count
            }
          }
          
          // Analyze move impact
          const moveType = contentType === 'project' ? 'Project Reorganization' : 'Content Relocation';
          const hasChildContent = childContentCount > 0;
          const permissionImpact = 'High'; // Always high since project changes affect permissions
          
          return new Ok({
            success: true,
            move: {
              contentType,
              contentId: movedContent.id,
              contentName: movedContent.name,
              sourceProjectId: currentProjectId,
              sourceProjectName: currentProjectName,
              destinationProjectId: destinationProjectId,
              destinationProjectName: destinationProject.name,
            },
            summary: {
              moveCompleted: true,
              moveType,
              hasChildContent: hasChildContent,
              childContentAffected: childContentCount,
              permissionImpact,
              projectChanged: true,
            },
            details: {
              movedContentId: movedContent.id,
              movedContentName: movedContent.name,
              previousLocation: currentProjectName,
              newLocation: destinationProject.name,
              ...(contentType === 'project' && {
                affectedChildItems: childContentCount,
                hierarchyChange: true,
              }),
              lastModified: movedContent.updatedAt || new Date().toISOString(),
            },
            message: `Successfully moved ${contentType} '${movedContent.name}' from '${currentProjectName}' to '${destinationProject.name}'`,
            warnings: {
              permissionChange: 'Content permissions may have changed due to project move',
              ...(hasChildContent ? 
                { childContentAffected: `${childContentCount} child items are affected by this project move` } : {}),
              accessVerification: 'Verify that users still have appropriate access to the moved content',
            },
            recommendations: {
              accessReview: 'Review user access to ensure business continuity after the move',
              notifyUsers: 'Notify affected users of the content location change',
              ...(contentType === 'project' && hasChildContent ? 
                { childReview: 'Review permissions for all child content in the moved project' } : {}),
              permissionAudit: 'Audit permissions to ensure they align with the new project structure',
              documentation: 'Update documentation to reflect the new content organization',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to move ${contentType}: ${error}`);
        }
      },
    });
  },
});