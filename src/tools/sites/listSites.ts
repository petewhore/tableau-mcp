import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listSitesTool = new Tool({
  name: 'list-sites',
  description: `
List all sites in Tableau Server/Cloud. Sites provide isolated environments for different teams, departments, or projects.

**Parameters:**
- \`filter\`: Filter expression to limit results (optional)
- \`pageSize\`: Number of sites to return per page (optional, default: 100)
- \`pageNumber\`: Page number for pagination (optional, default: 1)

**Site Information Includes:**
- **Basic Details**: Name, content URL, admin mode
- **Quotas**: User and storage limits
- **Features**: Enabled/disabled capabilities
- **State**: Active, suspended, or maintenance status
- **Configuration**: Time zones, revision settings

**Admin Modes:**
- \`ContentAndUsers\`: Site admins can manage both content and users
- \`ContentOnly\`: Site admins can only manage content, not users

**Filter Examples:**
- \`state:eq:Active\`: Only active sites
- \`adminMode:eq:ContentOnly\`: Sites with content-only admin mode
- \`name:has:Dev\`: Sites with "Dev" in the name
- \`userQuota:gte:100\`: Sites with 100+ user quota

**Example Usage:**
- All sites: \`{}\`
- Active sites only: \`{ "filter": "state:eq:Active" }\`
- Development sites: \`{ "filter": "name:has:Dev" }\`
- Sites with user limits: \`{ "filter": "userQuota:gte:1" }\`

**Use Cases:**
- Server administration and capacity planning
- Site lifecycle management
- Resource allocation monitoring
- Multi-tenancy governance
- License utilization tracking
`,
  paramsSchema: {
    filter: z.string().optional(),
    pageSize: z.number().min(1).max(1000).optional(),
    pageNumber: z.number().min(1).optional(),
  },
  annotations: {
    title: 'List Sites',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ filter, pageSize, pageNumber }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listSitesTool.logAndExecute({
      requestId,
      args: { filter, pageSize, pageNumber },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          const response = await restApi.sitesMethods.listSites(filter, pageSize, pageNumber);
          
          // Analyze site composition
          const activeSites = response.sites.filter(s => s.state === 'Active');
          const suspendedSites = response.sites.filter(s => s.state === 'Suspended');
          
          const adminModeStats = response.sites.reduce((acc, site) => {
            acc[site.adminMode] = (acc[site.adminMode] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          
          // Calculate resource utilization
          const totalUserQuota = response.sites.reduce((sum, site) => sum + (site.userQuota || 0), 0);
          const totalStorageQuota = response.sites.reduce((sum, site) => sum + (site.storageQuota || 0), 0);
          
          // Feature adoption analysis
          const featureStats = response.sites.reduce((acc, site) => {
            acc.subscriptionsEnabled += site.subscriptionsEnabled ? 1 : 0;
            acc.flowsEnabled += site.flowsEnabled ? 1 : 0;
            acc.guestAccessEnabled += site.guestAccessEnabled ? 1 : 0;
            acc.commentingEnabled += site.commentingEnabled ? 1 : 0;
            acc.revisionHistoryEnabled += site.revisionHistoryEnabled ? 1 : 0;
            return acc;
          }, {
            subscriptionsEnabled: 0,
            flowsEnabled: 0,
            guestAccessEnabled: 0,
            commentingEnabled: 0,
            revisionHistoryEnabled: 0,
          });
          
          // Identify sites with restrictions or limits
          const sitesWithUserQuota = response.sites.filter(s => s.userQuota && s.userQuota > 0);
          const sitesWithStorageQuota = response.sites.filter(s => s.storageQuota && s.storageQuota > 0);
          
          return new Ok({
            success: true,
            sites: response.sites.map(site => ({
              id: site.id,
              name: site.name,
              contentUrl: site.contentUrl,
              adminMode: site.adminMode,
              state: site.state,
              userQuota: site.userQuota,
              storageQuota: site.storageQuota,
              subscriptionsEnabled: site.subscriptionsEnabled,
              flowsEnabled: site.flowsEnabled,
              guestAccessEnabled: site.guestAccessEnabled,
              commentingEnabled: site.commentingEnabled,
              revisionHistoryEnabled: site.revisionHistoryEnabled,
              revisionLimit: site.revisionLimit,
              timeZone: site.timeZone,
              statusReason: site.statusReason,
            })),
            pagination: response.pagination ? {
              currentPage: response.pagination.pageNumber,
              pageSize: response.pagination.pageSize,
              totalAvailable: response.pagination.totalAvailable,
              totalPages: Math.ceil(response.pagination.totalAvailable / response.pagination.pageSize),
            } : undefined,
            summary: {
              totalSites: response.sites.length,
              activeSites: activeSites.length,
              suspendedSites: suspendedSites.length,
              sitesWithUserQuota: sitesWithUserQuota.length,
              sitesWithStorageQuota: sitesWithStorageQuota.length,
              averageUserQuota: sitesWithUserQuota.length > 0 
                ? Math.round(totalUserQuota / sitesWithUserQuota.length) 
                : 0,
            },
            analysis: {
              adminModeDistribution: adminModeStats,
              featureAdoption: featureStats,
              resourceUtilization: {
                totalUserQuota,
                totalStorageQuota: Math.round(totalStorageQuota / 1024 / 1024), // Convert to MB
                averageUserQuota: sitesWithUserQuota.length > 0 
                  ? Math.round(totalUserQuota / sitesWithUserQuota.length) 
                  : 0,
                averageStorageQuota: sitesWithStorageQuota.length > 0 
                  ? Math.round(totalStorageQuota / sitesWithStorageQuota.length / 1024 / 1024) 
                  : 0,
              },
              governanceMetrics: {
                sitesWithQuotas: ((sitesWithUserQuota.length + sitesWithStorageQuota.length) / (response.sites.length * 2) * 100).toFixed(1) + '%',
                contentOnlyMode: ((adminModeStats.ContentOnly || 0) / response.sites.length * 100).toFixed(1) + '%',
                featureRestrictions: response.sites.filter(s => !s.subscriptionsEnabled || !s.flowsEnabled).length,
              },
            },
            message: `Found ${response.sites.length} sites${filter ? ` matching filter criteria` : ''}`,
            warnings: {
              ...(suspendedSites.length > 0 ? 
                { suspendedSites: `${suspendedSites.length} sites are suspended and not accessible to users` } : {}),
              ...(response.sites.some(s => !s.userQuota) ? 
                { unlimitedUsers: 'Some sites have no user quota limits - monitor license usage' } : {}),
              ...(response.sites.some(s => !s.storageQuota) ? 
                { unlimitedStorage: 'Some sites have no storage quota limits - monitor disk usage' } : {}),
            },
            recommendations: {
              ...(suspendedSites.length > 0 ? 
                { reviewSuspended: 'Review suspended sites to determine if they should be reactivated or deleted' } : {}),
              ...(featureStats.subscriptionsEnabled === 0 ? 
                { enableSubscriptions: 'Consider enabling subscriptions for automated report delivery' } : {}),
              ...(featureStats.flowsEnabled === 0 ? 
                { enableFlows: 'Consider enabling Tableau Prep flows for data preparation' } : {}),
              resourceManagement: 'Regularly review and adjust user and storage quotas based on actual usage',
              governance: 'Implement consistent naming conventions and feature policies across sites',
              monitoring: 'Set up regular site usage monitoring and capacity planning',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to list sites: ${error}`);
        }
      },
    });
  },
});