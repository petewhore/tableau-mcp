import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listGroupsTool = new Tool({
  name: 'list-groups',
  description: `
List all groups in the Tableau Cloud/Server site. Groups help organize users and manage permissions efficiently.

**Parameters:**
- \`filter\`: Filter expression to limit results (optional)
- \`pageSize\`: Number of groups to return per page (optional, default: 100)
- \`pageNumber\`: Page number for pagination (optional, default: 1)

**Filter Examples:**
- \`name:eq:Marketing\`: Groups with exact name "Marketing"
- \`name:has:Team\`: Groups with "Team" in the name
- \`domain:eq:local\`: Only local (non-AD) groups
- \`domain:eq:company.com\`: Only Active Directory groups from company.com

**Filter Operators:**
- \`eq\`: Equals (exact match)
- \`has\`: Contains (partial match)
- \`gt\`, \`gte\`: Greater than (for numeric fields)
- \`lt\`, \`lte\`: Less than (for numeric fields)

**Example Usage:**
- All groups: \`{}\`
- Local groups only: \`{ "filter": "domain:eq:local" }\`
- Find team groups: \`{ "filter": "name:has:Team", "pageSize": 50 }\`
- Large result pagination: \`{ "pageSize": 20, "pageNumber": 2 }\`

**Use Cases:**
- Audit group membership and permissions
- Find groups for permission assignment
- Identify orphaned or unused groups
- Plan group restructuring
`,
  paramsSchema: {
    filter: z.string().optional(),
    pageSize: z.number().min(1).max(1000).optional(),
    pageNumber: z.number().min(1).optional(),
  },
  annotations: {
    title: 'List Groups',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, pageSize, pageNumber }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listGroupsTool.logAndExecute({
      requestId,
      args: { filter, pageSize, pageNumber },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const response = await restApi.groupsMethods.listGroups(
            restApi.siteId, 
            filter, 
            pageSize, 
            pageNumber
          );
          
          // Analyze group composition
          const localGroups = response.groups.group.filter(g => g.domain?.name === 'local');
          const adGroups = response.groups.group.filter(g => g.domain?.name !== 'local');
          const groupsWithMinRole = response.groups.group.filter(g => g.import?.siteRole);
          
          // Group by domain
          const domainSummary = response.groups.group.reduce((acc, group) => {
            const domain = group.domain?.name || 'unknown';
            acc[domain] = (acc[domain] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Site role analysis
          const siteRoleSummary = groupsWithMinRole.reduce((acc, group) => {
            const role = group.import?.siteRole || 'None';
            acc[role] = (acc[role] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          return new Ok({
            success: true,
            groups: response.groups.group.map(group => ({
              id: group.id,
              name: group.name,
              domain: group.domain?.name || 'local',
              minimumSiteRole: group.import?.siteRole,
              isLocalGroup: group.domain?.name === 'local',
              isADGroup: group.domain?.name !== 'local',
            })),
            pagination: {
              currentPage: parseInt(response.pagination.pageNumber),
              pageSize: parseInt(response.pagination.pageSize),
              totalAvailable: parseInt(response.pagination.totalAvailable),
              totalPages: Math.ceil(parseInt(response.pagination.totalAvailable) / parseInt(response.pagination.pageSize)),
            },
            summary: {
              totalGroups: response.groups.group.length,
              localGroups: localGroups.length,
              adGroups: adGroups.length,
              groupsWithMinRole: groupsWithMinRole.length,
              uniqueDomains: Object.keys(domainSummary).length,
            },
            analysis: {
              domainBreakdown: domainSummary,
              siteRoleConstraints: siteRoleSummary,
              hasFilter: !!filter,
              isFiltered: !!filter,
              isPaginated: pageSize ? pageSize < parseInt(response.pagination.totalAvailable) : false,
            },
            message: `Found ${response.groups.group.length} groups${filter ? ` matching filter '${filter}'` : ''}`,
            recommendations: {
              ...(adGroups.length > 0 ? 
                { adSync: 'Active Directory groups will sync membership automatically' } : {}),
              ...(response.groups.group.length === 0 && filter ? 
                { noResults: 'Try adjusting the filter criteria or check group names' } : {}),
              ...(parseInt(response.pagination.totalAvailable) > parseInt(response.pagination.pageSize) ? 
                { pagination: 'Use pageNumber parameter to access additional results' } : {}),
              management: 'Use create-group, add-user-to-group, and grant-permissions tools for group management',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list groups: ${error}`);
        }
      },
    });
  },
});