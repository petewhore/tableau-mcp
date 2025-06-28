import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const createGroupTool = new Tool({
  name: 'create-group',
  description: `
Create a new group in Tableau Cloud/Server. Groups help organize users and simplify permission management by applying permissions to groups rather than individual users.

**Parameters:**
- \`name\`: Name for the new group (required)
- \`domainName\`: Domain name for the group (optional, defaults to 'local')
- \`minimumSiteRole\`: Minimum site role for group members (optional)

**Domain Names:**
- \`local\`: Local Tableau group (default)
- Active Directory domain name for AD groups

**Minimum Site Roles:**
- \`Unlicensed\`: No access to site content
- \`Viewer\`: Can view content
- \`Explorer\`: Can view and interact with content
- \`Creator\`: Can create and publish content
- \`SiteAdministrator\`: Full administrative access

**Example Usage:**
- Basic group: \`{ "name": "Marketing Team" }\`
- AD group: \`{ "name": "Finance Users", "domainName": "company.com", "minimumSiteRole": "Explorer" }\`
- Viewer group: \`{ "name": "Executives", "minimumSiteRole": "Viewer" }\`

**Best Practices:**
- Use descriptive group names that reflect team or role structure
- Set appropriate minimum site roles to control licensing
- Consider using Active Directory groups for enterprise environments
- Document group purposes for future administration
`,
  paramsSchema: {
    name: z.string().min(1, 'Group name is required'),
    domainName: z.string().optional(),
    minimumSiteRole: z.enum(['Unlicensed', 'Viewer', 'Explorer', 'Creator', 'SiteAdministrator']).optional(),
  },
  annotations: {
    title: 'Create Group',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ name, domainName, minimumSiteRole }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await createGroupTool.logAndExecute({
      requestId,
      args: { name, domainName, minimumSiteRole },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Check if group with same name already exists
          const existingGroups = await restApi.groupsMethods.listGroups(
            restApi.siteId, 
            `name:eq:${name}`
          );
          
          if (existingGroups.groups.group.length > 0) {
            return new Err(`Group with name '${name}' already exists`);
          }
          
          // Create the group
          const group = await restApi.groupsMethods.createGroup(restApi.siteId, {
            name,
            domainName,
            minimumSiteRole,
          });
          
          // Analyze group configuration
          const groupType = group.domain?.name === 'local' ? 'Local' : 'Active Directory';
          const hasMinimumRole = group.import?.siteRole ? true : false;
          
          return new Ok({
            success: true,
            group: {
              id: group.id,
              name: group.name,
              domainName: group.domain?.name || 'local',
              minimumSiteRole: group.import?.siteRole,
            },
            summary: {
              groupType,
              hasMinimumRole,
              isLocalGroup: group.domain?.name === 'local',
              isADGroup: group.domain?.name !== 'local',
            },
            details: {
              groupId: group.id,
              fullDomainName: group.domain?.name,
              licenseConstraint: group.import?.siteRole || 'None',
              canAddUsers: true,
              requiresAuthentication: groupType === 'Active Directory',
            },
            message: `Successfully created ${groupType.toLowerCase()} group '${group.name}' with ID ${group.id}`,
            recommendations: {
              ...(groupType === 'Local' ? 
                { userManagement: 'Add users to this local group using the add-user-to-group tool' } : {}),
              ...(groupType === 'Active Directory' ? 
                { syncRequired: 'AD group membership will sync automatically from Active Directory' } : {}),
              ...(hasMinimumRole ? 
                { licensing: `All group members will have at least ${group.import?.siteRole} site role` } : {}),
              nextSteps: 'Consider setting up permissions for this group using the grant-permissions tool',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to create group: ${error}`);
        }
      },
    });
  },
});