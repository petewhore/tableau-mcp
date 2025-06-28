import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const publishWorkbookTool = new Tool({
  name: 'publish-workbook',
  description: `
Publish a workbook file to Tableau Cloud. Supports both .twb (XML) and .twbx (packaged) workbook formats with comprehensive publishing options.

**Parameters:**
- \`filePath\`: Path to the workbook file (.twb or .twbx) (required)
- \`projectId\`: ID of the target project (required)
- \`name\`: Custom name for the workbook (optional, defaults to filename)
- \`description\`: Description for the workbook (optional)
- \`showTabs\`: Whether to show sheet tabs (default: true)
- \`overwrite\`: Whether to overwrite existing workbook with same name (default: false)
- \`skipConnectionCheck\`: Skip connection validation during publish (default: false)
- \`generateThumbnailsAsUser\`: Generate thumbnails as current user (default: false)

**Advanced Options:**
- \`embedCredentials\`: Embed database credentials in workbook (default: false)
- \`hiddenViews\`: Array of view names to hide after publishing
- \`connections\`: Database connection overrides

**Supported File Types:**
- \`.twb\`: Tableau Workbook (XML format)
- \`.twbx\`: Tableau Packaged Workbook (includes data)

**Example Usage:**
- Basic publish: \`{ "filePath": "/path/to/workbook.twbx", "projectId": "project-123" }\`
- With options: \`{ "filePath": "/path/to/sales.twb", "projectId": "project-123", "name": "Sales Dashboard", "overwrite": true }\`
- Hide specific views: \`{ "filePath": "/path/to/workbook.twbx", "projectId": "project-123", "hiddenViews": ["Admin View", "Data Quality"] }\`

**Return Information:**
- Published workbook ID and details
- Content URL for accessing the workbook
- Project information
- Owner details
- Creation timestamp
`,
  paramsSchema: {
    filePath: z.string().min(1, 'File path is required'),
    projectId: z.string().min(1, 'Project ID is required'),
    name: z.string().optional(),
    description: z.string().optional(),
    showTabs: z.boolean().default(true),
    overwrite: z.boolean().default(false),
    skipConnectionCheck: z.boolean().default(false),
    generateThumbnailsAsUser: z.boolean().default(false),
    embedCredentials: z.boolean().default(false),
    hiddenViews: z.array(z.string()).optional(),
    connections: z.array(z.object({
      serverAddress: z.string().optional(),
      serverPort: z.string().optional(),
      connectionUsername: z.string().optional(),
      connectionPassword: z.string().optional(),
      embedPassword: z.boolean().optional(),
    })).optional(),
  },
  annotations: {
    title: 'Publish Workbook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ 
    filePath, 
    projectId, 
    name, 
    description, 
    showTabs, 
    overwrite, 
    skipConnectionCheck, 
    generateThumbnailsAsUser,
    embedCredentials,
    hiddenViews,
    connections 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await publishWorkbookTool.logAndExecute({
      requestId,
      args: { filePath, projectId, name, description, showTabs, overwrite },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        // Validate project exists
        try {
          const projects = await restApi.projectsMethods.listProjects(restApi.siteId, `id:eq:${projectId}`);
          if (projects.projects.length === 0) {
            return new Err(`Project not found: ${projectId}`);
          }
        } catch (error) {
          return new Err(`Failed to validate project: ${error}`);
        }
        
        // Prepare views configuration if hiddenViews specified
        const views = hiddenViews?.map(viewName => ({
          name: viewName,
          hidden: true,
        }));
        
        // Publish the workbook
        const publishedWorkbook = await restApi.fileOperations.publishWorkbook(
          restApi.siteId,
          filePath,
          {
            name,
            description,
            projectId,
            showTabs,
            generateThumbnailsAsUser,
            overwrite,
            skipConnectionCheck,
            embedCredentials,
            views,
            connections,
          }
        );
        
        return new Ok({
          success: true,
          workbook: publishedWorkbook,
          message: `Successfully published workbook '${publishedWorkbook.name}' to project`,
          publishOptions: {
            overwritten: overwrite,
            showTabs,
            skipConnectionCheck,
            hiddenViewsCount: hiddenViews?.length || 0,
            connectionsCount: connections?.length || 0,
          },
          url: `${config.server}/#/site/${restApi.siteId}/workbooks/${publishedWorkbook.id}`,
        });
      },
    });
  },
});