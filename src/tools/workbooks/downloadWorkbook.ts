import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const downloadWorkbookTool = new Tool({
  name: 'download-workbook',
  description: `
Download a workbook from Tableau Cloud to a local file. Supports various download options including extract inclusion and format preferences.

**Parameters:**
- \`workbookId\`: ID of the workbook to download (use this OR workbookName + projectName)
- \`workbookName\`: Name of the workbook to download (requires projectName)
- \`projectName\`: Name of the project containing the workbook (when using workbookName)
- \`outputPath\`: Local file path where the workbook should be saved (required)
- \`includeExtract\`: Include data extracts in the download (default: true)
- \`includeAll\`: Include all related content (default: false)

**Download Options:**
- \`includeExtract\`: Downloads .twbx with embedded data extracts
- \`includeAll\`: Downloads with all possible related content
- If both false: Downloads .twb file (XML only, no data)

**File Path Guidelines:**
- Use absolute paths for reliability: \`/Users/username/Downloads/workbook.twbx\`
- Include appropriate extension: \`.twb\` or \`.twbx\`
- Ensure target directory exists and is writable
- Consider file size for workbooks with large extracts

**Example Usage:**
- Download by ID: \`{ "workbookId": "wb-123", "outputPath": "/Downloads/sales.twbx" }\`
- Download by name: \`{ "workbookName": "Sales Dashboard", "projectName": "Finance", "outputPath": "/Downloads/sales.twbx" }\`
- XML only: \`{ "workbookId": "wb-123", "outputPath": "/Downloads/sales.twb", "includeExtract": false }\`

**Return Information:**
- Success status and file details
- Downloaded file size
- File path confirmation
- Download options used
`,
  paramsSchema: {
    workbookId: z.string().optional(),
    workbookName: z.string().optional(),
    projectName: z.string().optional(),
    outputPath: z.string().min(1, 'Output path is required'),
    includeExtract: z.boolean().default(true),
    includeAll: z.boolean().default(false),
  },
  annotations: {
    title: 'Download Workbook',
    readOnlyHint: false,
    openWorldHint: false,
  },
  argsValidator: (args) => {
    if (!args.workbookId && !args.workbookName) {
      throw new Error('Either workbookId or workbookName must be provided');
    }
    if (args.workbookName && !args.projectName) {
      throw new Error('projectName is required when using workbookName');
    }
  },
  callback: async ({ 
    workbookId, 
    workbookName, 
    projectName, 
    outputPath, 
    includeExtract, 
    includeAll 
  }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await downloadWorkbookTool.logAndExecute({
      requestId,
      args: { workbookId, workbookName, projectName, outputPath, includeExtract, includeAll },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        let targetWorkbookId = workbookId;
        let targetWorkbookName = workbookName;
        
        // If workbook name provided, find the workbook ID
        if (!targetWorkbookId && workbookName && projectName) {
          // First get project ID
          const project = await restApi.projectsMethods.getProjectByName(restApi.siteId, projectName);
          if (!project) {
            return new Err(`Project not found: ${projectName}`);
          }
          
          // Find workbook in project
          const filter = `name:eq:${encodeURIComponent(workbookName)},projectName:eq:${encodeURIComponent(projectName)}`;
          const workbooks = await restApi.workbooksMethods.listWorkbooks(restApi.siteId, filter);
          
          const workbook = workbooks.workbooks.find(wb => 
            wb.name === workbookName && wb.project?.name === projectName
          );
          
          if (!workbook) {
            return new Err(`Workbook not found: ${workbookName} in project ${projectName}`);
          }
          
          targetWorkbookId = workbook.id;
          targetWorkbookName = workbook.name;
        }
        
        if (!targetWorkbookId) {
          return new Err('Could not determine workbook ID');
        }
        
        // Get workbook details if we don't have the name
        if (!targetWorkbookName) {
          try {
            const workbook = await restApi.workbooksMethods.getWorkbook(restApi.siteId, targetWorkbookId);
            targetWorkbookName = workbook.name;
          } catch (error) {
            // Continue with download even if we can't get the name
            targetWorkbookName = 'Unknown';
          }
        }
        
        // Download the workbook
        const result = await restApi.fileOperations.saveWorkbookToFile(
          restApi.siteId,
          targetWorkbookId,
          outputPath,
          {
            includeExtract,
            includeAll,
          }
        );
        
        return new Ok({
          success: true,
          workbook: {
            id: targetWorkbookId,
            name: targetWorkbookName,
          },
          download: result,
          message: `Successfully downloaded workbook '${targetWorkbookName}' to ${outputPath}`,
          downloadOptions: {
            includeExtract,
            includeAll,
            format: includeExtract || includeAll ? '.twbx (with data)' : '.twb (XML only)',
          },
          fileSizeFormatted: `${(result.size / 1024 / 1024).toFixed(2)} MB`,
        });
      },
    });
  },
});