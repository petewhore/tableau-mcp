import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createProjectTool = new Tool({
  name: 'create-project',
  description: `
Create a new project in Tableau Cloud. Projects are containers that organize and manage content such as workbooks, data sources, and flows.

**Parameters:**
- \`name\`: Name of the new project (required)
- \`description\`: Description of the project (optional)
- \`contentPermissions\`: Content permission mode (optional)
- \`parentProjectId\`: ID of parent project for nested projects (optional)

**Content Permission Modes:**
- \`ManagedByOwner\`: Content owners manage their own permissions (default)
- \`LockedToProject\`: Project permissions apply to all content

**Example Usage:**
- Create basic project: \`{ "name": "Sales Analytics" }\`
- Create with description: \`{ "name": "Finance Reports", "description": "Monthly financial reporting dashboards" }\`
- Create locked project: \`{ "name": "Executive", "contentPermissions": "LockedToProject" }\`
- Create nested project: \`{ "name": "Q1 Reports", "parentProjectId": "parent-project-id" }\`
`,
  paramsSchema: {
    name: z.string().min(1, 'Project name is required'),
    description: z.string().optional(),
    contentPermissions: z.enum(['ManagedByOwner', 'LockedToProject']).optional(),
    parentProjectId: z.string().optional(),
  },
  annotations: {
    title: 'Create Project',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ name, description, contentPermissions, parentProjectId }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createProjectTool.logAndExecute({
      requestId,
      args: { name, description, contentPermissions, parentProjectId },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        const project = await restApi.projectsMethods.createProject(restApi.siteId, {
          name,
          description,
          contentPermissions,
          parentProjectId,
        });
        
        return new Ok({
          success: true,
          project,
          message: `Successfully created project '${name}'${parentProjectId ? ' as nested project' : ''}`,
        });
      },
    });
  },
});