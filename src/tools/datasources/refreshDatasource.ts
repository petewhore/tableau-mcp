import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Err } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const refreshDatasourceTool = new Tool({
  name: 'refresh-datasource',
  description: `
Refresh a data source in Tableau Cloud/Server to update its data from the underlying data connection. This triggers an extract refresh for extract-based data sources.

**Parameters:**
- \`datasourceId\`: ID of the data source to refresh (required)
- \`datasourceName\`: Optional data source name for reference (will be looked up if not provided)

**Refresh Behavior:**
- **Extract Data Sources**: Updates the extract with latest data from the source
- **Live Connections**: No action needed (always shows current data)
- **Published Data Sources**: Refreshes the published extract
- **Embedded Extracts**: Refreshes extracts within workbooks

**Refresh Process:**
- Runs as a background job in Tableau
- Job status can be monitored using job management tools
- May take significant time for large data sources
- Extract refresh schedule is independent of manual refresh

**Requirements:**
- User must have appropriate permissions on the data source
- Data source must be extract-based to benefit from refresh
- Original data connection must be accessible
- Sufficient system resources for refresh operation

**Example Usage:**
- Simple refresh: \`{ "datasourceId": "ds-123" }\`
- With name reference: \`{ "datasourceId": "ds-123", "datasourceName": "Sales Data" }\`

**Best Practices:**
- Refresh during low-usage periods to minimize impact
- Monitor refresh job status for large data sources
- Coordinate refreshes with data source update schedules
- Consider incremental refresh for very large data sets
- Test refresh process in development before production

**Use Cases:**
- Update data for scheduled reports and dashboards
- Refresh after upstream data pipeline completion
- Manual data updates for ad-hoc analysis
- Troubleshooting data staleness issues
- Preparing data for critical business meetings
`,
  paramsSchema: {
    datasourceId: z.string().min(1, 'Data source ID is required'),
    datasourceName: z.string().optional(),
  },
  annotations: {
    title: 'Refresh Data Source',
    readOnlyHint: false,
    openWorldHint: false,
  },
  callback: async ({ datasourceId, datasourceName }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await refreshDatasourceTool.logAndExecute({
      requestId,
      args: { datasourceId, datasourceName },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        
        try {
          // Verify data source exists and get details
          let datasource;
          try {
            datasource = await restApi.datasourcesMethods.getDatasource(restApi.siteId, datasourceId);
          } catch (error) {
            return new Err(`Data source with ID '${datasourceId}' not found`);
          }
          
          // Check if data source has extracts
          const hasExtracts = datasource.hasExtracts || false;
          const connectionType = datasource.type;
          
          if (!hasExtracts) {
            return new Ok({
              success: true,
              refreshSkipped: true,
              datasource: {
                id: datasource.id,
                name: datasource.name,
                type: connectionType,
                hasExtracts: false,
                contentUrl: datasource.contentUrl,
                projectId: datasource.project?.id,
                projectName: datasource.project?.name,
              },
              message: `Data source '${datasource.name}' is a live connection - no refresh needed`,
              details: {
                connectionType: connectionType,
                isLiveConnection: true,
                refreshRequired: false,
                reason: 'Live connections always show current data without requiring refresh',
              },
              recommendations: {
                liveConnection: 'Live connections automatically show current data from the source',
                noActionNeeded: 'No refresh action is required for live connections',
                scheduleInfo: 'Consider converting to extract if you need refresh scheduling capabilities',
              },
            });
          }
          
          // Trigger the refresh
          const job = await restApi.datasourcesMethods.refreshDatasource(restApi.siteId, datasourceId);
          
          // Get job details for monitoring
          let jobStatus = 'Unknown';
          let jobProgress = 0;
          try {
            const jobDetails = await restApi.jobsMethods.getJob(restApi.siteId, job.id);
            jobStatus = jobDetails.finishCode || jobDetails.mode || 'Running';
            jobProgress = jobDetails.progress || 0;
          } catch (error) {
            // Continue without detailed job info
          }
          
          // Estimate refresh complexity
          const refreshComplexity = (() => {
            // This is an approximation - actual complexity depends on data size and transformations
            if (datasource.size && datasource.size > 1000000) return 'High';
            if (datasource.size && datasource.size > 100000) return 'Medium';
            return 'Low';
          })();
          
          return new Ok({
            success: true,
            refreshStarted: true,
            datasource: {
              id: datasource.id,
              name: datasource.name,
              type: connectionType,
              hasExtracts: true,
              contentUrl: datasource.contentUrl,
              projectId: datasource.project?.id,
              projectName: datasource.project?.name,
              size: datasource.size,
            },
            refreshJob: {
              id: job.id,
              type: job.type,
              status: jobStatus,
              progress: jobProgress,
              createdAt: job.createdAt,
            },
            summary: {
              refreshTriggered: true,
              isExtractBased: hasExtracts,
              estimatedComplexity: refreshComplexity,
              jobId: job.id,
              monitoringAvailable: true,
            },
            details: {
              datasourceId: datasource.id,
              jobType: job.type,
              backgroundJob: true,
              estimatedDuration: refreshComplexity === 'High' ? '10-60 minutes' : 
                               refreshComplexity === 'Medium' ? '2-10 minutes' : '1-5 minutes',
            },
            message: `Successfully started refresh job for data source '${datasource.name}' (Job ID: ${job.id})`,
            recommendations: {
              monitoring: `Use job management tools to monitor refresh progress with job ID '${job.id}'`,
              timing: 'Large data source refreshes may take significant time - monitor job status',
              ...(refreshComplexity === 'High' ? 
                { performance: 'Consider incremental refresh or off-peak scheduling for large data sources' } : {}),
              verification: 'Verify data freshness after refresh completion',
              scheduling: 'Consider setting up automated refresh schedules for regular updates',
            },
          });
          
        } catch (error) {
          return new Err(`Failed to refresh data source: ${error}`);
        }
      },
    });
  },
});